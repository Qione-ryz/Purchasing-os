# PurchaseOS — Ringkasan Struktur Proyek

## Stack
- **Frontend:** HTML + Vanilla JS (tanpa framework)
- **Backend/DB:** Supabase (PostgreSQL)
- **Hosting:** Netlify
- **Auth:** Supabase Auth
- **CSS:** style.css + theme.css (shared), inline `<style>` per halaman
- **Font:** DM Sans (body), DM Mono (kode/label)

---

## Struktur File

| File | Fungsi |
|------|--------|
| `index.html` | Login & Register. Redirect ke dashboard jika sudah login. |
| `dashboard.html` | Ringkasan statistik, grafik pembelian, top barang, top spend, vendor kasta, activity feed. Multi-brand selector di topbar. |
| `barang.html` | Master barang/SKU. CRUD barang, filter brand & kategori, harga terakhir, satuan order per barang, duplikat checker. |
| `vendor.html` | Master vendor/supplier. CRUD vendor, view tabel & kartu, filter brand/kota/status. |
| `pembelian.html` | Transaksi pembelian. Form beli baru, riwayat, edit, hapus, export Excel. Multi-select item, diskon nominal/persen. |
| `harga.html` | Riwayat harga. Grafik tren & tabel banding antar vendor. Filter barang, brand, vendor, periode. |
| `import.html` | Import massal dari Excel/CSV untuk barang, vendor, pembelian, dan harga. |
| `stock-opname.html` | Opname stok, pemakaian, perencanaan pembelian (purchase plan), realisasi. Navigasi per bulan. |
| `ordermasuk.html` | Admin view: terima & proses order dari brand. Inline panel per order, integrasi WhatsApp, update riwayat harga. |
| `order.html` | Brand-facing: buat & kelola order barang. Login pakai kode pemesan. Dual render desktop/mobile. |
| `settings.html` | Pengaturan brand, user/role, profil, PPN, satuan, kategori, kode order (pemesan), activity log, hapus data, tema. |
| `sidebar.js` | Shared sidebar component. Panggil `renderSidebar(activePage, brandLabel, onchange)` di setiap halaman. |
| `auth.js` | Helper role: `getUserRole()`, `applyRoleUI()`, `requireAdmin()`. |
| `logger.js` | Helper log aktivitas: `logActivity(aksi, tipe, targetNama, detail)`. |
| `ppn.js` | Helper PPN: `loadPPNRate()`, `toIncPPN()`, `toExcPPN()`, `applyTheme()`. |
| `style.css` | Shared stylesheet — layout, komponen, tabel, modal, badge, caret select global, dll. |
| `theme.css` | Override light mode. Include setelah style.css. |

---

## Struktur Database (Tabel Supabase)

### Core
| Tabel | Kolom Penting |
|-------|---------------|
| `brands` | id, nama, warna |
| `barang` | id, nama, sku, satuan, kategori, deskripsi, stok_minimum, updated_at |
| `barang_brands` | barang_id, brand_id *(many-to-many)* |
| `satuan` | id, nama *(master satuan, dikelola di settings)* |
| `kategori` | id, nama *(master kategori barang, dikelola di settings)* |
| `barang_satuan_order` | barang_id, satuan, faktor *(satuan order & faktor konversi per barang)* |
| `vendor` | id, nama, kode, kategori, pic, telepon, email, kota, provinsi, alamat, npwp, termin, catatan, aktif, updated_at |
| `vendor_brands` | vendor_id, brand_id *(many-to-many)* |

### Transaksi
| Tabel | Kolom Penting |
|-------|---------------|
| `riwayat_beli` | id, tanggal, nomor_faktur, vendor_id, brand_id, status, ppn_included, diskon, diskon_mode, ongkir, subtotal, total, catatan, updated_at |
| `riwayat_beli_items` | id, beli_id, barang_id, nama, sku, satuan, brand_id, qty, harga_satuan, harga_exc_ppn, harga_inc_ppn, ppn_included, subtotal |
| `riwayat_harga` | id, barang_id, barang_nama, barang_sku, vendor_id, brand_id, harga, harga_exc_ppn, harga_inc_ppn, ppn_included, qty, tanggal, sumber ('pembelian'/'survey'), beli_id, catatan |

