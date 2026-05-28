# Changelog — purchasing-db

## 2026-05-29 — Migrasi Supabase Project (jpfqysbaygcvlkxcecdo → lzycxgibjfyokgibbycx)

Pindah project Supabase ke instance baru karena project lama akan di-decommission. Database shared dengan app lain (POS, attendance, dll) — RLS di-aktifkan selektif hanya untuk tabel purchasing-db.

### config.js
- Update `supabaseUrl` & `supabaseKey` ke project baru `lzycxgibjfyokgibbycx`

### index.html + order.html
- Hapus hardcode `SUPA_URL` / `SUPA_KEY` / `SUPA_ANON` — sebelumnya credential ditulis ulang di file (bug: setelah update `config.js`, halaman ini masih pakai credential lama → redirect loop login ↔ dashboard)
- Tambah `<script src="config.js">` sebelum init client
- `supabase.createClient(SUPA_URL, SUPA_KEY)` → `supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseKey)`

### Database
- DB Trigger `on_auth_user_created` di `auth.users` AFTER INSERT → function `handle_new_user()` insert ke `public.profiles` (id, email, nama dari `raw_user_meta_data.full_name`, role default 'user'). `SECURITY DEFINER` agar bypass RLS. Tanpa ini: registrasi via `index.html` hanya buat row di `auth.users`, tidak di `profiles` → query role gagal
- Migrasi semua RLS policies dari project lama via dump `pg_policies` → save ke `migration-rls-policies.sql` (34 tabel, ~80 policies)
- Tambah policy `auth_all` untuk `vendor_bank_accounts`, `payment_requests`, `invoice_drafts` (tidak ada di project lama, ditambah agar konsisten dengan tabel finance lain)
- Realtime: `ALTER PUBLICATION supabase_realtime ADD TABLE orders` — wajib untuk channel `order-masuk-notif` (ordermasuk.html) dan `sidebar-order-notif` (sidebar.js)

### Edge Function: send-push
- Re-deploy `supabase/functions/send-push/index.ts` via Dashboard (UI deploy, bukan CLI)
- Set 3 secrets di Project Settings → Edge Functions:
  - `VAPID_SUBJECT=mailto:rizki.me38@gmail.com`
  - `VAPID_PUBLIC_KEY` & `VAPID_PRIVATE_KEY` (generate baru via Node.js crypto, simpan di `.env.vapid`)
- Database Webhook: `orders` INSERT → POST `/functions/v1/send-push` dengan header `Authorization: Bearer <anon_key>`

### Edge Function: scan-invoice (NEW)
- Buat `supabase/functions/scan-invoice/index.ts` — terima `multipart/form-data` dengan field `invoice` (JPG/PNG/WebP/PDF max 10MB)
- Validasi tipe file → konversi ke base64 (chunked 8192 untuk hindari stack overflow di file besar)
- Call Gemini API dengan model fallback chain: `gemini-3.1-flash-lite-preview` (500 RPD free) → `gemini-2.5-flash` → `gemini-flash-lite-latest`. Fallback hanya untuk error 5xx/429, error 400 langsung throw
- `generationConfig`: `temperature: 0.1`, `maxOutputTokens: 8192` (cukup untuk invoice 50+ item), `responseMimeType: "application/json"`, `responseSchema` dengan field `nomor_faktur`, `tanggal`, `vendor`, `catatan`, `ppn_included` (bool), `diskon`, `ongkir`, `items[]` — paksa Gemini return JSON valid sesuai struktur
- Prompt detail untuk deteksi PPN Indonesia: invoice tanpa baris PPN terpisah → `ppn_included=true` (default Indonesia); ada baris PPN/keterangan "Belum Termasuk PPN" → `ppn_included=false`
- Sanitasi angka setelah parse: handle string "Rp 10.000" / "10,000" (regex strip non-digit + handle thousand separator), `qty` default 1 jika invalid, filter out item tanpa nama atau `harga_satuan ≤ 0`
- Secret: `GEMINI_API_KEY`

