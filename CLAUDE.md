# purchasing-db

Sistem manajemen pembelian internal untuk bisnis retail/logistik Indonesia.
Stack: Vanilla JS + HTML5 + CSS3 + Supabase (PostgreSQL + Auth + Edge Functions).
MPA — setiap halaman HTML berdiri sendiri, tanpa build tool.

---

## Tech Stack

- **Frontend**: Vanilla JS (ES2020+), HTML5, CSS3 — no framework
- **Backend**: Supabase v2 (PostgreSQL, Auth, Realtime, Edge Functions)
- **Fonts**: Poppins (UI), DM Mono (data/labels) — via Google Fonts CDN
- **PWA**: Service worker (`sw.js`) untuk web push notifications
- **Hosting**: Netlify + Supabase

---

## File Structure

```
purchasing-db/
├── index.html              # Login / Register (Supabase Auth)
├── dashboard.html          # KPI stats, charts, activity feed
├── barang.html             # Product CRUD + export Excel/PDF
├── vendor.html             # Vendor management
├── pembelian.html          # Purchase recording (3 tabs)
├── harga.html              # Price history
├── stock-opname.html       # Stock audit/reconciliation
├── ordermasuk.html         # Incoming orders + push notifications
├── order.html              # Internal order management
├── inventory.html          # Inventory tracking
├── pastry.html             # Pastry product management
├── settings.html           # App settings + theme switcher
├── merge-vendor.html       # Vendor merge utility
├── import.html             # Data import tool
│
├── style.css               # Main stylesheet (all components)
├── theme.css               # Dark/light mode tokens (SINGLE SOURCE OF TRUTH for colors)
├── ordermasuk-mobile.css   # Mobile overrides for ordermasuk.html
│
├── sidebar.js              # Shared sidebar nav component
├── auth.js                 # Role-based access (Admin/User), sessionStorage
├── ppn.js                  # PPN/VAT rate + applyTheme() on page load
├── config.js               # Supabase credentials — NEVER COMMIT
├── config.example.js       # Template for config.js
├── datefilter.js           # Date range filtering utility
├── sw.js                   # Service worker v1.1.0
└── supabase/               # Edge functions
```

---

## Design System — WindPulse Theme

### CSS Variables (defined in `theme.css`)

```css
/* Dark mode (default) */
--bg:       #030709   /* Ultra-dark navy-black */
--surface:  #0a1a1f   /* Deep teal-black card */
--surface2: #0f2429   /* Elevated surface */
--border:   #152c33
--accent:   #00d4ff   /* Cyan primary CTA */
--accent2:  #00b8e0
--accent3:  #00c2b3
--text:     #f0f6f4
--muted:    #4a6e78
--danger:   #ff4d6a
--radius:   14px
--sidebar:  220px
--glow-accent: 0 0 20px rgba(0,212,255,0.2)
--glow-strong: 0 0 40px rgba(0,212,255,0.3)

/* Light mode (body.light-mode) */
--bg:       #f0f7f5
--surface:  #ffffff
--surface2: #e8f4f1
--border:   #c5ddd8
--accent:   #0099bb
--text:     #0a1a1f
--muted:    #4a7a72
```

### Spacing Scale
`--sp-xs: 4px` | `--sp-sm: 8px` | `--sp-md: 12px` | `--sp-lg: 16px` | `--sp-xl: 20px` | `--sp-2xl: 24px` | `--sp-3xl: 28px`

### Key Components (class names)
- `.sidebar` `.nav-item` `.nav-item.active` `.sidebar-brand` `.sidebar-user`
- `.topbar` `.page-title` `.page-sub` `.date-chip`
- `.card` `.card-header` `.card-title` `.stat-card` `.mini-stat`
- `.table-card` `thead th` `tbody tr:hover`
- `.btn-ghost` `.btn-primary` `.badge-*` (gray/green/orange/red/blue)
- `.modal-overlay` `.modal` `.modal-header` `.modal-footer`
- `.tab-bar` `.tab-btn.active`
- `.filter-bar` `.search-wrap` `.search-input`
- `.pagination` `.page-btn.active`
- `.item-dropdown` `.survey-dropdown`

### Theme Switching
- Toggle: `body.light-mode` class via `localStorage('appTheme')`
- Init: `applyTheme()` in `ppn.js` — called on every page load
- UI: `setTheme()` + `applyThemeUI()` in `settings.html`
- **All** light-mode overrides live in `theme.css` under `body.light-mode`

