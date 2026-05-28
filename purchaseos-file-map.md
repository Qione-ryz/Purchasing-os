# PurchaseOS — Peta File JS ↔ HTML

## Keterangan warna / kategori
- **Shared** — diload di hampir semua halaman
- **Page-specific** — hanya untuk halaman tertentu
- **Utility / config** — konfigurasi & service worker
- **Baru** — ditambahkan untuk fitur Opsi A (nama barang terkini)

---

## Per halaman HTML

### Auth & Entry
| HTML | JS yang diload |
|---|---|
| `index.html` | `config.js`, `auth.js`, `ppn.js`, `sidebar.js` |

### Backoffice
| HTML | JS yang diload |
|---|---|
| `dashboard.html` | `config.js`, `auth.js`, `ppn.js`, `barang-helper.js` ⭐, `sidebar.js`, `datefilter.js` |
| `barang.html` | `config.js`, `auth.js`, `ppn.js`, `logger.js`, `sidebar.js`, `barang-duplikat.js`, `barang-export.js` |
| `vendor.html` | `config.js`, `auth.js`, `ppn.js`, `logger.js`, `sidebar.js`, `vendor-export.js` |
| `pembelian.html` | `config.js`, `auth.js`, `ppn.js`, `logger.js`, `sidebar.js`, `datefilter.js`, `scan-invoice.js`, `barang-helper.js` ⭐, `pembelian-riwayat.js`, `pembelian-caribarang.js` |
| `harga.html` | `config.js`, `auth.js`, `ppn.js`, `sidebar.js`, `datefilter.js`, `harga-export.js` |
| `stock-opname.html` | `config.js`, `auth.js`, `ppn.js`, `sidebar.js`, `datefilter.js` |
| `settings.html` | `config.js`, `auth.js`, `ppn.js`, `logger.js`, `sidebar.js` |
| `import.html` | `config.js`, `auth.js`, `ppn.js`, `sidebar.js`, `datefilter.js` |
| `merge-vendor.html` | `config.js`, `auth.js`, `sidebar.js` |

> `harga.html` tidak butuh `barang-helper.js` karena sudah punya `window.barangMap` sendiri yang fetch dari master.

### Order Flow
| HTML | JS yang diload |
|---|---|
| `order.html` | `config.js`, `auth.js`, `ppn.js`, `sidebar.js`, `fifo-sync.js` |
| `ordermasuk.html` | `config.js`, `auth.js`, `logger.js`, `barang-helper.js` ⭐, `sidebar.js`, `fifo-sync.js`, `wa-vendor.js`, `push-setup.js`, `ordermasuk-mobile.js`, `mobile.js` |

### Operational
| HTML | JS yang diload |
|---|---|
| `inventory.html` | `config.js`, `auth.js`, `sidebar.js`, `mobile.js`, `loader.js` |
| `pastry.html` | `config.js`, `auth.js`, `ppn.js`, `sidebar.js`, `datefilter.js` |

⭐ = file baru ditambahkan untuk fitur nama barang terkini (Opsi A)

> `loader.js` diload di semua halaman protected (12 halaman). Letakkan `<div id="page-loader"><div class="loader-ring"></div></div>` sebagai elemen pertama di `<body>`, diikuti `<script src="loader.js"></script>`.

---

## Per file JS

### Shared — semua / hampir semua halaman

| File | Fungsi utama |
|---|---|
| `config.js` | Supabase URL + anon key. Wajib dimuat pertama. |
| `auth.js` | `getUserRole()`, `applyRoleUI()`, `requireAdmin()` |
| `ppn.js` | `loadPPNRate()`, `toIncPPN()`, `toExcPPN()`, `applyTheme()` |
| `logger.js` | `logActivity()` — tulis ke tabel `activity_log` |
| `sidebar.js` | `renderSidebar()`, order badge, realtime notif pending order |
| `datefilter.js` | DateFilter widget — dipakai di banyak halaman |
| `mobile.js` | Sidebar slide toggle untuk viewport mobile |
| `loader.js` | Full-page overlay saat init — `window.hideLoader()` fade-out, 5s safety timeout. Diload di 12 halaman protected. |

### Baru — Opsi A (nama barang terkini)

| File | Fungsi utama | Diload di |
|---|---|---|
| `barang-helper.js` | `buildBarangNameMap()`, `resolveNamaBarang()`, `getBarangNameMap()`, `invalidateBarangNameMap()` | `dashboard.html`, `pembelian.html`, `ordermasuk.html` |

### Page-specific

| File | Halaman | Fungsi |
|---|---|---|
| `scan-invoice.js` | `pembelian.html` | Scan barcode / kamera untuk input nomor faktur |
| `pembelian-riwayat.js` | `pembelian.html` | Tab riwayat — render, edit, hapus, export. Resolve nama via `barang-helper`. |
| `pembelian-caribarang.js` | `pembelian.html` | Tab cari barang — agregasi dari `riwayat_beli_items`. Resolve nama via `barang-helper`. |
| `barang-duplikat.js` | `barang.html` | Deteksi & hapus barang duplikat |
| `barang-export.js` | `barang.html` | Export Excel & PDF daftar barang |
| `vendor-export.js` | `vendor.html` | Export Excel & PDF daftar vendor + harga satuan |
| `harga-export.js` | `harga.html` | Export Excel analisis harga & perbandingan vendor |
| `wa-vendor.js` | `ordermasuk.html` | Generate & kirim template WA per vendor |
| `push-setup.js` | `ordermasuk.html` | Web push notification — subscribe, VAPID, simpan ke `push_subscriptions` |
| `ordermasuk-mobile.js` | `ordermasuk.html` | Override sidebar toggle khusus halaman order masuk mobile |
| `fifo-sync.js` | `order.html`, `ordermasuk.html` | Distribusi FIFO qty pembelian ke order items, cache per `barang_id` |

### Utility / Config

| File | Keterangan |
|---|---|
| `sw.js` | Service worker — handle push event, notif click, re-subscribe otomatis |
| `config_example.js` | Template `config.js` untuk developer baru (tanpa credential asli) |

---

## Urutan load yang benar

Untuk halaman yang butuh semua fitur:

```html
<!-- 1. Library eksternal -->
<script src="https://cdn.../supabase.js"></script>
<script src="https://cdn.../xlsx.full.min.js"></script> <!-- jika butuh export -->

<!-- 2. Config & foundation -->
<script src="config.js"></script>
<script src="auth.js"></script>
<script src="ppn.js"></script>
<script src="logger.js"></script>   <!-- jika halaman butuh activity log -->
<script src="loader.js"></script>   <!-- overlay loader — letakkan setelah <div id="page-loader"> di body -->

<!-- 3. Helper (jika butuh nama barang terkini) -->
<script src="barang-helper.js"></script>

<!-- 4. Shared UI -->
<script src="sidebar.js"></script>
<script src="datefilter.js"></script>

<!-- 5. Page-specific (terakhir) -->
<script src="pembelian-riwayat.js"></script>
<script src="pembelian-caribarang.js"></script>
```

> `barang-helper.js` harus dimuat **sebelum** script page-specific yang memanggilnya, dan **setelah** `auth.js` karena butuh `window._sb`.