### Order Barang (Brand → Admin)
| Tabel | Kolom Penting |
|-------|---------------|
| `pemesan` | id, kode, nama, brand_id, created_at *(akun brand untuk order.html)* |
| `pemesan_config` | id, pemesan_id, key, value, updated_at *(konfigurasi per pemesan, mis. barang_tampil)* |
| `orders` | id, pemesan_id, brand_id, catatan, status ('pending'/'partial'/'selesai'/'cancelled'), created_at |
| `order_items` | id, order_id, barang_id, nama_barang, satuan, satuan_db, faktor_konversi, qty_order, qty_terpenuhi, harga_estimasi, is_custom, status_custom, created_at |

### Stok & Perencanaan
| Tabel | Kolom Penting |
|-------|---------------|
| `stock_opname` | id, barang_id, brand_id, tahun, bulan, stok |
| `purchase_plan` | id, barang_id, brand_id, tahun, bulan, qty_plan |

### Sistem
| Tabel | Kolom Penting |
|-------|---------------|
| `profiles` | id (= auth.user.id), role ('admin'/'user') |
| `app_settings` | key, value, updated_at — saat ini: key='ppn_rate' |
| `activity_log` | id, user_id, user_nama, user_email, aksi, tipe, target_nama, detail, created_at |

---

## Global Variables (window.*)

| Variable | Tipe | Diisi di | Isi |
|----------|------|----------|-----|
| `window._sb` | Supabase client | Setiap halaman | Instance Supabase |
| `window._ppnRate` | number | `ppn.js` → `loadPPNRate()` | PPN rate, default 11 |
| `window._userRole` | string | `auth.js` → `applyRoleUI()` | 'admin' atau 'user' |
| `window.allBrands` | array | Setiap halaman | Semua brand dari tabel brands |
| `window.allBarang` | array | barang.html, vendor.html, pembelian.html | Semua barang |
| `window.allVendors` | array | pembelian.html, import.html | Semua vendor |
| `window.allData` | array | Per halaman | Data utama halaman (barang/vendor/dll) |
| `window.allSatuan` | array | barang.html | Master satuan dari tabel `satuan` |
| `window.allKategori` | array | barang.html | Master kategori dari tabel `kategori` |
| `window.barangMap` | object | import.html, pembelian.html | `{ nama_lower: objek_barang }` |
| `window.vendorMap` | object | import.html, pembelian.html | `{ nama_lower: objek_vendor }` |
| `window.hargaCache` | object | barang.html | `{ barang_id: { vendor_id: harga } }` |
| `window.hargaTerakhirMap` | object | barang.html | `{ barang_id: harga_inc_terakhir }` |
| `window.vendorGhostCache` | object | vendor.html, barang.html, pembelian.html | `{ vendor_id: nama }` — vendor non-aktif |

---

## localStorage & sessionStorage

| Key | Tipe | Dipakai di | Isi |
|-----|------|-----------|-----|
| `activeBrand` | localStorage | Semua halaman admin | Brand aktif saat ini (id string atau 'all') |
| `activeBrands` | localStorage | dashboard.html, harga.html | Array brand yang dipilih (multi-select) |
| `appTheme` | localStorage | ppn.js, settings.html, ordermasuk.html | 'dark' atau 'light' |
| `sysPref` | localStorage | settings.html | Preferensi sistem lain |
| `soBarangConfig` | localStorage | stock-opname.html | Konfigurasi tampilan barang opname |
| `_hargaCache` | localStorage | barang.html, pembelian.html | Cache harga per barang per vendor |
| `_c_barang` | localStorage | pembelian.html | Cache list barang |
| `_c_vendors` | localStorage | pembelian.html | Cache list vendor |
| `vendorGhostCache` | localStorage | barang.html, vendor.html, pembelian.html | Cache nama vendor non-aktif |
| `userRole` | sessionStorage | index.html, auth.js, settings.html | Role user ('admin'/'user') |
| `_fromPage` | sessionStorage | barang.html, vendor.html, pembelian.html | Halaman asal untuk navigasi kembali |

