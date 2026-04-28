/* ═══════════════════════════════════════════
   sidebar.js — Shared sidebar component
   Include di semua halaman setelah style.css
   ═══════════════════════════════════════════ */

const _SIDEBAR_NAV = [
  { href: 'dashboard.html',    icon: '🏠', label: 'Dashboard',      section: 'Backoffice' },
  { href: 'barang.html',       icon: '📋', label: 'Barang' },
  { href: 'vendor.html',       icon: '🏢', label: 'Vendor' },
  { href: 'pembelian.html',    icon: '🛒', label: 'Pembelian' },
  { href: 'harga.html',        icon: '📈', label: 'Riwayat Harga' },
  { href: 'stock-opname.html', icon: '📦', label: 'Stock Opname' },
  { href: 'ordermasuk.html',   icon: '📥', label: 'Order Masuk',    section: 'Order Barang' },
  { href: 'settings.html',     icon: '⚙️', label: 'Pengaturan',    section: 'Pengaturan' },
];

/**
 * Render sidebar ke dalam <aside id="sidebar">
 */
function renderSidebar(activePage, brandLabel = 'Brand aktif', onchange = '', options = {}) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const hideBrandSelector = options.hideBrandSelector || activePage === 'dashboard.html';

  const navHTML = _SIDEBAR_NAV.map(item => {
    let html = '';
    if (item.section) {
      html += `<div class="nav-section" style="${item.section !== 'Menu' ? 'margin-top:12px' : ''}">${item.section}</div>`;
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
    html += `<a class="nav-item${isActive ? ' active' : ''}" href="${item.href}" style="display:flex;align-items:center;gap:0">
      <span class="nav-icon">${item.icon}</span>
      <span style="flex:1">${item.label}</span>
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
    <style>
      @keyframes badgePulse {
        0%,100% { opacity:1; transform:scale(1); }
        50%      { opacity:.75; transform:scale(1.1); }
      }
    </style>
    <div class="sidebar-brand">
      <div class="brand-row">
        <div class="brand-icon">📦</div>
        <span class="brand-name">PurchaseOS</span>
      </div>
    </div>
    ${brandSelectorHTML}
    <nav class="nav">${navHTML}</nav>
    <div class="sidebar-user">
      <div class="user-row">
        <div class="user-avatar" id="userAvatar">?</div>
        <div class="user-info">
          <div class="user-name" id="userName">Memuat...</div>
          <div class="user-role" id="userRole">—</div>
        </div>
        <button class="btn-logout" onclick="doLogout()" title="Keluar">⏻</button>
      </div>
    </div>
  `;

  if (typeof applyRoleUI === 'function' && window._lastKnownRole) {
    applyRoleUI(window._lastKnownRole);
  }

  /* Mulai polling notifikasi order pending setelah sidebar dirender */
  _startOrderNotifPolling();
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

/* Expose agar halaman lain bisa trigger refresh manual (misal setelah tambah order) */
window._refreshOrderNotif = _fetchOrderNotifCount;
window._updateOrderBadge  = _updateOrderBadge;

window.renderSidebar = renderSidebar;
