using DotNetEnv;
using Npgsql;
using NpgsqlTypes;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 4 * 1024 * 1024);
var connectionString = FinancialDashboardConnection.Create(builder.Environment, builder.Configuration);
builder.Services.AddSingleton(NpgsqlDataSource.Create(connectionString));
builder.Services.AddSingleton<ProjectStore>();
var app = builder.Build();
app.Use(async (context, next) =>
{
    try { await next(context); }
    catch (JsonException) { context.Response.StatusCode = 400; await context.Response.WriteAsJsonAsync(new { error = "Format JSON tidak valid." }); }
    catch (IOException) { context.Response.StatusCode = 503; await context.Response.WriteAsJsonAsync(new { error = "Penyimpanan tidak tersedia. Coba simpan kembali." }); }
    catch (NpgsqlException) { context.Response.StatusCode = 503; await context.Response.WriteAsJsonAsync(new { error = "PostgreSQL FinancialDashboard tidak tersedia. Periksa layanan database lalu coba kembali." }); }
});
await app.Services.GetRequiredService<ProjectStore>().InitializeAsync(CancellationToken.None);
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapGet("/api/projects", async (ProjectStore store) => Results.Ok(await store.List()));
app.MapGet("/api/projects/{id:guid}", async (Guid id, ProjectStore store) =>
    await store.Get(id) is { } project ? Results.Ok(project) : Results.NotFound());
app.MapPut("/api/projects/{id:guid}", async (Guid id, JsonObject body, ProjectStore store) =>
{
    var error = SchemaValidation.Check(body, id);
    if (error != null) return Results.BadRequest(new { error });
    var result = await store.Save(id, body);
    return result == null ? Results.Conflict(new { error = "Project berubah di sesi lain. Buka ulang project sebelum menyimpan." }) : Results.Ok(result);
});
app.MapDelete("/api/projects/{id:guid}", async (Guid id, long revision, ProjectStore store) =>
    await store.Delete(id, revision) ? Results.NoContent() : Results.Conflict(new { error = "Project berubah. Muat ulang daftar project." }));
app.Run();