### VAPID Public Key (frontend)
- `sw.js:76`: update `VAPID_PUBLIC_KEY` ke key baru
- `push-setup.js:12`: update `VAPID_PUBLIC_KEY` ke key baru
- Key baru: `BIzL3WzWtzfagaWlaI4jphJ0HO_HE6We7dqbfEM0vSCqGDEP6ucbDRV21Y8O9R9Eal0vbIOxrHZdSCLlNFlO0YU`

### Storage
- Buat bucket `payment-documents` (private)
- Policies di `storage.objects` untuk `bucket_id = 'payment-documents'`:
  - `Authenticated upload` (INSERT)
  - `Authenticated read` (SELECT)
  - `Authenticated delete` (DELETE)

### Pending
- Auth → URL Configuration: Site URL & Redirect URLs belum di-set (menunggu URL Netlify produksi). Tanpa ini: link verifikasi email & reset password akan redirect ke default Supabase

---

## 2026-05-28 — UI Polish: Toolbar, Sort & Consistency Fixes

### style.css
- Override `.search-input` font-size 14px → 13px (equalise dengan `.filter-select`)
- Tambah rule `height: 38px; box-sizing: border-box` untuk `.filter-bar` dan `.toolbar` children (`.search-input`, `.filter-select`, `button:not(.view-mode-btn)`) — Poppins metrics lebih tinggi dari DM Mono, rule ini paksa tinggi sama
- `.view-mode-toggle`: tambah `height: 38px; align-items: center`
- `.view-mode-btn`: `height: 100%; padding: 0 12px; border: 1px solid transparent` + hover state
- `.view-mode-btn--active`: ganti dari solid `var(--accent)` background → `border-color: var(--accent); color: var(--accent)` (lebih subtle, konsisten design system)
- `.filter-sel`: tambah `height: 38px; box-sizing: border-box`

### barang.html
- `#btnToggleSku` (Barcode toggle): padding `6px 10px` → `9px 12px`, font-size `11px` → `12px`, border-radius `6px` → `8px` — match tinggi filter-select
- `_normalizeBarang`: tambah `_barcodes: (b.barang_barcodes || []).map(x => x.barcode)` dari join query
- `fetchBarangPage` select: semua query sekarang include `barang_barcodes(barcode)` join
- Sort fix `harga_satuan`: kolom ini tidak ada di tabel `barang` (computed dari `riwayat_harga`). Sekarang pakai fallback `_dbSortField = 'nama'` ke Supabase + client-side sort via `hargaTerakhirMap` setelah fetch. Berlaku di 3 path (search, brand-filter, server-paginated)
- Sort fix `sku` (Barcode): `barang.sku` ≠ data yang ditampilkan (kolom render dari `barang_barcodes`). Sekarang client-side sort via `_barcodes[0] || sku` menggunakan `localeCompare` — sort match persis dengan nilai yang terlihat di tabel
- Search mode: tambah match terhadap nilai barcode (`_barcodes.some(bc => bc.includes(search))`)
- Hapus separate post-fetch `barang_barcodes` query — redundant setelah join dimasukkan ke query utama

### finance.html + invoice-drafts.html
- Topbar: tambah `z-index: 200` — konsisten dengan halaman lain (vendor, harga)
- `finance.html`: date filter button `btn-ghost` → `btn btn-ghost` (tambah base `.btn` class untuk proper flex/height)
- `finance.html`: status select `class="search-input"` → `class="filter-select"`
- `finance.html`: table container `style="overflow-x:auto"` → `class="table-wrap"`, hapus inline style dari `<table>`
- `invoice-drafts.html`: status select `class="search-input"` → `class="filter-select"`
- `invoice-drafts.html`: left panel search input wrapped dalam `.search-wrap` + `.search-icon` span — konsisten dengan semua halaman lain

---

## 2026-05-28 — PurchaseOS Finance Integration (Fase 1–3)

