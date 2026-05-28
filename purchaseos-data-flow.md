# PurchaseOS — Data Flow & Database Schema

> Dibuat dari analisis 14 halaman HTML | Backend: Supabase (PostgreSQL)

---

## Daftar Halaman

| Halaman | Fungsi | Aktor |
|---|---|---|
| `index.html` | Login / Register / Reset password | Semua |
| `dashboard.html` | Overview analytics & statistik | Admin + Pemesan |
| `settings.html` | Manajemen brand, user, role | Admin only |
| `barang.html` | CRUD master barang / SKU | Admin only |
| `vendor.html` | CRUD master vendor / supplier | Admin only |
| `harga.html` | Analisis tren harga (read-only) | Admin |
| `pembelian.html` | Catat transaksi pembelian | Admin only |
| `order.html` | Buat order kebutuhan | Pemesan (non-admin) |
| `ordermasuk.html` | Proses & realisasi order masuk | Admin |
| `inventory.html` | Kelola stok real-time, transfer antar brand | Pemesan |
| `stock-opname.html` | Opname bulanan + Purchase Plan | Admin |
| `pastry.html` | CRUD produk & riwayat pastry | Admin |
| `import.html` | Import massal dari Excel/CSV | Admin |
| `merge-vendor.html` | Merge vendor duplikat | Admin |

---

## Database Tables (27 Tabel)

### 1. Auth & Config
```
profiles          — id, role, nama, email, created_at
pemesan           — id, kode, nama, brand_id
pemesan_config    — pemesan_id, key, value, brand_id
```

### 2. Master Data
```
brands            — id, nama, warna, aktif
barang            — id, nama, sku, satuan (dasar), kategori, stok_min, deskripsi
vendor            — id, nama, kode, pic, telp, email, kota, provinsi, npwp, termin, kontak(JSON), aktif, catatan
satuan            — id, nama  (pcs, kg, ltr, dll)
kategori          — id, nama  (ATK, elektronik, dll)
pastry            — id, nama, satuan, updated_at
```

### 3. Relasi / Junction
```
barang_brands          — barang_id, brand_id           (M:N barang ↔ brands)
vendor_brands          — vendor_id, brand_id           (M:N vendor ↔ brands)
barang_satuan_order    — barang_id, satuan, faktor      (satuan alternatif per barang)
barang_barcodes        — id, barang_id, barcode         (1 barang → banyak barcode)
so_item_groups         — id, nama, primer_barang_id
so_item_group_members  — group_id, barang_id
```

### 4. Transaksi Pembelian
```
riwayat_beli        — id, vendor_id, brand_id, tanggal, nomor_faktur,
                       total, diskon, ongkir, ppn_included, status, catatan
riwayat_beli_items  — id, beli_id, barang_id, nama(snapshot), qty, satuan,
                       harga_satuan, harga_exc_ppn, harga_inc_ppn
riwayat_harga       — id, barang_id, vendor_id, brand_id, harga,
                       harga_exc/inc_ppn, sumber(pembelian|survey), beli_id, tanggal
pastry_riwayat      — id, pastry_id, tanggal, qty, catatan, brand_id
```

### 5. Order Flow
```
orders       — id, brand_id, pemesan_id, status, catatan, created_at, selesai_at
order_items  — id, order_id, barang_id, nama_barang(snapshot), qty_order, satuan,
               satuan_db, faktor_konversi, status_item, draft_beli_id(FK nullable)
```

### 6. Inventory
```
inventory_stock           — brand_id, barang_id, qty, min_qty, updated_at
inventory_log             — id, brand_id, barang_id, tipe(masuk|keluar|transfer_in|transfer_out|transfer_return),
                             qty, catatan, oleh(kode pemesan), ref_id, tanggal
inventory_transfer        — id, no_sj, dari_brand, ke_brand, status, tanggal
inventory_transfer_items  — id, transfer_id, barang_id, nama_barang, satuan, qty
```

### 7. Stock Opname & Planning
```
stock_opname   — periode(YYYY-MM), brand_id, barang_id, stok_akhir   [unique: periode+brand+barang]
purchase_plan  — periode(YYYY-MM), brand_id, barang_id, qty_plan
so_barang_config — brand_id, included_ids, plan_exclude_ids
```

---

## Data Flow per Halaman

### `index.html`
- **READ** `profiles` (cek role setelah login)
- **AUTH** `signIn`, `signUp`, `resetPasswordForEmail`
- → redirect ke `dashboard.html`

