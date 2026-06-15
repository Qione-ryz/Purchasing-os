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

/* ── Promise-based confirm modal ── */
let _scResolve = null;

function showConfirm({ title='Konfirmasi', msg='', okLabel='Ya', cancelLabel='Batal', okDanger=false } = {}) {
  if (!document.getElementById('_ppnConfirmModal')) {
    const el = document.createElement('div');
    el.id = '_ppnConfirmModal';
    el.className = 'modal-overlay';
    el.innerHTML = `<div class="modal" style="max-width:380px">
      <div class="modal-header">
        <span class="modal-title" id="_scTitle">Konfirmasi</span>
        <button class="modal-close" onclick="window._scDone(false)">✕</button>
      </div>
      <div class="confirm-body" id="_scMsg" style="white-space:pre-line"></div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="_scCancel" onclick="window._scDone(false)">Batal</button>
        <button class="btn" id="_scOk" onclick="window._scDone(true)">Ya</button>
      </div>
    </div>`;
    document.body.appendChild(el);
  }
  return new Promise(resolve => {
    _scResolve = resolve;
    document.getElementById('_scTitle').textContent = title;
    document.getElementById('_scMsg').textContent = msg;
    const ok = document.getElementById('_scOk');
    ok.textContent = okLabel;
    ok.className = 'btn ' + (okDanger ? 'btn-danger' : 'btn-primary');
    document.getElementById('_scCancel').textContent = cancelLabel;
    document.getElementById('_ppnConfirmModal').classList.add('show');
  });
}
window._scDone = function(val) {
  const m = document.getElementById('_ppnConfirmModal');
  if (m) m.classList.remove('show');
  if (_scResolve) { _scResolve(val); _scResolve = null; }
};
window.showConfirm = showConfirm;