Implementasi full dari spec `purchaseos-finance-integration.md`. Discord → Supabase → review → payment flow.

### Fase 1 — Core

**invoice-drafts.html + invoice-drafts.js (new)**
- Halaman review antrian invoice draft dari Discord
- Akses: admin + finance role (cek `profiles.role`, tolak selain 'admin'/'finance')
- Layout split: panel kiri (daftar draft 300px) + panel kanan (image viewer 45% + form koreksi 55%)
- Image viewer: zoom +/− (9 level: 25–400%), rotate ↺/↻, reset — implementasi sendiri (tidak bergantung pada window.* scan-invoice.js)
- Filter: status (needs_review/confirmed/rejected/semua) + search vendor/faktur + brand selector
- Per item: nama OCR → fuzzy match (`_fuzzyScore`) → dropdown search → badge exact/fuzzy/no match
- Learned mappings: baca/tulis `scan_mappings` langsung (mirror logika scan-invoice.js, fungsi tidak di-expose sebagai window.*)
- Vendor section: OCR vendor → fuzzy match → select → load `vendor_bank_accounts`
- Quick add barang inline (tanpa keluar halaman) — INSERT ke `barang` + langsung pilih
- Confirm flow: INSERT `riwayat_beli` → INSERT `riwayat_beli_items` (dengan `is_unmatched`, `unmatched_nama`) → INSERT `payment_requests` (status_payment=pending) → UPDATE `invoice_drafts.status=confirmed` → upsert `scan_mappings`
- Reject flow: modal alasan → UPDATE `invoice_drafts.status=rejected`
- Close dropdown on outside click

**sidebar.js**
- Tambah section "Finance" dengan nav item: `invoice-drafts.html` (📄) dan `finance.html` (💳)

### Fase 2 — Finance View

**finance.html + finance.js (new)**
- Halaman outstanding payment, akses admin + finance
- Summary bar: total outstanding (Rp) | perlu bayar (jumlah item) | lunas bulan ini (Rp)
- Tabel 9 kolom: Tgl Bayar, No. Invoice, Vendor, Keterangan (dari `riwayat_beli_items`, truncated 60 char), Jumlah, Transfer Ke (`vendor_bank_accounts`), Xero checkbox, Bukti, Aksi
- Filter: status (pending/paid/semua) + search vendor/faktur + DateFilter (bulan ini / semua / custom range)
- Query join: `payment_requests` ← `riwayat_beli` ← `riwayat_beli_items` + `vendor` + `vendor_bank_accounts`
- Tandai lunas: modal konfirmasi → UPDATE `status_payment=paid`, `payment_date`, `paid_by`
- Xero toggle inline: checkbox per baris → UPDATE `status_xero` (inputted/not_input)
- Upload bukti transfer: file input tersembunyi → Supabase Storage bucket `invoice-attachments` path `bukti/{id}_{timestamp}.ext` → UPDATE `attachment_url`
- DateFilter integration dengan `onChange` callback → reload data

### Fase 3 — Cleanup & Enhancement

**barang.html**
- Tambah tab bar di atas tabel: `📋 Daftar Barang` (existing) + `⚠ Antrian Unmatched`
- Tab badge merah menampilkan jumlah grup unmatched
- Tab Antrian Unmatched: query `riwayat_beli_items` where `is_unmatched=true`, digroup by `unmatched_nama`, kolom: nama OCR, kemunculan (×N), tanggal terakhir, vendor
- Resolve modal: search barang master (`ilike`) → pilih → UPDATE semua matching items (`barang_id`, `is_unmatched=false`) + upsert `scan_mappings` agar OCR belajar
- "Tambah sebagai barang baru" collapsible inline dalam resolve modal
- `escapeHtml()` helper ditambah ke script block

**dashboard.html**
- Tambah 2 stat card baru di `stats-grid`:
  - "Outstanding Payment" (warna danger) — total `amount` dari `payment_requests` where `status_payment=pending`
  - "Draft Belum Review" (warna teal) — count `invoice_drafts` where `status=needs_review`