---

## Pola Umum

### Auth & Role
- Setiap halaman cek session di awal, redirect ke `index.html` jika belum login
- Role diambil dari `sessionStorage('userRole')`, fallback fetch tabel `profiles`
- Elemen dengan class `admin-only` disembunyikan otomatis untuk role 'user'
- `requireAdmin(showToastFn)` dipakai sebelum aksi destructive

### Brand Filter
- Brand aktif disimpan di `localStorage('activeBrand')`
- Sidebar tiap halaman punya `<select id="brandSelect">` untuk ganti brand
- Filter `'all'` = tampilkan semua brand
- Dashboard & harga.html: multi-brand selector (disimpan di `activeBrands`)

### Script yang Wajib Di-include (urutan penting)
```html
<link rel="stylesheet" href="style.css"/>
<link rel="stylesheet" href="theme.css"/>
<script src="sidebar.js"></script>   <!-- harus setelah theme.css -->
<!-- di akhir body: -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/..."></script>
<script src="https://cdn.jsdelivr.net/npm/xlsx/..."></script> <!-- jika butuh Excel -->
<script src="auth.js"></script>
<script src="logger.js"></script>
<script src="ppn.js"></script>
```

### Sidebar
- Sidebar di-render dinamis via `sidebar.js` — tidak lagi hardcode per halaman
- Panggil `renderSidebar(activePage, brandLabel, onchange)` tepat setelah cek session di init
- HTML sidebar di setiap halaman cukup: `<aside class="sidebar" id="sidebar"></aside>`
- Untuk tambah/ubah menu, cukup edit array `_SIDEBAR_NAV` di `sidebar.js`

| Parameter | Nilai |
|-----------|-------|
| `activePage` | nama file halaman, misal `'barang.html'` |
| `brandLabel` | `'Filter Brand'` (barang.html) atau `'Brand aktif'` (halaman lain) |
| `onchange` | `'onBrandChange()'` untuk halaman dengan filter brand, kosong `''` untuk import & settings |

### CSS — Caret Select
- `style.css` menginjeksi caret SVG custom secara global via `select { background-image: ... }`
- **Jangan** pakai `background` shorthand pada rule atau inline style yang menyertakan `<select>` — akan me-reset `background-image` dan menghilangkan caret
- Gunakan `background-color: var(--bg)` (bukan `background: var(--bg)`)
- Halaman yang diketahui bermasalah dan perlu difix: `ordermasuk.html` (baris 147), `harga.html` (baris 21), `barang.html` (baris 1667), `pembelian.html` (baris 568 & 585), `settings.html` (baris 499, 521, 543, 634, 667)
- `order.html` standalone (tidak pakai style.css) — select di-handle via class `.satuan-sel` dan `.satuan-sel.alt`

### PPN
- Rate disimpan di tabel `app_settings` key='ppn_rate', default 11%
- Dua mode: `exc` (harga belum termasuk PPN) dan `inc` (sudah termasuk)
- Helper: `toIncPPN(hargaExc)` dan `toExcPPN(hargaInc)` dari ppn.js

### Import Pembelian — Grouping Logic
- Baris dikelompokkan per transaksi dengan key: `tanggal + nomor_faktur + vendor + brand`
- Barang/vendor tidak ditemukan → **auto-insert** ke DB (bukan error)
- Barang baru: satuan default `'pcs'`
- Vendor baru: aktif = true, field lain kosong

### Duplikat Mode (Barang & Vendor)
- Radio button: **skip** (default) atau **update**
- Barang: update hanya field yang diisi & berbeda dari data lama

### Toast & Error
- `showToast(msg, type)` — type: 'success' atau 'error', timeout 3500ms
- `showModalError(msg)` — tampil di dalam modal form

### Activity Log
- `logActivity(aksi, tipe, targetNama, detail)` dari logger.js
- Dipanggil setelah operasi penting (tambah/edit/hapus)
- Aksi contoh: 'tambah', 'edit', 'hapus'
- Tipe contoh: 'barang', 'vendor', 'pembelian'

