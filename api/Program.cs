using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 4 * 1024 * 1024);
builder.Services.AddSingleton<ProjectStore>();
var app = builder.Build();
app.Use(async (context, next) =>
{
    try { await next(context); }
    catch (JsonException) { context.Response.StatusCode = 400; await context.Response.WriteAsJsonAsync(new { error = "Format JSON tidak valid." }); }
    catch (IOException) { context.Response.StatusCode = 503; await context.Response.WriteAsJsonAsync(new { error = "Penyimpanan tidak tersedia. Coba simpan kembali." }); }
});
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
    readonly string folder;
    readonly SemaphoreSlim gate = new(1, 1);
    readonly JsonSerializerOptions jsonOptions = new() { WriteIndented = true };
    public ProjectStore(IWebHostEnvironment env, IConfiguration config)
    {
        folder = Path.GetFullPath(config["DataDirectory"] ?? Path.Combine(env.ContentRootPath, "App_Data"));
        Directory.CreateDirectory(folder);
    }
    string FilePath(Guid id) => Path.Combine(folder, $"{id:D}.json");
    async Task<JsonObject?> Read(Guid id) => File.Exists(FilePath(id)) ? JsonNode.Parse(await File.ReadAllTextAsync(FilePath(id)))?.AsObject() : null;
    public async Task<JsonObject?> Get(Guid id)
    {
        await gate.WaitAsync();
        try { return await Read(id); } finally { gate.Release(); }
    }
    public async Task<List<object>> List()
    {
        await gate.WaitAsync();
        try
        {
            var items = new List<object>();
            foreach (var path in Directory.EnumerateFiles(folder, "*.json"))
            {
                if (!Guid.TryParse(Path.GetFileNameWithoutExtension(path), out var id)) continue;
                var p = await Read(id);
                if (p != null) items.Add(new { id, name = (string?)p["name"], updatedAt = (string?)p["updatedAt"], revision = (long?)p["revision"] ?? 0, tableCount = p["tables"]!.AsArray().Count });
            }
            return items;
        }
        finally { gate.Release(); }
    }
    public async Task<JsonObject?> Save(Guid id, JsonObject body)
    {
        await gate.WaitAsync();
        try
        {
            var previous = await Read(id);
            var revision = (long?)previous?["revision"] ?? 0;
            if ((long?)body["revision"] != revision) return null;
            body["revision"] = revision + 1;
            body["updatedAt"] = DateTimeOffset.UtcNow.ToString("O");
            var temporary = FilePath(id) + ".tmp";
            await File.WriteAllTextAsync(temporary, body.ToJsonString(jsonOptions));
            File.Move(temporary, FilePath(id), overwrite: true);
            return body;
        }
        finally { gate.Release(); }
    }
    public async Task<bool> Delete(Guid id, long revision)
    {
        await gate.WaitAsync();
        try
        {
            var previous = await Read(id);
            if (previous == null || (long?)previous["revision"] != revision) return false;
            // Keep a recoverable copy outside the active project list.
            File.Move(FilePath(id), FilePath(id) + $".{DateTime.UtcNow.Ticks}.deleted");
            return true;
        }
        finally { gate.Release(); }
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
            var columns = new Dictionary<string, (string Table, string Type, bool Key, bool Unique, bool Nullable)>();
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
                    columns.Add(cid, (tid, type, pk && cols.Count(x => (bool)x!["primaryKey"]!) == 1, unique, nullable));
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
            }
            return null;
        }
        catch (Exception e) when (e is InvalidOperationException or FormatException or NullReferenceException or ArgumentException or OverflowException)
        { return "Struktur schema tidak valid."; }
    }
}