- `loadFinanceStats(selectedBrands)` dipanggil dari `loadDashboard()`, filter by brand
- CSS: `.stat-card.red::before` + `.stat-card.teal::before` ditambah ke inline style block

---

## 2026-05-28 — inventory.html Feature Sync

### inventory.html — 20 changes applied from newer version

**Month-grid date picker**
- `#rwDatePopup` replaced — old `<input type="month">` pair swapped for year-nav + 4×3 month grid + Apply button
- CSS: `.rw-mg-cell`, `.rw-mg-sel`, `.rw-mg-range` added to style block
- JS: `_mgYear`, `_mgFrom`, `_mgTo`, `_MN`, `_mgRender()`, `_mgOrder()`, `_mgClick()`, `_mgPrevYear()`, `_mgNextYear()`, `_mgApply()` — full month-grid engine
- `toggleDateFilter(btnEl,id)` — rewritten; restores grid state from current filter values on open
- `setDateFilterActive('all')` — clears `_mgFrom`/`_mgTo`, calls `_mgRender()`
- `applyDateFilterActive()` — replaced with empty stub (superseded by `_mgApply`)
- `_dateIdMap` — added `pastry` entry (`rwPastryDateFrom`/`rwPastryDateTo` → `loadPastryHistory`)
- `_ensureDateInputs` — added `rwPastryDateFrom`, `rwPastryDateTo` to ensure list

**Pastry 2-row IO keranjang layout**
- CSS: `.io-keranjang-item--pastry`, `.io-pastry-top`, `.io-pastry-bottom` + mobile overrides
- `renderIoKeranjang()` — rewritten; pastry items render 2-row (name+tipe-select top, qty ctrl bottom), non-pastry unchanged
- `removeIoItem()` — pastry branch calls `renderPastryBarang()`, others call `renderIoBarang()`
- `ioQtyDelta()` — `if(newQty<=0) return` instead of `removeIoItem()` (keeps item in cart at 0)

**Transfer: Barang Bebas (ad-hoc custom items)**
- `#barangBebasOverlay` modal — nama + satuan (from DB) + qty fields, inline error
- `openBarangBebasModal()`, `closeBarangBebasModal()`, `addBarangBebas()` — pushes `{untracked:true, is_custom:true}` item into `transferItems`
- "＋ Barang Bebas" button added to `tr-col-items` panel header
- "＋ Bebas" button added to transfer drawer `io-search-hint` row

**Transfer: Untracked items support**
- `_buildTransferList(q)` — new; returns `{tracked, untracked}` split from `allTransferBarang`
- `renderTransferBarangList()` — uses `_buildTransferList`; untracked items show amber "untracked" badge + `∞` stock display
- `renderTransferBarangPanel()` — same
- `toggleTransferBarangItem()` — untracked items get `maxQty:999999`
- `renderTransferItems()` — untracked items show `∞` badge + "Qty bebas" label instead of max qty
- `submitTransfer()` — skips stock reduction for items where `item.untracked===true`

**Bug fixes**
- `todayStr()` — WIB timezone fix: `+7h` offset applied before `toISOString()` split

---

## 2026-05-28 — Page Loader, Font Fixes, Theme & Table Fixes

### loader.js (new)
- Full-page overlay loader — covers page while Supabase auth + data fetch runs, fades out when ready
- `window.hideLoader()` — fades overlay (0.35s), removes from DOM
- 5s safety timeout — auto-hides if `hideLoader()` never called (e.g. init error)

### style.css
- `#page-loader` — fixed full-screen, `var(--bg)` bg, z-index 9999, opacity transition 0.35s
- `.loader-ring` — 40px ring, `border-top-color: var(--accent)` cyan, reuses existing `spin` keyframe

### 12 HTML pages — loader integration
Each page gets: `<div id="page-loader">` + `<script src="loader.js">` at body start, `hideLoader()` call at end of init after first data render.

