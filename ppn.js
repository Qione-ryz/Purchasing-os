/* ═══════════════════════════════════════════
   ppn.js — PPN rate helper + theme loader
   Include di semua halaman setelah auth.js
   ═══════════════════════════════════════════ */

/**
 * Load PPN rate dari Supabase dan simpan ke window._ppnRate
 * Fallback ke 11 jika gagal atau belum ada
 */
async function loadPPNRate() {
  try {
    const { data } = await window._sb
      .from('app_settings')
      .select('value')
      .eq('key', 'ppn_rate')
      .single();
    window._ppnRate = data?.value ? parseFloat(data.value) : 11;
  } catch(e) {
    window._ppnRate = 11;
  }
}

/** Hitung harga inc PPN dari harga exc */
function toIncPPN(hargaExc) {
  const rate = window._ppnRate || 11;
  return Math.round(hargaExc * (1 + rate / 100));
}

/** Hitung harga exc PPN dari harga inc */
function toExcPPN(hargaInc) {
  const rate = window._ppnRate || 11;
  return Math.round(hargaInc / (1 + rate / 100));
}

/** Apply saved theme on page load */
function applyTheme() {
  const theme = localStorage.getItem('appTheme') || 'dark';
  document.body.classList.toggle('light-mode', theme === 'light');
}

/* Apply theme immediately to prevent flash */
applyTheme();

window.loadPPNRate = loadPPNRate;
window.toIncPPN    = toIncPPN;
window.toExcPPN    = toExcPPN;
window.applyTheme  = applyTheme;
