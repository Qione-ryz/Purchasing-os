(function() {
  var el = document.getElementById('page-loader');
  if (!el) return;
  var _t = setTimeout(function() { window.hideLoader(); }, 5000);
  window.hideLoader = function() {
    clearTimeout(_t);
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(function() { if (el) { el.remove(); el = null; } }, 350);
  };
})();