Pages: `barang`, `dashboard`, `vendor`, `pembelian`, `harga`, `stock-opname`, `ordermasuk`, `order`, `inventory`, `pastry`, `settings`, `import`

---

### ordermasuk.html — theme fix (continued)

- **Root cause found**: broken head IIFE called `document.body.classList.add` but `document.body` is `null` in `<head>` → `try/catch` swallowed error → light mode never applied
- **Secondary bug**: fallback block `try { if (typeof applyTheme === 'function') applyTheme() } catch(e) {...}` — since ppn.js absent, `applyTheme` undefined, condition false, no exception → catch never fires → fallback also dead
- **Fix**: removed broken IIFE, added `<script src="ppn.js"></script>` before main script block (body context → `document.body` exists → `applyTheme()` works)

---

### pastry.html
- Missing `<th>Satuan</th>` — thead had 2 cols, tbody rendered 3 cols → "Aksi" header misaligned over satuan column; added missing header

---

## 2026-05-28 — Settings Bug Fixes, Global A11y & Design System Tokens

### settings.html — Bug fixes

- **Removed duplicate `panel-satuan`** — dua panel dengan `id="panel-satuan"` identik; panel kedua dihapus agar `getElementById('satuanList')` tidak target elemen salah
- **Fixed double `display:none`** di `satuanOverlay` inline style
- **Defined `.simple-modal-*` CSS classes** — `.simple-modal-title`, `.simple-modal-label`, `.simple-modal-input` dipakai di modal Satuan & Kategori tapi tidak pernah didefinisikan; input tampil dengan browser default (putih di dark mode). Sekarang styled sesuai WindPulse.
- **Removed outdated TODO comment** — panel-system sudah diimplementasi sejak lama

### settings.html — Security

- **Admin guard** ditambahkan di awal 5 fungsi destruktif: `hapusSemua`, `hapusBarangByBrand`, `hapusVendorByBrand`, `hapusBelisByBrand`, `deleteBrand` — cek `window._userRole !== 'admin'` sebelum eksekusi. Sebelumnya fungsi-fungsi ini bisa dipanggil dari browser console oleh non-admin meski UI sudah diblokir.

### theme.css — Light-mode gaps

- **Barang Store rows light-mode overrides** — `.bs-barang-row:hover`, `.bs-barang-row.checked`, `.bs-member-row.checked` pakai `rgba(0,212,255,...)` hardcoded; tidak ada override di theme.css → tampil warna salah di light mode. Ditambah `body.light-mode` rules dengan `rgba(0,136,204,...)`.
- **`.badge-survey` light-mode** — badge warna purple di barang.html; kontras `#a78bfa` on near-white ~2.3:1 (fail WCAG AA). Ditambah override `color:#6d28d9` (contrast ~7:1).

### Global — Accessibility & Design System (style.css + theme.css)

- **focus-visible ring global** — `*:focus-visible` dipindah dari `body.light-mode`-only ke selector global; dark mode (default) sekarang punya keyboard focus ring outline 2px cyan. Tambah `:focus:not(:focus-visible){outline:none}` untuk menekan outline saat klik mouse.
- **Token `--on-accent`** — `#001f2e` (warna teks di atas bg --accent) ditokenize sebagai `--on-accent: #001f2e` di `:root`. Semua ~19 instance `color:#001f2e` di style.css diganti ke `color:var(--on-accent)`.
- **Radius scale** — tambah `--radius-xs: 6px` dan `--radius-sm: 8px` ke `:root` (theme.css + style.css). Anchor di atom utama: `.badge` → `var(--radius-xs)`, `.search-input`/`.filter-select`/`.field input` → `var(--radius-sm)`.
- **Global scrollbar** — webkit scrollbar + firefox `scrollbar-width:thin` diterapkan global di style.css (sebelumnya hanya 4 spot spesifik). Light mode override `scrollbar-color` untuk Firefox ditambah di theme.css.

