/* ═══════════════════════════════════════════════════════
   mobile.js — General mobile patch, semua halaman
   Include setelah sidebar.js:
     <script src="mobile.js" defer></script>
   ═══════════════════════════════════════════════════════ */

(function () {
  if (window.innerWidth > 768) return;

  /* ── Sidebar slide toggle ── */
  window.toggleSidebar = function () {
    const open = document.body.classList.toggle('sidebar-open');
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.style.display = open ? 'block' : 'none';
  };

  window.closeSidebar = function () {
    document.body.classList.remove('sidebar-open');
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.style.display = 'none';
  };

  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'overlay') closeSidebar();
  });
})();