### `dashboard.html`
- **READ** `brands`, `vendor`, `barang`, `barang_brands`, `vendor_brands`
- **READ** `riwayat_beli` — stats total, chart bulanan, aktivitas terbaru
- **READ** `riwayat_beli_items` — top barang, top vendor

### `settings.html`
- **CRUD** `brands`
- **READ/UPDATE** `profiles` (role management)
- **WRITE** `barang_brands`, `vendor_brands` — assign barang/vendor ke brand
- **AUTH** `signUp` (undang user baru), `updateUser`

### `barang.html`
- **CRUD** `barang`
- **WRITE** `barang_brands` (sync per save)
- **CRUD** `barang_barcodes`
- **WRITE** `barang_satuan_order` (satuan alternatif)
- **READ** `riwayat_beli_items` (histori harga di detail)
- **CRUD** `riwayat_harga` sumber=survey (catat harga manual)
- **READ** `satuan`, `kategori`, `vendor`

### `vendor.html`
- **CRUD** `vendor`
- **WRITE** `vendor_brands` (sync per save)
- **READ** `riwayat_harga` (histori harga vendor di detail)
- **READ** `brands`, `barang`
- Export CSV/Excel

### `harga.html` (read-only)
- **READ** `riwayat_harga` (sumber: pembelian + survey)
- **READ** `riwayat_beli_items` + join ke `riwayat_beli`
- **READ** `vendor`, `barang`, `barang_brands`
- Tab: Tren harga | Tabel ringkasan | Perbandingan vendor

### `pembelian.html`
- **WRITE** `riwayat_beli` (header faktur)
- **WRITE** `riwayat_beli_items` (detail item)
- **WRITE** `riwayat_harga` sumber=pembelian (auto dari setiap item)
- **READ** `brands`, `vendor`, `barang`, `barang_satuan_order`
- **DELETE** `riwayat_beli` + cascade items + harga
- Quick-add vendor/barang inline tanpa keluar halaman
- Kalkulasi: PPN, diskon, ongkir, harga exc/inc otomatis

### `order.html`
- **WRITE** `orders` (buat order baru)
- **WRITE** `order_items` (item per order)
- **READ** `barang` (filter by brand pemesan)
- **READ** `barang_satuan_order` (satuan alternatif)
- **READ** `riwayat_harga` (last price hint)
- **WRITE** `pemesan_config` (simpan preferensi barang)
- Draft disimpan ke **IndexedDB** lokal (prevent data loss)
- Mode pemesan (non-admin, hanya bisa lihat brand sendiri)

### `ordermasuk.html`
- **READ** `orders`, `order_items`, `pemesan`
- **UPDATE** `orders.status` (pending → selesai | cancelled | archived)
- **UPDATE** `order_items.status_item`
- **WRITE** `riwayat_beli` + `riwayat_beli_items` (realisasi pembelian dari order)
- **UPDATE** `order_items.draft_beli_id` = beli_id (link order ke transaksi)
- **READ** `vendor` (generate template WA per vendor)
- Kirim order via WhatsApp: by vendor group atau manual

### `inventory.html`
- **READ** `brands`, `barang`, `inventory_stock`
- **UPSERT** `inventory_stock` (update qty setelah transaksi IO masuk/keluar)
- **WRITE** `inventory_log` (setiap perubahan stok tercatat)
- **WRITE/READ** `inventory_transfer` + `inventory_transfer_items`
- **READ** `barang_barcodes` (scan barcode → auto-select item)
- **READ** `satuan` (untuk modal Barang Bebas di transfer)
- Login via kode pemesan (bukan email)
- Tipe log: `masuk`, `keluar`, `transfer_out`, `transfer_in`, `transfer_return`
- Transfer mendukung dua tipe item tambahan:
  - **Untracked** — barang ada di DB tapi tidak dikonfigurasi di inventory brand; `inventory_stock` tidak diupdate, tetap muncul di surat jalan
  - **Barang Bebas** — item ad-hoc kustom (nama + satuan + qty), tidak ada di DB sama sekali; `inventory_stock` tidak diupdate, hanya tercatat di `inventory_transfer_items`
- Date filter pakai **month-grid picker** (bukan `<input type="month">`) untuk tab Stok, Transfer, Audit, Pastry
- Pastry IO: layout 2-baris di keranjang (nama + pilih tipe di atas, qty ctrl di bawah)