### badge & UI consistency

- **`badge-progress` class** ditambah ke `style.css` (sky-blue `#38bdf8`) dan `theme.css` (light-mode variant `#0369a1`). Dipakai di `ordermasuk.html` untuk status "Partial".
- **order.html + inventory.html** — badge colors updated: `badge-green/#22c55e` → `var(--accent2)`, `badge-orange+yellow/#eab308` → `var(--accent3)`, `badge-red/#ef4444` → `var(--danger)`. Konsisten dengan backoffice badge standard.
- **`inventory.html`** — hapus duplikat `.btn-success` dengan hardcoded `#38d9a9,#00b8e0`; `.scan-toast background:#38d9a9` → `var(--accent2)`.

---

## 2026-05-27 — Font Consistency, Bar Chart, ordermasuk Theme Fix, harga Icons

### Font system — 10 pages corrected

All WindPulse pages now load `Poppins + DM Mono` (the correct stack per style.css `--sans`/`--mono` vars):

- **DM+Sans → Poppins**: `barang.html`, `import.html`, `pastry.html`, `settings.html`, `vendor.html`, `ordermasuk.html`, `harga.html`
- **Missing font added**: `dashboard.html`, `pembelian.html` (no font link at all — system fallback was used)
- **Inter + JetBrains Mono → Poppins + DM Mono**: `stock-opname.html`

`merge-vendor.html` excluded — standalone page with own design system; DM+Sans intentional.

---

### ordermasuk.html — theme system compliance

- **Bug fix**: Theme init IIFE was adding `light-mode` to `document.documentElement` (`<html>`), but all `theme.css` rules use `body.light-mode` selector → light mode never applied on this page. Fixed: `document.documentElement.classList.add` → `document.body.classList.add`
- **Removed duplicate** `<link rel="stylesheet" href="ordermasuk-mobile.css"/>` (was loaded twice)

---

### style.css

- `.bar-label { flex: 1 }` — dashboard bar chart month labels now align with bars (`.bar-col` already had `flex:1`; labels did not, causing width/gap mismatch)

---

### barang.html

- Price history brand badge: inline hex style → `class="badge badge-blue"` (consistent with semantic variant system; adapts to both themes via theme.css)

---

### theme.css — badge light mode

- `.badge-blue` light mode: fixed missing semicolon bug (background/color declarations were silently dropped); updated to `color: #006080` (contrast 6.18:1 on white, passes AA/AAA) + `rgba(0,153,187,0.10)` background
- Brand badges with inline hex colors from DB (vivid neon at dark-mode brightness): `filter: saturate(1.1) brightness(0.55)` scoped to `.badge[style]:not([style*="var(--"]):not([class*="badge-"])` — excludes CSS-var-based and semantic-class badges

---

### harga.html

- Chart.js Y-axis tick font: `'DM Sans'` → `'Poppins'` (consistent with loaded font)
- Sort indicator icons (`↕↑↓` in `<th>`): `color: var(--text); opacity: 0.5` — was inheriting `color: var(--muted)` (`#4a6e78`) which fails contrast AA on dark surface (3.2:1)

---

## 2026-05-27 — Light/Dark Theme Overhaul

### theme.css

**Bug fixes — CSS syntax:**
- Fixed 17 broken `rgba(0,212,255,X;` → `rgba(0,212,255,X)` — missing closing parentheses caused browser to silently drop entire declarations (hover states, badges, focus rings, glows all invisible in light mode)
- Fixed 8 missing semicolons introduced when the `)` fix was applied — declarations like `box-shadow`, `background`, `color` were being swallowed by parser
- Fixed missing `;` on `.nav-item.active` background → `color: var(--accent)` was being ignored

