/* ═══════════════════════════════════════════
   sidebar.js — Shared sidebar component
   Include di semua halaman setelah style.css
   ═══════════════════════════════════════════ */

const _SIDEBAR_NAV = [
  { href: 'dashboard.html',    icon: '🏠', label: 'Dashboard',       section: 'Pembelian' },
  { href: 'barang.html',       icon: '📋', label: 'Barang' },
  { href: 'vendor.html',       icon: '🏢', label: 'Vendor' },
  { href: 'kontrak.html',      icon: '📜', label: 'Kontrak Vendor' },
  { href: 'pembelian.html',    icon: '🛒', label: 'Pembelian' },
  { href: 'harga.html',        icon: '📈', label: 'Riwayat Harga' },
  { href: 'stock-opname.html', icon: '📦', label: 'Stock Opname' },
  { href: 'ordermasuk.html',   icon: '📥', label: 'Order Masuk',     section: 'Order' },
  { href: 'order.html',        icon: '📝', label: 'Order Internal',  newTab: true },
  { href: 'orderpattern.html', icon: '📉', label: 'Pola Order',      adminOnly: true },
  { href: 'inventory.html',    icon: '🗃️', label: 'Inventory Track', section: 'Operasional', newTab: true },
  { href: 'pastry.html',       icon: '🥐', label: 'Pastry' },
  { href: 'invoice-drafts.html', icon: '📄', label: 'Invoice Drafts', section: 'Finance' },
  { href: 'finance.html',        icon: '💳', label: 'Pembayaran' },
  { href: 'settings.html',       icon: '⚙️', label: 'Pengaturan',     section: 'Pengaturan' },
];

/**
 * Render sidebar ke dalam <aside id="sidebar">
 */
