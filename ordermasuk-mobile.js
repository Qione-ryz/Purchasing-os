/* ═══════════════════════════════════════════════════════
   ordermasuk-mobile.js
   Patch sidebar toggle untuk mobile.
   Include setelah sidebar.js:
     <script src="ordermasuk-mobile.js" defer></script>
   ═══════════════════════════════════════════════════════ */

(function () {
  if (window.innerWidth > 768) return; // hanya aktif di mobile

  /* Override toggleSidebar & closeSidebar dari sidebar.js */
  window.toggleSidebar = function () {
    document.body.classList.toggle('sidebar-open');
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.style.display = document.body.classList.contains('sidebar-open') ? 'block' : 'none';
  };

  window.closeSidebar = function () {
    document.body.classList.remove('sidebar-open');
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.style.display = 'none';
  };

  /* Klik overlay tutup sidebar */
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'overlay') closeSidebar();
  });
})();