**New light-mode component coverage (body.light-mode rules added):**
- `.av-blue/green/orange/purple/pink` — avatar gradient colors (were too neon on white)
- `.prog-bar.zero/low/mid/done/partial` — progress bar status colors
- `.btn-danger` + `:hover` — danger button variant
- `.btn-ghost:active` — active state
- `.spinner` — spinner color
- `.activity-item` — border-bottom
- `.badge-purple/ok/over/under/draft` — missing badge variants
- `.notice-box.success/error` — notice box variants
- `.vendor-group-wa` — WhatsApp button
- `.stat-card.purple::before`, `.strip-card.purple::before`, `.strip-val.purple`, `.stat-value.purple` — purple accent elements
- `.bar`, `.bar:hover`, `.bar.current` — dashboard chart bars
- `.qa-btn:hover` — dashboard quick action hover
- `.detail-kv`, `.summary-row`, `.toggle-row`, `.item-row` — semantic border overrides
- `.item-option` — dropdown border

**Topbar fix:**
- `body.light-mode .topbar::before { background: transparent; backdrop-filter: none }` — root cause of dark topbar in light mode: `.topbar::before` with dark `rgba(13,15,20,0.8)` painted AFTER parent background (z-index: -1 is above parent bg in stacking context), overriding light background; zeroing it out fixes all pages
- Added `backdrop-filter: none !important` directly on `body.light-mode .topbar` — covers pages (inventory.html, order.html) where backdrop-filter is on `.topbar` itself, not `::before`

**New CSS variables in body.light-mode:**
- `--glow-accent: 0 0 12px rgba(0,153,187,0.15)` — muted glow (no neon on white bg)
- `--glow-strong: 0 0 24px rgba(0,153,187,0.20)` — muted strong glow

**New page-specific overrides:**
- `body.light-mode .tab-nav` — sticky tab nav used in inventory.html had `rgba(10,26,31,0.97)` hardcoded
- `body.light-mode .audit-footer` — inventory.html sticky bottom bar
- `body.light-mode .io-type-bar` — inventory.html type selector bar

---

### style.css

- Replaced 14× `rgba(37,40,48,X)` hardcoded dark borders → `var(--border)` across components: `td`, `.detail-kv`, `.price-history-table td`, `.survey-option`, `.vd-row`, `.toggle-row`, `.barang-item`, `.sub-table td`, `.preview-table td`, `.schema-row`, `.item-option`, `.multisel-item`, `.summary-row`
- Removed stale inline comment left by automated fix

---

### HTML Pages — Per-page hardcoded color fixes

**dashboard.html:**
- `.bar` / `.bar:hover` — bar chart background changed from `rgba(0,194,179,0.5)` → `rgba(0,212,255,0.35)` (brand cyan, adapts via theme.css override)
- `.bar.current` glow — `rgba(0,255,123,0.4)` → `var(--glow-accent)` / `var(--glow-strong)`
- `.activity-item` border — `rgba(37,40,48,.6)` → `var(--border)`
- `.qa-btn:hover` background → covered by theme.css `!important`
- `ranks` JS array — `rgba(79,142,247,...)` (wrong blue) → `rgba(0,212,255,...)` (brand cyan)

**settings.html:**
- `.settings-nav-item.active` background — `rgba(79,142,247,0.1)` → `rgba(0,212,255,0.08)` (brand cyan)
- `.brand-card:hover` border — `rgba(79,142,247,0.3)` → `rgba(0,212,255,0.25)`
- `.sysinfo-row` border — `rgba(37,40,48,.5)` → `var(--border)`
- `.kode-notice` background/border — `rgba(79,142,247,0.07/0.2)` → `rgba(0,212,255,0.06/0.15)`
- `.bs-barang-row` border — `rgba(21,44,51,0.4)` → `var(--border)`
- `.bs-barang-row.checked` background — `rgba(56,217,169,0.04)` → `rgba(0,212,255,0.06)` (brand)
- `.bs-member-row.checked` background — `rgba(56,217,169,0.06)` → `rgba(0,212,255,0.08)`
- `.bs-barang-row.checked .bs-cb` / `.bs-member-row.checked .bs-member-cb` — `color:#030709` → `color:var(--bg)` (dark text on dark cyan = contrast fail in light mode)
- `#bsSortKat` button inline `color:#030709` → `color:var(--bg)`
- `#themeOptDark` inline background `rgba(79,142,247,0.06)` → `rgba(0,212,255,0.05)`
- `applyThemeUI()` JS — `'rgba(79,142,247,0.06)'` → `'rgba(0,212,255,0.05)'` (×2)
- `bsSetSort()` JS — `'#030709'` → `'var(--bg)'` (active sort button text, ×2)
- `AKSI_BADGE.edit` style string — `rgba(79,142,247,0.12/0.25)` → `rgba(0,212,255,0.10/0.22)`