sealed class ProjectStore
{
    readonly NpgsqlDataSource dataSource;
    readonly string legacyFolder;
    readonly JsonSerializerOptions jsonOptions = new() { WriteIndented = true };
    public ProjectStore(NpgsqlDataSource dataSource, IWebHostEnvironment env, IConfiguration config)
    {
        this.dataSource = dataSource;
        legacyFolder = Path.GetFullPath(config["DataDirectory"] ?? Path.Combine(env.ContentRootPath, "App_Data"));
    }

    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using (var schema = new NpgsqlCommand("""
            CREATE SCHEMA IF NOT EXISTS schema_studio;
            CREATE TABLE IF NOT EXISTS schema_studio.projects (
                project_id uuid PRIMARY KEY,
                project_name text NOT NULL,
                document jsonb NOT NULL,
                revision bigint NOT NULL CHECK (revision >= 0),
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                deleted_at timestamptz NULL
            );
            CREATE INDEX IF NOT EXISTS ix_schema_studio_projects_active_updated
                ON schema_studio.projects (updated_at DESC) WHERE deleted_at IS NULL;
            """, connection))
            await schema.ExecuteNonQueryAsync(cancellationToken);
        await ImportLegacyFilesAsync(connection, cancellationToken);
    }

    async Task ImportLegacyFilesAsync(NpgsqlConnection connection, CancellationToken cancellationToken)
    {
        if (!Directory.Exists(legacyFolder)) return;
        foreach (var file in Directory.EnumerateFiles(legacyFolder, "*.json"))
        {
            if (!Guid.TryParse(Path.GetFileNameWithoutExtension(file), out var id)) continue;
            JsonObject? document;
            try { document = JsonNode.Parse(await File.ReadAllTextAsync(file, cancellationToken))?.AsObject(); }
            catch (JsonException) { continue; }
            if (document is null || (string?)document["id"] != id.ToString() || string.IsNullOrWhiteSpace((string?)document["name"])) continue;
            var revision = (long?)document["revision"] ?? 0;
            var updatedAt = DateTimeOffset.TryParse((string?)document["updatedAt"], out var parsed) ? parsed : DateTimeOffset.UtcNow;
            await using var import = new NpgsqlCommand("""
                INSERT INTO schema_studio.projects (project_id, project_name, document, revision, created_at, updated_at)
                VALUES (@id, @name, CAST(@document AS jsonb), @revision, @updatedAt, @updatedAt)
                ON CONFLICT (project_id) DO NOTHING;
                """, connection);
            import.Parameters.AddWithValue("id", id);
            import.Parameters.AddWithValue("name", (string)document["name"]!);
            import.Parameters.Add(new NpgsqlParameter("document", NpgsqlDbType.Jsonb) { Value = document.ToJsonString(jsonOptions) });
            import.Parameters.AddWithValue("revision", revision);
            import.Parameters.AddWithValue("updatedAt", updatedAt);
            await import.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    public async Task<JsonObject?> Get(Guid id)
    {
        await using var connection = await dataSource.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("""
            SELECT document::text FROM schema_studio.projects
            WHERE project_id = @id AND deleted_at IS NULL;
            """, connection);
        command.Parameters.AddWithValue("id", id);
        var document = await command.ExecuteScalarAsync();
        return document is string json ? JsonNode.Parse(json)?.AsObject() : null;
    }
    public async Task<List<ProjectSummary>> List()
    {
        await using var connection = await dataSource.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("""
            SELECT project_id, project_name, revision, updated_at,
                   jsonb_array_length(document->'tables') AS table_count
            FROM schema_studio.projects WHERE deleted_at IS NULL
            ORDER BY updated_at DESC;
            """, connection);
        await using var reader = await command.ExecuteReaderAsync();
        var items = new List<ProjectSummary>();
        while (await reader.ReadAsync())
            items.Add(new ProjectSummary(reader.GetGuid(0), reader.GetString(1), reader.GetInt64(2), reader.GetFieldValue<DateTimeOffset>(3).ToString("O"), reader.GetInt32(4)));
        return items;
    }
    public async Task<JsonObject?> Save(Guid id, JsonObject body)
    {
        var expectedRevision = (long?)body["revision"] ?? -1;
        await using var connection = await dataSource.OpenConnectionAsync();
        var now = DateTimeOffset.UtcNow;
        body["revision"] = expectedRevision + 1;
        body["updatedAt"] = now.ToString("O");
        var document = body.ToJsonString(jsonOptions);
        await using var update = new NpgsqlCommand("""
            UPDATE schema_studio.projects
            SET project_name = @name, document = CAST(@document AS jsonb), revision = revision + 1, updated_at = @updatedAt
            WHERE project_id = @id AND revision = @revision AND deleted_at IS NULL
            RETURNING revision, updated_at;
            """, connection);
        update.Parameters.AddWithValue("id", id);
        update.Parameters.AddWithValue("name", (string)body["name"]!);
        update.Parameters.Add(new NpgsqlParameter("document", NpgsqlDbType.Jsonb) { Value = document });
        update.Parameters.AddWithValue("revision", expectedRevision);
        update.Parameters.AddWithValue("updatedAt", now);
        await using var reader = await update.ExecuteReaderAsync();
        if (await reader.ReadAsync())
        {
            body["revision"] = reader.GetInt64(0);
            body["updatedAt"] = reader.GetFieldValue<DateTimeOffset>(1).ToString("O");
            return body;
        }
        await reader.CloseAsync();
        if (expectedRevision != 0) return null;
        await using var insert = new NpgsqlCommand("""
            INSERT INTO schema_studio.projects (project_id, project_name, document, revision, created_at, updated_at)
            VALUES (@id, @name, CAST(@document AS jsonb), 1, @updatedAt, @updatedAt)
            ON CONFLICT (project_id) DO NOTHING
            RETURNING revision, updated_at;
            """, connection);
        insert.Parameters.AddWithValue("id", id);
        insert.Parameters.AddWithValue("name", (string)body["name"]!);
        insert.Parameters.Add(new NpgsqlParameter("document", NpgsqlDbType.Jsonb) { Value = document });
        insert.Parameters.AddWithValue("updatedAt", now);
        await using var inserted = await insert.ExecuteReaderAsync();
        if (!await inserted.ReadAsync()) return null;
        body["revision"] = inserted.GetInt64(0);
        body["updatedAt"] = inserted.GetFieldValue<DateTimeOffset>(1).ToString("O");
        return body;
    }
    public async Task<bool> Delete(Guid id, long revision)
    {
        await using var connection = await dataSource.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("""
            UPDATE schema_studio.projects SET deleted_at = now()
            WHERE project_id = @id AND revision = @revision AND deleted_at IS NULL;
            """, connection);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("revision", revision);
        return await command.ExecuteNonQueryAsync() == 1;
    }
}

sealed record ProjectSummary(Guid Id, string Name, long Revision, string UpdatedAt, int TableCount);

static class FinancialDashboardConnection
{
    public static string Create(IWebHostEnvironment env, IConfiguration config)
    {
        var configured = config["SchemaStudio:ConnectionString"] ?? Environment.GetEnvironmentVariable("SCHEMA_STUDIO_CONNECTION_STRING");
        if (!string.IsNullOrWhiteSpace(configured)) return configured;
        var financialRoot = Path.GetFullPath(config["FinancialDashboardDirectory"] ?? Environment.GetEnvironmentVariable("FINANCIAL_DASHBOARD_DIRECTORY") ?? Path.Combine(env.ContentRootPath, "..", "..", "FinancialDashboard"));
        var envFile = Path.Combine(financialRoot, ".env");
        if (!File.Exists(envFile)) throw new InvalidOperationException($"Konfigurasi FinancialDashboard tidak ditemukan: {envFile}. Atur FINANCIAL_DASHBOARD_DIRECTORY atau SCHEMA_STUDIO_CONNECTION_STRING.");
        Env.Load(envFile);
        var password = Environment.GetEnvironmentVariable("POSTGRES_PASSWORD");
        if (string.IsNullOrWhiteSpace(password)) throw new InvalidOperationException("POSTGRES_PASSWORD FinancialDashboard belum dikonfigurasi.");
        var active = (Environment.GetEnvironmentVariable("ACTIVE_DB") ?? "LOCAL").Split('#')[0].Trim().ToUpperInvariant();
        if (active is not ("LOCAL" or "SERVER")) throw new InvalidOperationException("ACTIVE_DB FinancialDashboard harus LOCAL atau SERVER.");
        var host = active == "SERVER" ? Environment.GetEnvironmentVariable("POSTGRES_SERVER_HOST") ?? "127.0.0.1" : Environment.GetEnvironmentVariable("POSTGRES_LOCAL_HOST") ?? Environment.GetEnvironmentVariable("POSTGRES_HOST") ?? "localhost";
        var portValue = active == "SERVER" ? Environment.GetEnvironmentVariable("POSTGRES_SERVER_PORT") ?? "15432" : Environment.GetEnvironmentVariable("POSTGRES_LOCAL_PORT") ?? Environment.GetEnvironmentVariable("POSTGRES_PORT") ?? "5432";
        if (!int.TryParse(portValue, out var port) || port is < 1 or > 65535) throw new InvalidOperationException("Port PostgreSQL FinancialDashboard tidak valid.");
        return new NpgsqlConnectionStringBuilder { Host = host, Port = port, Database = Environment.GetEnvironmentVariable("POSTGRES_DB") ?? "financial_dashboard", Username = Environment.GetEnvironmentVariable("POSTGRES_USER") ?? "financial_app", Password = password, Pooling = true, MaxPoolSize = 25 }.ConnectionString;
    }
}

static class SchemaValidation
{
    static readonly Regex Identifier = new("^[A-Za-z_][A-Za-z0-9_]{0,62}$", RegexOptions.CultureInvariant);
    static readonly HashSet<string> Types = ["int", "bigint", "uuid", "varchar(255)", "text", "boolean", "decimal(18,2)", "date", "timestamp", "json"];
    static bool Name(string? value) => value != null && Identifier.IsMatch(value);
    public static string? Check(JsonObject p, Guid id)
    {
        try
        {
            if ((string?)p["id"] != id.ToString() || (int?)p["version"] != 1 || (long?)p["revision"] is not >= 0) return "Identitas atau versi project tidak valid.";
            if (string.IsNullOrWhiteSpace((string?)p["name"]) || ((string)p["name"]!).Length > 120) return "Nama project wajib diisi (maksimal 120 karakter).";
            if ((string?)p["dialect"] is not ("postgres" or "mysql" or "sqlserver")) return "Dialect tidak dikenal.";
            if (p["tables"] is not JsonArray tables || tables.Count > 200 || p["relations"] is not JsonArray relations || relations.Count > 1000) return "Maksimal 200 tabel dan 1000 relasi.";
            if (p["viewport"] is not JsonObject view || !double.IsFinite((double)view["x"]!) || !double.IsFinite((double)view["y"]!) || (double?)view["zoom"] is not (>= 0.2 and <= 2)) return "Viewport tidak valid.";
            if (p["snap"] is not JsonValue || !p["snap"]!.AsValue().TryGetValue<bool>(out _)) return "Pengaturan grid tidak valid.";
            var ids = new HashSet<string>();
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var columns = new Dictionary<string, (string Table, string Name, string Type, bool Key, bool Unique, bool Nullable)>();
            foreach (var item in tables)
            {
                var t = item!.AsObject(); var tid = (string)t["id"]!;
                if (!Guid.TryParse(tid, out _) || !ids.Add(tid) || !Name((string?)t["name"]) || !names.Add((string)t["name"]!)) return "Nama tabel harus unik dan berupa identifier yang valid.";
                if (!double.IsFinite((double)t["x"]!) || !double.IsFinite((double)t["y"]!)) return "Posisi tabel tidak valid.";
                if (!Regex.IsMatch((string?)t["color"] ?? "", "^#[0-9a-fA-F]{6}$") || ((string?)t["note"] ?? "").Length > 2000) return "Warna atau catatan tidak valid.";
                if (t["columns"] is not JsonArray cols || cols.Count is < 1 or > 100) return "Tabel harus memiliki 1–100 kolom.";
                var colNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var value in cols)
                {
                    var c = value!.AsObject(); var cid = (string)c["id"]!; var type = (string)c["type"]!;
                    if (!Guid.TryParse(cid, out _) || !ids.Add(cid) || !Name((string?)c["name"]) || !colNames.Add((string)c["name"]!) || !Types.Contains(type)) return "Kolom tidak valid, duplikat, atau tipe tidak didukung.";
                    var pk = (bool)c["primaryKey"]!; var nullable = (bool)c["nullable"]!; var unique = (bool)c["unique"]!;
                    if (pk && nullable) return "Primary key tidak boleh nullable.";
                    if (((string?)c["defaultValue"] ?? "").Length > 500) return "Default value terlalu panjang.";
                    // Missing metadata is normalized for projects created before this feature.
                    foreach (var field in new[] { "displayName", "description", "generationPattern" })
                        if (!c.ContainsKey(field)) c[field] = "";
                    if (!c.ContainsKey("systemGenerated")) c["systemGenerated"] = false;
                    if (c["displayName"] is not JsonValue display || !display.TryGetValue<string>(out var displayName) || displayName.Length > 120 ||
                        c["description"] is not JsonValue desc || !desc.TryGetValue<string>(out var description) || description.Length > 2000 ||
                        c["generationPattern"] is not JsonValue patternValue || !patternValue.TryGetValue<string>(out var pattern) || pattern.Length > 200 ||
                        c["systemGenerated"] is not JsonValue generated || !generated.TryGetValue<bool>(out var systemGenerated)) return "Metadata kolom tidak valid.";
                    c["displayName"] = displayName.Trim();
                    c["generationPattern"] = pattern = pattern.Trim();
                    if (systemGenerated)
                    {
                        const string token = @"\{(?:SEQ(?::[1-9])?|MM|YYYY|DD)\}";
                        if (string.IsNullOrWhiteSpace(pattern) || pattern.Contains('\n') || pattern.Contains('\r') || !Regex.IsMatch(pattern, token) || Regex.IsMatch(Regex.Replace(pattern, token, ""), "[{}]"))
                            return $"Format nilai otomatis {t["name"]}.{c["name"]} tidak valid. Gunakan {{SEQ}}, {{SEQ:1}}–{{SEQ:9}}, {{DD}}, {{MM}}, atau {{YYYY}}.";
                    }
                    columns.Add(cid, (tid, (string)c["name"]!, type, pk && cols.Count(x => (bool)x!["primaryKey"]!) == 1, unique, nullable));
                }
            }
            var endpoints = new HashSet<string>();
            foreach (var item in relations)
            {
                var r = item!.AsObject(); var rid = (string)r["id"]!;
                if (!Guid.TryParse(rid, out _) || !ids.Add(rid) || (string?)r["kind"] is not ("one-to-many" or "one-to-one")) return "Relasi tidak valid.";
                var from = (string)r["fromColumn"]!; var to = (string)r["toColumn"]!;
                if (!columns.TryGetValue(from, out var a) || !columns.TryGetValue(to, out var b) || a.Table != (string?)r["fromTable"] || b.Table != (string?)r["toTable"] || from == to) return "Endpoint relasi tidak ditemukan.";
                if (a.Type != b.Type || !(a.Key || a.Unique) || !endpoints.Add(to)) return "FK harus bertipe sama, mereferensikan PK tunggal/UNIQUE, dan hanya memiliki satu referensi.";
                if ((string?)r["kind"] == "one-to-one" && !(b.Key || b.Unique)) return "Kolom FK one-to-one harus UNIQUE.";
                if (!r.ContainsKey("joinedColumns")) r["joinedColumns"] = new JsonArray();
                if (!r.ContainsKey("showForeignKey")) r["showForeignKey"] = true;
                if (r["joinedColumns"] is not JsonArray joined || r["showForeignKey"] is not JsonValue visible || !visible.TryGetValue<bool>(out _)) return "Pengaturan hasil join tidak valid.";
                var joinedIds = new HashSet<string>();
                foreach (var joinedValue in joined)
                {
                    var joinedId = (string?)joinedValue;
                    if (joinedId == null || !joinedIds.Add(joinedId) || !columns.TryGetValue(joinedId, out var joinedColumn) || joinedColumn.Table != a.Table) return "Kolom hasil join tidak valid.";
                    if (columns.Values.Any(column => column.Table == b.Table && string.Equals(column.Name, joinedColumn.Name, StringComparison.OrdinalIgnoreCase))) return $"Kolom {joinedColumn.Name} sudah ada pada tabel tujuan; tidak dapat ditambahkan dari hasil join.";
                }
            }
            return null;
        }
        catch (Exception e) when (e is InvalidOperationException or FormatException or NullReferenceException or ArgumentException or OverflowException)
        { return "Struktur schema tidak valid."; }
    }
}
