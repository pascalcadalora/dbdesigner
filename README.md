# Schema Studio

Editor schema database visual menggunakan **ASP.NET Core (.NET 10)** dan **React 19 / Next.js 16**. Input melalui form dan drag-and-drop; tidak perlu menulis SQL.

## Jalankan / redeploy

Prasyarat: .NET SDK 10, Node.js 24 dan npm. Dari folder project:

```powershell
.\main_control.bat
```

Pilih **4**. Pada Linux/macOS:

```bash
bash main_control.sh
```

Opsi yang sama tersedia sebagai command langsung:

```powershell
.\main_control.bat deploy
.\main_control.bat status
.\main_control.bat stop
.\main_control.bat check
```

| Service | Alamat tetap |
| --- | --- |
| Aplikasi | http://127.0.0.1:3080 |
| API health | http://127.0.0.1:5180/api/health |

Opsi 4 mengikuti pola `FinancialDashboard/main_control`: menghentikan instance sebelumnya, restore dependency, publish C#, build production frontend, dan start dengan port eksplisit. Controller memverifikasi PID/token launcher sebelum menghentikan process tree. Jika port dipakai proses lain, deployment berhenti dengan error; tidak pindah ke port lain. Lock mencegah dua operasi controller bersamaan. Proses berjalan di background tanpa membuka terminal tambahan. Startup gagal akan membersihkan instance yang baru dijalankan.

Port 3080/5180 sengaja terpisah dari FinancialDashboard 3000/5080. Log ada di `.runtime/api.log` dan `.runtime/web.log`. Restart komputer memerlukan menjalankan opsi 4 lagi; belum ada autostart service. Binding default localhost, untuk penggunaan lokal. Versi awal belum menyediakan login atau kolaborasi realtime.

## Menggunakan editor

- Workspace pertama menampilkan contoh commerce (5 tabel dan 4 relasi). Buka **My workspace → Project baru** untuk diagram kosong.
- **Tambah tabel**: isi nama, kolom, tipe, PK, NN (NOT NULL), UQ (UNIQUE), default, warna, dan catatan. Double-click tabel untuk mengedit.
- Setiap kolom mendukung **Nama Tampilan** (label yang terlihat pada diagram; nama teknis tetap disimpan), **Deskripsi Kolom**, dan **Dihasilkan Otomatis oleh Sistem**. Checklist tersebut membuka **Format Nilai Otomatis** dan pratinjau. Contoh `{SEQ:5}/INV/{MM}/{YYYY}` → `00001/INV/09/2026`. `SEQ` berarti nomor urut, `:5` panjang minimum 5 digit (1–9), `DD` hari, `MM` bulan, `YYYY` tahun. Contoh memakai nomor 1 dan tanggal 22 September 2026. Metadata disimpan dalam JSON dan disertakan sebagai komentar pada SQL, bukan trigger/default yang mengeksekusi generator. Aturan reset nomor dan implementasi generator menjadi tanggung jawab aplikasi pengguna schema. Project lama tetap kompatibel.
- Drag header tabel untuk memindahkannya. Drag area kosong untuk pan. Scroll atau gunakan toolbar untuk zoom; **Fit diagram** menampilkan seluruh diagram. Mini-map dapat diklik untuk navigasi.
- Tarik titik di sisi kolom **PK tunggal/UNIQUE** ke titik kolom **FK** tujuan, lalu pilih cardinality. Tipe data harus sama. Satu kolom FK hanya dapat memiliki satu referensi.
- **Tambah relasi → many-to-many** membuat tabel penghubung dengan composite primary key dan dua foreign key. Untuk composite foreign key, versi ini belum mendukung pasangan multikolom.
- Pilih tabel atau garis untuk melihat properti. Hapus tabel memerlukan konfirmasi dan ikut menghapus relasinya. Kolom yang direferensikan harus dilepas relasinya sebelum dihapus.
- `Ctrl+Z`: Undo; `Ctrl+Y` / `Ctrl+Shift+Z`: Redo; `Ctrl+S`: Simpan; `Delete`: hapus seleksi. Riwayat 80 perubahan disimpan selama sesi editor.
- Autosave setelah 900 ms. Status gagal menyimpan ditampilkan dan perubahan tetap di editor. Export JSON sebagai backup sebelum menutup tab jika server belum tersedia. Konflik antarsesi tidak ditimpa otomatis; gunakan **Muat ulang** setelah menyimpan backup bila diperlukan.
- **Export schema**: JSON menyimpan diagram lengkap; SQL menghasilkan DDL PostgreSQL/MySQL/SQL Server. **Import** JSON membuat project baru, tidak mengganti project lama.
- Default teks diisi tanpa tanda kutip. Default numerik harus angka, boolean `true/false/1/0`, dan default tanggal/waktu mendukung `CURRENT_TIMESTAMP`. SQL adalah output untuk ditinjau; aplikasi tidak menjalankan DDL terhadap database. Dialect mapping tidak mencakup semua fitur database (mis. index khusus, identity, composite FK, dan expression default bebas).