**import.html:**
- Info notice box inline style — `rgba(79,142,247,0.06/0.15)` → `rgba(0,212,255,0.05/0.12)`

**merge-vendor.html:**
- `.btn-primary:hover` — `#6e9bf7` (hardcoded blue) → `var(--accent2)`
- `.btn-danger:hover` — `#e8717d` (hardcoded pink-red) → `var(--danger)` + `filter: brightness(1.15)`

**index.html (login page):**
- `.tab-btn.active` `color:#001f2e` → `color:var(--bg)` — dark text on cyan accent bg, fails in light mode
- `.btn-primary` `color:#001f2e` → `color:var(--bg)`
- `.spinner` — `border: rgba(0,20,30,0.3)` → `rgba(255,255,255,0.3)`; `border-top-color:#001f2e` → `var(--bg)`

**inventory.html:**
- `color:#030709` → `color:var(--bg)` (×5): `.btn-primary`, `.btn-success` (×2), `.cfg-barang-cb`, `.cfg-member-cb`
- `border-bottom rgba(37,40,48,0.5)` → `var(--border)` (×2): `.tbl td`, `#auditDirectTable td`
- `border-bottom rgba(37,40,48,0.4)` → `var(--border)`: `.io-barang-item`
- `border-bottom rgba(21,44,51,0.5)` → `var(--border)` (×2): `.tr-item-row`, `.tr-barang-item`
- `border-bottom rgba(21,44,51,0.4)` → `var(--border)`: `.cfg-barang-row`
- Multiple `rgba(79,142,247,...)` hover/selected states → `rgba(0,212,255,...)` (brand cyan)

**order.html:**
- `color:#030709` → `color:var(--bg)` (×1): `.btn-primary`
- `border-bottom rgba(37,40,48,0.5)` → `var(--border)` (×2)
- `border-bottom rgba(37,40,48,0.4)` → `var(--border)` (×1)
- 12× `rgba(79,142,247,...)` → `rgba(0,212,255,...)` (brand cyan)
- `.barang-list-item:hover` — `rgba(79,142,247,0.06)` → `rgba(0,212,255,0.05)`

**barang.html:**
- `color:#030709` → `color:var(--bg)`: accent gradient button text
- 4× `rgba(79,142,247,...)` → `rgba(0,212,255,...)`

**pembelian.html:**
- `border-bottom rgba(37,40,48,0.4)` → `var(--border)` (×4): detail modal table cells
- 5× `rgba(79,142,247,...)` → `rgba(0,212,255,...)`

**vendor.html:**
- `rgba(79,142,247,0.12)` → `rgba(0,212,255,0.10)` — brand filter checked state (×2)

**ordermasuk.html:**
- `rgba(79,142,247,0.04)` → `rgba(0,212,255,0.04)` — WA modal hover

**pastry.html:**
- `rgba(79,142,247,0.08)` → `rgba(0,212,255,0.07)` — brand dropdown hover (×2)

---

### CLAUDE.md (new file)

Created project documentation at root:
- Tech stack, file structure, design system (CSS vars, spacing scale, component class names)
- Theme switching mechanics
- Architecture rules (6 rules incl. rgba syntax rule)
- Skill: Senior UX Frontend Designer — design principles, UX patterns, workflow checklist
- Supabase patterns
- Known issues / notes