### `stock-opname.html`
- **UPSERT** `stock_opname` (catat stok akhir per bulan per brand)
- **UPSERT** `purchase_plan` (rencana pembelian bulan depan)
- **READ** `riwayat_beli_items` (hitung total pembelian per periode)
- **CRUD** `so_item_groups` + `so_item_group_members`
- **UPSERT** `so_barang_config` (konfigurasi barang yang diinclude)
- Formula pemakaian: Stok Awal + Pembelian − Stok Akhir
- Formula rekomendasi: Rata-rata Pakai − Stok Akhir + buffer%

### `pastry.html`
- **CRUD** `pastry`
- **CRUD** `pastry_riwayat`
- **READ** `brands`
- Entitas terpisah dari `barang`

### `import.html`
- **WRITE** `barang` + `barang_brands` (import dari Excel/CSV)
- **WRITE** `vendor` + `vendor_brands`
- **WRITE** `riwayat_beli` + `riwayat_beli_items`
- **WRITE** `riwayat_harga`
- Mode duplikat: skip atau update
- Preview data sebelum import, download template

### `merge-vendor.html`
- **READ** `vendor` (search duplikat)
- **UPDATE** `riwayat_beli.vendor_id` → vendor_keep
- **UPDATE** `riwayat_harga.vendor_id` → vendor_keep
- **UPSERT** `vendor_brands` (merge brand assignments)
- **DELETE** `vendor` (hapus duplikat yang dipilih)
- Step-by-step: pilih → preview dampak → eksekusi

---

## Key Architectural Patterns

### Multi-brand isolation
Hampir semua tabel transaksi menyimpan `brand_id`. Filter by brand diterapkan di hampir semua query, memungkinkan satu instance sistem digunakan oleh beberapa brand/outlet.

### Dual price log
`riwayat_harga` menerima data dari dua jalur:
- **pembelian** — otomatis dibuat setiap transaksi pembelian dicatat (`beli_id` diisi)
- **survey** — entri manual dari barang.html atau import (`beli_id` = null)

### Order → Beli bridge
`order_items.draft_beli_id` menjadi foreign key ke `riwayat_beli` saat admin di `ordermasuk.html` mencatat realisasi pembelian. Ini menghubungkan order permintaan dengan transaksi aktual.

### Snapshot nama
`riwayat_beli_items` dan `order_items` menyimpan `nama` barang sebagai snapshot text. Aman terhadap perubahan nama di master data.

### Role-based UI
- **Admin** — akses penuh CRUD semua data
- **Pemesan** — hanya bisa buat order (order.html) dan input inventory (inventory.html)
- Kontrol via `profiles.role` di Supabase, UI elements dengan class `admin-only`

### IndexedDB local draft
`order.html` menyimpan draft order ke IndexedDB browser. Mencegah kehilangan data jika halaman di-refresh atau koneksi terputus sebelum submit.

### Satuan konversi
`barang_satuan_order` menyimpan satuan alternatif + faktor konversi per barang. Contoh: 1 dus = 12 pcs. Digunakan di form order dan pembelian.

---

### Page Loader
`loader.js` — full-page overlay saat init. Muncul seketika saat HTML load, fade-out setelah data pertama selesai render. Safety timeout 5 detik. Dipakai di 12 halaman: `barang`, `dashboard`, `vendor`, `pembelian`, `harga`, `stock-opname`, `ordermasuk`, `order`, `inventory`, `pastry`, `settings`, `import`.

### Transfer: Tracked vs Untracked vs Bebas
`inventory.html` membagi item transfer menjadi 3 kategori:
- **Tracked** — barang ada di DB + ada di konfigurasi inventory brand → stok di `inventory_stock` dikurangi/ditambah
- **Untracked** — barang ada di DB tapi tidak dikonfigurasi di brand (di luar `_cfgBarangSelected`) → tampil dengan badge `∞`, qty bebas, **tidak update stok**
- **Barang Bebas** (`is_custom: true`) — item ad-hoc tidak ada di DB, dibuat langsung di modal → **tidak update stok**, hanya dicatat nama/satuan/qty di transfer items

### Month-grid Date Picker
`inventory.html` menggunakan custom month-grid picker (year nav + 4×3 grid bulan + tombol Apply) menggantikan `<input type="month">` bawaan browser. State: `_mgYear`, `_mgFrom`, `_mgTo`. Dipakai untuk semua tab filter tanggal: Stok, Transfer, Audit, Pastry.

---

*Total: 14 halaman | 27 tabel | Backend: Supabase (PostgreSQL + Auth)*