## Penyimpanan

Project disimpan di PostgreSQL FinancialDashboard, dalam schema khusus `schema_studio` dan tabel `schema_studio.projects`. Dokumen diagram disimpan sebagai `jsonb`, dengan pemeriksaan nomor revisi untuk mencegah overwrite antarsesi. Hapus project adalah soft-delete (`deleted_at`), sehingga data masih tersedia untuk pemulihan oleh administrator. Saat startup pertama, aplikasi mengimpor idempotent semua file lama yang masih aktif dari `api/App_Data/<id>.json`; file tersebut dibiarkan sebagai backup dan tidak lagi menjadi sumber utama. Backup PostgreSQL FinancialDashboard sekarang juga mencakup schema ini.

## Dependency referensi

`web/package-lock.json` disalin **identik** dari `D:\Workspace\My Project\FinancialDashboard\src\web\package-lock.json`. SHA-256 saat implementasi:

```text
88249508EF4DCB71E5B4D7407D7B2343131FB5C5A1005F755E4A6EC5B85CDF09
```

`package.json` memakai dependency dan versi yang sama; hanya script dev/start yang dikunci ke port 3080. Dependency bawaan referensi yang tidak dipakai editor tetap ada agar lockfile utuh. Diagram dibuat dengan React + SVG, tanpa library diagram tambahan. Font web bersifat opsional, dengan fallback Segoe UI/sans-serif.

## Development & verifikasi

Hentikan production dahulu (`main_control.bat stop`) agar port tetap tersedia. Jalankan dalam dua terminal:

```powershell
dotnet run --project api/SchemaStudio.Api.csproj --urls http://127.0.0.1:5180
npm --prefix web run dev
```

Script developer juga memakai port eksplisit dan akan gagal jika port terpakai. Jangan menjalankan mode development bersamaan dengan deploy production pada workspace yang sama. Hentikan terminal development sebelum opsi 4.

```powershell
node scripts/control.mjs check
node scripts/smoke-api.mjs
node scripts/smoke-deploy.mjs
```

`check` menjalankan build C#, typecheck, lint, serta unit/component tests. `smoke-api` memerlukan aplikasi berjalan; membuat project uji sementara dan menghapusnya dari daftar setelah selesai. `smoke-deploy` benar-benar menghentikan/redeploy service lokal, memeriksa persistensi dan benturan port, lalu meninggalkan aplikasi berjalan. Jangan jalankan saat sedang mengedit perubahan yang belum disimpan.

Pengujian Windows mencakup production build, API CRUD/validasi/revisi, komponen editor, dan lifecycle deploy. Browser interaktif tidak tersedia pada sesi implementasi, sehingga tampilan/pointer belum diverifikasi pada browser nyata. Wrapper Bash disediakan tetapi lifecycle Linux/macOS belum dieksekusi di lingkungan Windows ini.

## Struktur

```text
api/Program.cs                 REST API, validasi, penyimpanan PostgreSQL
web/components/Editor.tsx      State, undo/redo, autosave, project, import/export
web/components/Diagram.tsx     Canvas, pan/zoom, drag tabel, SVG relasi, minimap
web/components/*Dialog.tsx     Form tabel dan relasi
web/lib/schema.ts             Model, validasi, junction table, SQL export
scripts/control.mjs           Controller deploy lintas platform
scripts/run-service.mjs       Launcher background dengan port tetap
main_control.bat / .sh         Menu utama
```

API tersedia di `GET /api/projects`, `GET /api/projects/{id}`, `PUT /api/projects/{id}` (create/update dengan revision), dan `DELETE /api/projects/{id}?revision=N`. Frontend mem-proxy `/api/*` ke API lokal.