function renderSidebar(activePage, brandLabel = 'Brand aktif', onchange = '', options = {}) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  // Brand selector di sidebar di-hide global. Tiap page yg butuh filter brand pakai widget inline-nya sendiri.
  // Select tetep ada di DOM (hidden) supaya existing logic yg baca `document.getElementById('brandSelect').value` tetep jalan.
  const hideBrandSelector = true;

  let _firstSection = true;
  const navHTML = _SIDEBAR_NAV.map(item => {
    let html = '';
    if (item.section) {
      const mt = _firstSection ? '' : 'margin-top:12px';
      _firstSection = false;
      html += `<div class="nav-section" style="${mt}">${item.section}</div>`;
    }
    const isActive = item.href === activePage;
    /* Badge notif order masuk */
    const isOrderMasuk = item.href === 'ordermasuk.html';
    const badgeHTML = isOrderMasuk
      ? `<span id="sidebarOrderBadge" style="
            display:none;
            background:#ef4444;
            color:#fff;
            border-radius:10px;
            font-size:10px;
            font-family:monospace;
            font-weight:700;
            padding:1px 6px;
            min-width:18px;
            text-align:center;
            margin-left:auto;
            line-height:18px;
            animation:badgePulse 2s infinite;
          ">0</span>`
      : '';
    const newTabIndicator = item.newTab
      ? `<span style="font-size:9px;color:var(--muted);flex-shrink:0;line-height:1">↗</span>`
      : '';
    html += `<a class="nav-item${isActive ? ' active' : ''}${item.adminOnly ? ' admin-only' : ''}" href="${item.href}"${item.newTab ? ' target="_blank"' : ''}>
      <span class="nav-icon">${item.icon}</span>
      <span style="flex:1">${item.label}</span>
      ${newTabIndicator}
      ${badgeHTML}
    </a>`;
    return html;
  }).join('');

  const onchangeAttr = onchange ? ` onchange="${onchange}"` : '';

  const brandSelectorHTML = hideBrandSelector
    ? `<select id="brandSelect" style="display:none"${onchangeAttr}>
        <option value="all">— Semua Brand —</option>
       </select>`
    : `<div class="brand-selector">
        <label>${brandLabel}</label>
        <select id="brandSelect"${onchangeAttr}>
          <option value="all">— Semua Brand —</option>
        </select>
       </div>`;

  sidebar.innerHTML = `
    <div class="sidebar-brand">
      <div class="brand-row">
        <div class="brand-icon">📦</div>
        <span class="brand-name">PurchaseOS</span>
      </div>
    </div>
    ${brandSelectorHTML}
    <nav class="nav" style="overflow-y:auto;flex:1;min-height:0">${navHTML}</nav>
    <div class="sidebar-user">
      <div class="user-row">
        <div class="user-avatar" id="userAvatar">?</div>
        <div class="user-info">
          <div class="user-name" id="userName">Memuat...</div>
          <div class="user-role" id="userRole">—</div>
        </div>
        <button class="btn-logout" onclick="doLogout()" title="Keluar" aria-label="Logout">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  if (typeof applyRoleUI === 'function' && window._lastKnownRole) {
    applyRoleUI(window._lastKnownRole);
  }

  /* Auto-populate user info (name + avatar) — single source utk semua page */
  _populateSidebarUser();

  /* Mulai polling notifikasi order pending setelah sidebar dirender */
  _startOrderNotifPolling();
}

/* Logout — single source supaya semua page (bukan cuma yg punya inline) berfungsi.
   Page lama yg sudah punya `doLogout` lokal akan overwrite (no harm — same behavior). */
if (typeof window.doLogout !== 'function') {
  window.doLogout = async function () {
    if (!await showConfirm({ title:'Keluar', msg:'Yakin ingin keluar?', okLabel:'Keluar' })) return;
    try {
      if (window._sb) await window._sb.auth.signOut();
      sessionStorage.removeItem('userRole');
    } catch (e) { console.error('[sidebar] logout gagal:', e); }
    window.location.href = 'index.html';
  };
}

async function _populateSidebarUser() {
  try {
    if (!window._sb) return;
    const { data: { session } } = await window._sb.auth.getSession();
    if (!session) return;
    const user = session.user;
    const name = user.user_metadata?.full_name || (user.email || '').split('@')[0] || 'User';
    const nameEl = document.getElementById('userName');
    const avEl   = document.getElementById('userAvatar');
    if (nameEl) nameEl.textContent = name;
    if (avEl)   avEl.textContent   = (name[0] || '?').toUpperCase();
    /* Populate role — applyRoleUI mungkin sudah dipanggil sebelum sidebar render,
       jadi #userRole belum exist. Re-apply di sini. */
    let role = window._userRole || sessionStorage.getItem('userRole');
    if (!role && typeof getUserRole === 'function') role = await getUserRole();
    if (role && typeof applyRoleUI === 'function') applyRoleUI(role);
  } catch (e) {
    console.error('[sidebar] populate user gagal:', e);
  }
}

/* ═══════════════════════════════════════════
   ORDER NOTIFICATION SYSTEM
   Poll setiap 30 detik, count order status='pending'
   ═══════════════════════════════════════════ */
let _orderNotifInterval = null;
let _lastOrderCount     = 0;
let _isOrderPage        = false; // tidak tampilkan badge jika sudah di halaman ordermasuk

function _startOrderNotifPolling() {
  /* Deteksi apakah sedang di halaman order masuk */
  _isOrderPage = window.location.pathname.includes('ordermasuk');

  /* Jalankan langsung + interval 30 detik */
  _fetchOrderNotifCount();
  if (_orderNotifInterval) clearInterval(_orderNotifInterval);
  _orderNotifInterval = setInterval(_fetchOrderNotifCount, 30_000);

  /* Realtime via Supabase jika tersedia */
  _trySubscribeOrderRealtime();
}

async function _fetchOrderNotifCount() {
  try {
    const sb = window._sb;
    if (!sb) return; /* Supabase belum siap */

    const { count, error } = await sb
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (error) return;
    _updateOrderBadge(count || 0);
  } catch (_) { /* silent fail */ }
}

function _updateOrderBadge(count) {
  _lastOrderCount = count;
  const badge = document.getElementById('sidebarOrderBadge');
  if (!badge) return;

  if (count > 0 && !_isOrderPage) {
    badge.textContent   = count > 99 ? '99+' : count;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }

  /* Update page title jika ada pending */
  const baseTitle = document.title.replace(/^\(\d+\+?\)\s*/, '');
  document.title = (count > 0 && !_isOrderPage)
    ? `(${count > 99 ? '99+' : count}) ${baseTitle}`
    : baseTitle;
}

function _trySubscribeOrderRealtime() {
  /* Tunggu sampai Supabase tersedia (maks 5 detik) */
  let attempts = 0;
  const trySubscribe = () => {
    const sb = window._sb;
    if (!sb || typeof sb.channel !== 'function') {
      if (++attempts < 10) setTimeout(trySubscribe, 500);
      return;
    }
    sb.channel('sidebar-order-notif')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders'
      }, () => {
        /* Ada perubahan di tabel orders — refresh count */
        _fetchOrderNotifCount();
      })
      .subscribe();
  };
  trySubscribe();
}

/* Bersihkan interval saat navigasi antar halaman */
window.addEventListener('beforeunload', () => {
  if (_orderNotifInterval) clearInterval(_orderNotifInterval);
});

/* Expose agar halaman lain bisa trigger refresh manual (misal setelah tambah order) */
window._refreshOrderNotif = _fetchOrderNotifCount;
window._updateOrderBadge  = _updateOrderBadge;

window.renderSidebar = renderSidebar;

/* Mobile sidebar toggle — fallback jika halaman tidak mendefinisikan sendiri */
if (typeof window.toggleSidebar !== 'function') {
  window.toggleSidebar = function () {
    document.getElementById('sidebar')?.classList.toggle('open');
    document.getElementById('overlay')?.classList.toggle('show');
  };
}
if (typeof window.closeSidebar !== 'function') {
  window.closeSidebar = function () {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('overlay')?.classList.remove('show');
  };
}