---

## Architecture Rules

1. **color token changes** → edit `theme.css` only, never hardcode colors in `style.css`
2. **new component styles** → add to `style.css` using existing CSS vars
3. **new page** → include `style.css`, `theme.css`, `sidebar.js`, `auth.js`, `ppn.js` (in that order)
4. **rgba() values** → always close parentheses — `rgba(0,212,255,0.08)` not `rgba(0,212,255,0.08;`
5. **config.js** → never commit, always in `.gitignore`
6. **language** → all UI text in Bahasa Indonesia

---

## Skill: Senior UX Frontend Designer

When working on UI/UX tasks in this project, apply this persona:

### Design Principles

- **Konsistensi visual**: Gunakan CSS vars yang sudah ada. Jangan hardcode warna atau spacing di luar sistem token.
- **Hierarchy yang jelas**: Informasi paling penting = paling menonjol. Gunakan weight, ukuran, dan warna `--muted` untuk hierarki.
- **Responsive first**: Breakpoint utama 768px dan 600px. Sidebar collapse otomatis di mobile.
- **Micro-interactions**: Semua interactive element butuh `transition` (hover, focus, active) — 150ms ease standar.
- **Aksesibilitas**: Selalu `focus-visible` outline dengan `var(--accent)`. Contrast ratio minimum 4.5:1 untuk teks.
- **Empty states**: Setiap tabel/list wajib ada `.empty-state` — jangan biarkan area kosong tanpa penjelasan.

### UX Patterns yang Digunakan

| Pattern | Implementasi |
|---------|-------------|
| Loading state | Skeleton loader dengan shimmer animation |
| Feedback aksi | Toast notification (success/error/info) |
| Konfirmasi destruktif | Modal konfirmasi sebelum hapus/merge |
| Form validation | Inline error di bawah field, border merah `var(--danger)` |
| Bulk action | Checkbox per baris + action toolbar muncul saat ada selection |
| Infinite/paginated | Pagination bar dengan `.page-btn` + info "Menampilkan X dari Y" |
| Mobile nav | Hamburger toggle, sidebar slide-in, overlay backdrop |

### Cara Kerja Saat Ada Task UI

1. **Baca komponen yang sudah ada** di `style.css` — jangan buat class baru kalau class yang ada bisa dipakai
2. **Gunakan token CSS vars** — jangan hardcode `#00d4ff`, pakai `var(--accent)`
3. **Test kedua theme** — perubahan apapun harus terlihat benar di dark dan light mode
4. **Mobile check** — cek di viewport 375px dan 768px
5. **Hover + focus state** wajib ada di semua interactive element
6. **Icon**: gunakan emoji atau karakter Unicode — tidak ada library icon eksternal

### Checklist UX Sebelum Selesai

- [ ] Semua warna pakai CSS vars, tidak ada hardcode hex
- [ ] Light mode dan dark mode sama-sama terlihat baik
- [ ] Hover state ada di setiap tombol/link/row
- [ ] Focus visible untuk keyboard navigation
- [ ] Mobile viewport 375px tidak ada overflow horizontal
- [ ] Loading/empty state sudah dihandle
- [ ] Teks Bahasa Indonesia, konsisten dengan halaman lain
- [ ] Tidak ada `rgba()` dengan kurung penutup yang hilang

---

## Supabase Patterns

```js
// Auth check (setiap halaman protected)
const { data: { user } } = await supabase.auth.getUser();
if (!user) window.location.href = 'index.html';

// Role check
const role = await getUserRole(); // dari auth.js
if (role !== 'admin') applyRoleUI(); // sembunyikan element admin-only

// Query standar
const { data, error } = await supabase
  .from('table_name')
  .select('*')
  .eq('brand', selectedBrand)
  .order('created_at', { ascending: false });
```

---

## Known Issues / Notes

- `config.js` berisi Supabase credentials — **tidak boleh di-commit**
- `Ordermasuk FIFO backup/` adalah versi lama — jangan hapus, tapi jangan modifikasi
- `ppn.js` berisi dua hal sekaligus: PPN rate helper + `applyTheme()` — keduanya dipanggil di setiap halaman
- Tidak ada build tool — perubahan langsung terlihat di browser tanpa compile step