### Tema
- Dark mode (default) / Light mode
- Disimpan di `localStorage('appTheme')`
- Toggle di settings.html → `setTheme(mode)`
- `applyTheme()` di ppn.js dipanggil langsung saat load untuk mencegah flash

### Cache localStorage
- `_hargaCache` — harga per barang per vendor (di-invalidate setelah import)
- `_c_barang` — cache barang
- `_c_vendors` — cache vendor
- `clearLocalCache()` di settings.html untuk reset manual

---

## Halaman: Fitur Spesifik

### order.html (Brand-facing)
- **Standalone** — tidak pakai style.css/theme.css/sidebar.js. CSS & auth sendiri.
- Login via kode pemesan (tabel `pemesan`), bukan Supabase Auth
- Tab: **Buat Order** | **Order Saya** (Aktif · Dibatalkan · Selesai)
- Dual render: tabel desktop + card mobile (breakpoint `≤700px`)
- Satuan order pakai class `.satuan-sel` (bukan inline style) untuk caret
- Fitur edit & batalkan order (hanya status `pending`)
- Barang yang tampil bisa dikonfigurasi per pemesan (tabel `pemesan_config`)
- IndexedDB dipakai untuk cache lokal barang & harga
- Konversi satuan: `barang_satuan_order` → tampilkan harga & qty dalam satuan order

### ordermasuk.html (Admin)
- Menerima & memproses order dari brand (tabel `orders` + `order_items`)
- Filter: multi-brand, status (pending/partial/selesai/dibatalkan)
- Stat bar: jumlah order pending, partial, selesai
- Inline panel per order — detail item langsung di bawah row tabel
- Fitur **Order via WA**: generate pesan WhatsApp ke vendor, pilih vendor per order
- Proses item: update `qty_terpenuhi`, auto-update status order
- Bisa input harga aktual → update `riwayat_harga`
- Tab tersembunyi untuk order dibatalkan (`_showCancelled` toggle)

### barang.html
- Filter: brand, kategori, search nama/sku
- Kolom kategori bisa diklik langsung untuk ganti kategori (inline picker)
- Master satuan order per barang (`barang_satuan_order`): bisa tambah multiple satuan + faktor konversi
- Duplikat checker saat import
- Cache harga terakhir per barang (`hargaTerakhirMap`)

### pembelian.html
- Form beli: pilih brand → vendor (autocomplete) → tambah item (dropdown search)
- Item bisa ditambah satu per satu atau multi-select sekaligus
- Diskon: mode nominal (Rp) atau persen (%)
- PPN: per transaksi, mode exc/inc
- Edit riwayat: bisa ubah item, qty, harga, diskon, ongkir
- Export: Excel via SheetJS

### harga.html
- Dua sumber: 'pembelian' (dari `riwayat_beli`) dan 'survey' (input manual)
- Tab: **Tren** (grafik per barang) | **Banding** (tabel semua vendor) | **Tabel** (semua data mentah)
- Filter: per barang, brand, vendor, periode, mode PPN
- Multi-brand selector
- Export Excel

### stock-opname.html
- Tab: **Opname** | **Pemakaian** | **Perencanaan** | **Realisasi**
- Navigasi per bulan
- Purchase plan: qty rencana per barang per bulan
- Pemakaian dihitung dari stok bulan lalu + pembelian - stok sekarang
- Export Excel

### settings.html
- Panel: **Brand** | **Pengguna** | **Profil** | **Preferensi** | **PPN** | **Satuan** | **Kategori** | **Kode Order** | **Activity Log** | **Hapus Data** | **Import**
- Brand: CRUD + assign warna + assign barang/vendor
- Satuan & Kategori: CRUD master (dipakai di barang.html & order.html)
- Kode Order (Pemesan): CRUD kode brand untuk order.html, generate kode otomatis
- Hapus Data: per brand atau semua, dengan konfirmasi
- Tema: toggle dark/light

### dashboard.html
- Multi-brand selector (semua / pilih beberapa brand)
- Stat cards: total pembelian, jumlah transaksi, rata-rata per transaksi, vendor aktif
- Grafik pembelian per bulan (Chart.js)
- Top barang & top vendor by spend
- Activity feed terbaru
