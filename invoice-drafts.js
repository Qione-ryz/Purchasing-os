/* ================================================================
   invoice-drafts.js — Finance flow: OCR raw → edit → payment_requests
   Alur: Discord n8n → OCR → invoice_drafts → review nama/qty/satuan/harga → confirmed
   ================================================================ */

// ── Zoom ──────────────────────────────────────────────────────────
const DRAFT_ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 200, 300, 400];
let _draftZoomIdx = 2;  // default 75%
let _draftRotate  = 0;

// ── State ─────────────────────────────────────────────────────────
const DraftState = {
  allDrafts:       [],
  activeDraft:     null,
  vendorBankAccts: [],
  items:           [],  // [{idx, namaOcr, namaEdit, qty, satuan, harga}]
  selectedBankId:  null,
  vendorNamaOcr:   '',
  vendorNamaEdit:  '',
  tanggalEdit:     '',
  nomorFakturEdit: '',
  subtotalEdit:    0,
  ppnEdit:         0,
  grandTotalEdit:  0,
};

// ── Helpers ───────────────────────────────────────────────────────
function formatRp(n) {
  return 'Rp ' + (n || 0).toLocaleString('id-ID');
}

function formatDate(s) {
  if (!s) return '—';
  try {
    const d = new Date(s.includes('T') ? s : s + 'T00:00:00');
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return s; }
}

function getBadgeTextColor(hex) {
  if (!hex || !hex.startsWith('#')) return '#ffffff';
  try {
    const r = parseInt(hex.slice(1,3),16)/255;
    const g = parseInt(hex.slice(3,5),16)/255;
    const b = parseInt(hex.slice(5,7),16)/255;
    return (0.2126*r + 0.7152*g + 0.0722*b) > 0.4 ? '#1a1a1a' : '#ffffff';
  } catch(e) { return '#ffffff'; }
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, type = 'info') {
  const prev = document.getElementById('toastEl');
  if (prev) prev.remove();
  const t = document.createElement('div');
  t.id = 'toastEl';
  const bg = type === 'success' ? 'var(--accent3)' : type === 'error' ? 'var(--danger)' : 'var(--surface2)';
  t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 18px;border-radius:10px;background:${bg};color:#fff;font-size:13px;font-family:var(--sans);box-shadow:0 4px 20px rgba(0,0,0,.4);max-width:340px;line-height:1.4;transition:opacity .3s`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
}

function hideLoader() {
  const el = document.getElementById('page-loader');
  if (el) el.style.display = 'none';
}

// ── Image viewer ──────────────────────────────────────────────────
function _applyDraftTransform() {
  const img       = document.getElementById('draftImgEl');
  const inner     = document.getElementById('draftImgInner');
  const container = document.getElementById('draftImgView');
  if (!img || !inner) return;

  const pct     = DRAFT_ZOOM_LEVELS[_draftZoomIdx] / 100;
  const sideways = _draftRotate === 90 || _draftRotate === 270;
  const natW    = img.naturalWidth  || 1;
  const natH    = img.naturalHeight || 1;

  const zoomLbl = document.getElementById('draftZoomLabel');
  if (zoomLbl) zoomLbl.textContent = DRAFT_ZOOM_LEVELS[_draftZoomIdx] + '%';
  const rotLbl = document.getElementById('draftRotateLbl');
  if (rotLbl) rotLbl.textContent = _draftRotate + '°';

  if (sideways) {
    const cW      = container ? Math.max(100, container.clientWidth - 16) : 400;
    const renderW = Math.round(cW * pct);
    const renderH = Math.round(renderW * natH / natW);
    inner.style.cssText = [
      'width:'  + renderH + 'px',
      'height:' + renderW + 'px',
      'padding:0',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'overflow:visible',
      'box-sizing:content-box',
      'flex-shrink:0',
      'margin:8px auto',
    ].join(';') + ';';
    img.style.width           = renderW + 'px';
    img.style.height          = renderH + 'px';
    img.style.maxWidth        = 'none';
    img.style.transformOrigin = 'center center';
    img.style.transform       = 'rotate(' + _draftRotate + 'deg)';
    img.style.flexShrink      = '0';
    img.style.display         = 'block';
  } else {
    const cW   = container ? Math.max(100, container.clientWidth) : 400;
    const pad  = 16;
    const imgW = Math.round((cW - pad) * pct);
    const innerW = Math.max(cW, imgW + pad);
    inner.style.cssText = 'display:block;padding:8px;box-sizing:border-box;width:' + innerW + 'px;';
    img.style.width           = imgW + 'px';
    img.style.height          = 'auto';
    img.style.maxWidth        = 'none';
    img.style.transformOrigin = 'center center';
    img.style.transform       = 'rotate(' + _draftRotate + 'deg)';
    img.style.flexShrink      = '';
    img.style.display         = 'block';
  }
}

function draftImgZoom(dir) {
  _draftZoomIdx = Math.min(DRAFT_ZOOM_LEVELS.length - 1, Math.max(0, _draftZoomIdx + dir));
  _applyDraftTransform();
}

function draftImgRotate(dir) {
  _draftRotate = (_draftRotate + dir * 90 + 360) % 360;
  _applyDraftTransform();
}

function draftImgReset() {
  _draftZoomIdx = 2;  // 75%
  _draftRotate  = 0;
  _applyDraftTransform();
}

// ── Drag-to-pan + Ctrl+Scroll zoom ────────────────────────────────
(function initDraftImgInteraction() {
  function setup() {
    const view = document.getElementById('draftImgView');
    if (!view || view._draftInteractionReady) return;
    view._draftInteractionReady = true;

    let _dragging = false, _sx = 0, _sy = 0, _sl = 0, _st = 0;

    view.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      _dragging = true;
      _sx = e.clientX; _sy = e.clientY;
      _sl = view.scrollLeft; _st = view.scrollTop;
      view.style.cursor = 'grabbing';
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!_dragging) return;
      view.scrollLeft = _sl - (e.clientX - _sx);
      view.scrollTop  = _st - (e.clientY - _sy);
    });
    window.addEventListener('mouseup', () => {
      if (_dragging) { _dragging = false; view.style.cursor = 'grab'; }
    });

    view.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      draftImgZoom(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
}());

// ── Master data (vendor only) ─────────────────────────────────────
async function loadMasterData() {
  // vendor dropdown removed
}

async function loadBrands() {
  const { data } = await window._sb.from('brands').select('*').order('nama');
  window.allBrands = data || [];
  const inlineSel  = document.getElementById('filterBrand');
  const sidebarSel = document.getElementById('brandSelect');
  (data || []).forEach(b => {
    [inlineSel, sidebarSel].forEach(el => {
      if (!el) return;
      const o = document.createElement('option');
      o.value = b.id; o.textContent = b.nama;
      el.appendChild(o);
    });
  });
  if (inlineSel)  inlineSel.value  = 'all';
  if (sidebarSel) sidebarSel.value = 'all';
  _updateBrandLabel();
  _renderBrandSelectGrid();
}

function _renderBrandSelectGrid() {
  const grid = document.getElementById('brandSelectGrid');
  if (!grid) return;
  grid.innerHTML = (window.allBrands || []).map(b => {
    const color = b.warna || '#4f8ef7';
    return `<div onclick="selectBrandAndLoad('${b.id}')"
      style="display:flex;align-items:center;gap:14px;padding:20px 28px;background:var(--surface);border:1px solid var(--border);border-radius:14px;cursor:pointer;min-width:200px;transition:all .15s"
      onmouseover="this.style.borderColor='${color}';this.style.background='${color}18';this.style.transform='translateY(-2px)'"
      onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--surface)';this.style.transform='translateY(0)'">
      <div style="width:16px;height:16px;border-radius:50%;background:${color};flex-shrink:0;box-shadow:0 0 10px ${color}88"></div>
      <span style="font-size:16px;font-weight:600;color:var(--text)">${b.nama}</span>
    </div>`;
  }).join('');
}

function selectBrandAndLoad(brandId) {
  const inlineSel = document.getElementById('filterBrand');
  if (inlineSel) inlineSel.value = brandId;
  localStorage.setItem('draftActiveBrand', brandId);
  document.getElementById('brandSelectScreen').style.display = 'none';
  onFilterBrandChange();
}
window.selectBrandAndLoad = selectBrandAndLoad;

function _updateBrandLabel() {
  const sel = document.getElementById('filterBrand');
  const lbl = document.getElementById('activeBrandLabel');
  if (!sel || !lbl) return;
  const opt = sel.options[sel.selectedIndex];
  lbl.textContent = (!opt?.value || opt.value === 'all') ? 'Semua Brand' : opt.textContent;
}

function onFilterBrandChange() {
  const sel = document.getElementById('filterBrand');
  const sidebarSel = document.getElementById('brandSelect');
  if (sidebarSel && sel) sidebarSel.value = sel.value;
  if (sel?.value && sel.value !== 'all') {
    localStorage.setItem('draftActiveBrand', sel.value);
    const screen = document.getElementById('brandSelectScreen');
    if (screen) screen.style.display = 'none';
  } else {
    localStorage.removeItem('draftActiveBrand');
  }
  _updateBrandLabel();
  loadDrafts();
}

function onBrandChange() { onFilterBrandChange(); }

// ── Status tab ────────────────────────────────────────────────────
function setStatusTab(status) {
  document.querySelectorAll('#statusTabBar .status-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === status);
  });
  const sel = document.getElementById('filterStatus');
  if (sel) sel.value = status;
  loadDrafts();
}
window.setStatusTab = setStatusTab;

// ── Refresh ───────────────────────────────────────────────────────
window.refreshDraftsData = async function() {
  const btn = document.getElementById('btnRefreshData');
  const origHTML = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '⟳ Memuat...'; }
  try {
    const savedBrand = localStorage.getItem('draftActiveBrand');
    ['filterBrand','brandSelect'].forEach(id => {
      const bs = document.getElementById(id);
      if (bs) { const first = bs.querySelector('option'); bs.innerHTML = ''; if (first) bs.appendChild(first); }
    });
    await loadMasterData();
    await loadBrands();
    // Restore brand filter setelah brand options dimuat ulang
    if (savedBrand) {
      ['filterBrand','brandSelect'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = savedBrand;
      });
      _updateBrandLabel();
    }
    await loadDrafts();
    showToast('✓ Data diperbarui', 'success');
  } catch (e) {
    showToast('Gagal refresh: ' + e.message, 'error');
  }
  if (btn) { btn.disabled = false; btn.innerHTML = origHTML || 'Refresh Data'; }
};

// ── Load drafts ───────────────────────────────────────────────────
async function loadDrafts() {
  const sb     = window._sb;
  const status = document.getElementById('filterStatus')?.value ?? '';
  const brand  = document.getElementById('filterBrand')?.value ?? 'all';

  document.getElementById('draftItems').innerHTML =
    `<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">Memuat...</div>`;

  let q = sb.from('invoice_drafts').select('*, brands(nama)').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (brand && brand !== 'all') q = q.eq('brand_id', brand);

  const { data, error } = await q;
  if (error) { showToast('Gagal memuat draft: ' + error.message, 'error'); return; }

  DraftState.allDrafts = data || [];

  // Cek duplikat nomor_faktur dari SEMUA invoice_drafts di database
  const { data: allRows } = await sb.from('invoice_drafts').select('ocr_result');
  const _fc = {};
  (allRows || []).forEach(row => {
    const f = ((row.ocr_result || {}).nomor_faktur || '').trim();
    if (f) _fc[f] = (_fc[f] || 0) + 1;
  });
  window._dupFakturs = new Set(Object.keys(_fc).filter(k => _fc[k] > 1));

  _draftListPage = 1;
  renderDraftList();
}

let _draftListPage = 1;
const DRAFT_LIST_PER = 20;

function filterDraftList() {
  _draftListPage = 1;
  renderDraftList();
  document.getElementById('draftItems')?.scrollTo({ top: 0 });
}

const _STATUS_BADGE = {
  needs_review: `<span class="badge badge-orange" style="font-size:10px;white-space:nowrap">Perlu Review</span>`,
  confirmed:    `<span class="badge badge-green"  style="font-size:10px">Confirmed</span>`,
  rejected:     `<span class="badge badge-red"    style="font-size:10px">Rejected</span>`,
};

function renderDraftList() {
  const q = (document.getElementById('searchDraft')?.value || '').toLowerCase().trim();
  const drafts = q
    ? DraftState.allDrafts.filter(d => {
        const o = d.ocr_result || {};
        const v = (o.vendor || o.nama_vendor || '').toLowerCase();
        const f = (o.nomor_faktur || o.nomor_invoice || '').toLowerCase();
        return v.includes(q) || f.includes(q);
      })
    : DraftState.allDrafts;

  const el   = document.getElementById('draftItems');
  const chip = document.getElementById('draftCountChip');
  if (chip) {
    const n = drafts.length;
    if (n > 0) { chip.textContent = `${n} draft`; chip.style.display = 'inline-block'; }
    else chip.style.display = 'none';
  }
  if (!drafts.length) {
    el.innerHTML = `<div style="padding:32px 16px;text-align:center;color:var(--muted);font-size:13px"><div style="font-size:28px;margin-bottom:8px;opacity:.6">📭</div>Tidak ada draft</div>`;
    return;
  }

  const total = drafts.length;
  const pages = Math.ceil(total / DRAFT_LIST_PER);
  _draftListPage = Math.min(_draftListPage, pages);
  const start = (_draftListPage - 1) * DRAFT_LIST_PER;
  const paged = drafts.slice(start, start + DRAFT_LIST_PER);


  el.innerHTML = paged.map(d => {
    const ocr    = d.ocr_result || {};
    const vendor = ocr.vendor || ocr.nama_vendor || '—';
    const faktur = ocr.nomor_faktur || ocr.nomor_invoice || '—';
    const brand      = d.brands?.nama || '';
    const brandColor = (window.allBrands||[]).find(b => b.id === d.brand_id)?.warna || '#4f8ef7';
    const totalNum = ocr.total || (Array.isArray(ocr.items)
      ? ocr.items.reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat(it.harga_satuan ?? it.harga) || 0), 0)
      : 0);
    const tot      = totalNum ? formatRp(totalNum) : '—';
    const date     = formatDate(d.created_at);
    const badge    = _STATUS_BADGE[d.status] || '';
    const isActive = d.id === DraftState.activeDraft?.id;
    const fKey  = faktur.trim();
    const isDup = fKey && fKey !== '—' && window._dupFakturs?.has(fKey);
    const dupBadge = isDup ? `<span style="font-size:9px;font-family:'DM Mono',monospace;color:var(--accent3);background:rgba(247,146,79,0.12);border:1px solid rgba(247,146,79,0.25);border-radius:4px;padding:1px 5px;white-space:nowrap;flex-shrink:0">⚠ duplikat</span>` : '';
    return `<div class="nav-item${isActive ? ' active' : ''}"
      style="flex-direction:column;align-items:flex-start;gap:4px;padding:10px 12px;cursor:pointer;border-radius:var(--radius-sm);margin-bottom:4px${isDup ? ';border-left:2px solid rgba(247,146,79,0.5)' : ''}"
      onclick="selectDraft('${d.id}')">
      <div style="display:flex;justify-content:space-between;width:100%;gap:6px;align-items:center">
        <span style="font-size:13px;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(vendor)}</span>
        ${badge}
      </div>
      <div style="display:flex;justify-content:space-between;width:100%;gap:6px;align-items:center">
        <span style="font-size:11px;color:var(--muted);font-family:'DM Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${escHtml(faktur)}</span>
        <span style="font-size:11px;color:var(--muted);white-space:nowrap">${date}</span>
      </div>
      <div style="display:flex;justify-content:space-between;width:100%;gap:6px;align-items:center">
        <span style="font-size:11px;color:var(--accent3);font-family:'DM Mono',monospace">${tot}</span>
        <div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
          ${brand ? `<span class="badge" style="background:${brandColor};color:${getBadgeTextColor(brandColor)};padding:3px 10px;font-size:11px;font-weight:500">${escHtml(brand)}</span>` : ''}
          ${dupBadge}
        </div>
      </div>
    </div>`;
  }).join('');

  // Pagination bar (terpisah dari scroll area)
  const pagin = document.getElementById('draftPagin');
  if (pagin) {
    if (pages > 1) {
      pagin.style.display = 'flex';
      pagin.innerHTML = `
        <button onclick="_draftGoPage(${_draftListPage - 1})" ${_draftListPage <= 1 ? 'disabled' : ''}
          style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;opacity:${_draftListPage <= 1 ? '.3' : '1'}">‹</button>
        <span style="flex:1;text-align:center;font-size:11px;font-family:'DM Mono',monospace;color:var(--muted)">${start + 1}–${Math.min(start + DRAFT_LIST_PER, total)} / ${total}</span>
        <button onclick="_draftGoPage(${_draftListPage + 1})" ${_draftListPage >= pages ? 'disabled' : ''}
          style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;opacity:${_draftListPage >= pages ? '.3' : '1'}">›</button>`;
    } else {
      pagin.style.display = 'none';
    }
  }
}

function _draftGoPage(p) {
  _draftListPage = p;
  renderDraftList();
  document.getElementById('draftItems')?.scrollTo({ top: 0 });
}
window._draftGoPage = _draftGoPage;

// ── Select draft ──────────────────────────────────────────────────
async function selectDraft(id) {
  const draft = DraftState.allDrafts.find(d => d.id === id);
  if (!draft) return;

  DraftState.activeDraft = draft;
  renderDraftList();

  if (window.innerWidth <= 768) {
    document.getElementById('draftListPanel')?.classList.remove('drawer-open');
    document.getElementById('draftDrawerOverlay')?.classList.remove('show');
  }

  document.getElementById('emptyReview').style.display = 'none';
  const rc = document.getElementById('reviewContent');
  rc.style.display = 'flex';

  _draftZoomIdx = 2; _draftRotate = 0;
  const img = document.getElementById('draftImgEl');
  const view = document.getElementById('draftImgView');
  if (img) {
    img.style.transform = '';
    img.onload = () => _applyDraftTransform();
    img.src = draft.image_url || '';
    img.style.display = draft.image_url ? 'block' : 'none';
    if (view) view.scrollLeft = 0, view.scrollTop = 0;
  }

  const ocr = draft.ocr_result || {};

  // Items: raw editable dari OCR
  DraftState.items = (ocr.items || []).map((item, idx) => ({
    idx,
    namaOcr:  item.nama || item.nama_item || '',
    namaEdit: item.nama || item.nama_item || '',
    qty:      parseFloat(item.qty) || 1,
    satuan:   item.satuan || '',
    harga:    parseFloat(item.harga_satuan ?? item.harga) || 0,
  }));

  // Vendor: tampilkan OCR text, user pilih manual
  DraftState.vendorNamaOcr   = ocr.vendor || ocr.nama_vendor || '';
  DraftState.vendorNamaEdit  = DraftState.vendorNamaOcr;
  DraftState.tanggalEdit     = ocr.tanggal || ocr.tanggal_invoice || '';
  DraftState.nomorFakturEdit = ocr.nomor_faktur || ocr.nomor_invoice || '';
  DraftState.subtotalEdit    = Number(ocr.subtotal)                         || 0;
  DraftState.ppnEdit         = Number(ocr.ppn_amount ?? ocr.ppn)            || 0;
  DraftState.grandTotalEdit  = Number(ocr.grand_total)                      || 0;
  DraftState.vendorBankAccts = [];
  DraftState.selectedBankId  = null;

  // Deteksi tahun terlalu jauh di belakang (≥1 tahun)
  DraftState._tanggalTahunLama = false;
  DraftState._tanggalAsliStr   = '';
  if (DraftState.tanggalEdit) {
    const parsed = new Date(DraftState.tanggalEdit);
    const now    = new Date();
    if (!isNaN(parsed) && (now.getFullYear() - parsed.getFullYear()) >= 1) {
      DraftState._tanggalTahunLama = true;
      DraftState._tanggalAsliStr   = DraftState.tanggalEdit;
    }
  }

  renderInfoSection();
  renderItemsSection();
  renderSummarySection();
}

// ── Status chip ───────────────────────────────────────────────────
const _STATUS_CHIP = {
  needs_review: `<span style="background:rgba(247,146,79,0.15);color:var(--accent3);border:1px solid rgba(247,146,79,0.3);padding:3px 9px;border-radius:10px;font-family:var(--mono);font-size:11px">⏳ Perlu Review</span>`,
  confirmed:    `<span style="background:rgba(56,217,169,0.15);color:var(--accent2);border:1px solid rgba(56,217,169,0.3);padding:3px 9px;border-radius:10px;font-family:var(--mono);font-size:11px">✓ Confirmed</span>`,
  rejected:     `<span style="background:rgba(255,77,106,0.12);color:var(--danger);border:1px solid rgba(255,77,106,0.3);padding:3px 9px;border-radius:10px;font-family:var(--mono);font-size:11px">✕ Rejected</span>`,
};

// ── Load bank accounts ────────────────────────────────────────────
async function loadVendorBankAccts(vendorId) {
  const { data } = await window._sb.from('vendor_bank_accounts')
    .select('*').eq('vendor_id', vendorId).order('is_primary', { ascending: false });
  DraftState.vendorBankAccts = data || [];
  DraftState.selectedBankId  = data?.[0]?.id || null;
}

// ── Info section ──────────────────────────────────────────────────
function renderInfoSection() {
  const draft = DraftState.activeDraft;
  if (!draft) return;
  const ocr = draft.ocr_result || {};

  const chip = document.getElementById('draftStatusChip');
  if (chip) chip.innerHTML = _STATUS_CHIP[draft.status] || '';

  const nomorFaktur = ocr.nomor_faktur || ocr.nomor_invoice || '';

  const bankHTML = DraftState.vendorBankAccts.length
    ? `<select id="bankSelect" onchange="DraftState.selectedBankId=this.value">
        ${DraftState.vendorBankAccts.map(a =>
          `<option value="${escHtml(a.id)}" ${a.id === DraftState.selectedBankId ? 'selected' : ''}>
            ${escHtml(a.bank_name)} — ${escHtml(a.account_number)} (${escHtml(a.account_name)})
           </option>`
        ).join('')}
       </select>`
    : `<div style="font-size:11px;color:var(--muted);font-family:var(--mono);padding:8px 0">Tidak ada rekening terdaftar</div>`;


  const _inp = (style='') => `background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:var(--mono);outline:none;padding:6px 10px;width:100%;box-sizing:border-box;font-size:13px;${style}`;

  const brandNama  = draft.brands?.nama || '';
  const brandWarna = (window.allBrands||[]).find(b => b.id === draft.brand_id)?.warna || '#4f8ef7';

  document.getElementById('infoSection').innerHTML = `
    <!-- Brand -->
    ${brandNama ? `<div style="margin-bottom:10px"><span class="badge" style="background:${brandWarna};color:${getBadgeTextColor(brandWarna)};padding:4px 14px;font-size:13px;font-weight:600">${escHtml(brandNama)}</span></div>` : ''}

    <!-- Row 1: No Faktur + Tanggal + Meta -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
      <div>
        <div style="font-size:9px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">No. Faktur</div>
        <input type="text" id="nomorFakturInput"
          value="${escHtml(DraftState.nomorFakturEdit)}"
          placeholder="Nomor faktur..."
          onchange="DraftState.nomorFakturEdit=this.value"
          style="${_inp('color:var(--accent);font-weight:600')}"/>
      </div>
      <div>
        <div style="font-size:9px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">Tanggal Invoice</div>
        <input type="date" id="tanggalInvoiceInput"
          value="${escHtml(DraftState.tanggalEdit)}"
          onchange="DraftState.tanggalEdit=this.value;DraftState._tanggalTahunLama=false;document.getElementById('tanggalTahunLamaWarn')?.remove()"
          style="${_inp(`border-color:${DraftState._tanggalTahunLama ? 'rgba(247,146,79,0.6)' : 'var(--border)'}`)};cursor:pointer"/>
        ${DraftState._tanggalTahunLama ? `<div id="tanggalTahunLamaWarn" style="margin-top:4px;padding:4px 8px;background:rgba(247,146,79,0.08);border:1px solid rgba(247,146,79,0.3);border-radius:5px;font-size:10px;font-family:var(--mono);color:rgba(247,146,79,0.9)">⚠ Tahun <strong>${new Date(DraftState._tanggalAsliStr).getFullYear()}</strong> — periksa ulang</div>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <div style="font-size:9px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">Masuk</div>
          <div style="font-size:12px;font-family:var(--mono);color:var(--muted);padding:7px 0">${formatDate(draft.created_at)}</div>
        </div>
        <div>
          <div style="font-size:9px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">Sumber</div>
          <div style="font-size:12px;font-family:var(--mono);color:var(--accent3);font-weight:500;padding:7px 0">${escHtml(draft.source || 'discord')}</div>
        </div>
      </div>
    </div>

    <!-- Row 2: Vendor + Rekening -->
    <div class="field-row" style="margin-bottom:10px">
      <div class="field" style="margin-bottom:0">
        <label style="margin-bottom:4px">Vendor</label>
        ${DraftState.vendorNamaOcr ? `<div style="font-size:10px;color:var(--accent3);font-family:var(--mono);margin-bottom:4px">OCR: ${escHtml(DraftState.vendorNamaOcr)}</div>` : ''}
        <input type="text" id="vendorInput"
          placeholder="Ketik nama vendor..."
          value="${escHtml(DraftState.vendorNamaEdit)}"
          onchange="DraftState.vendorNamaEdit=this.value"/>
      </div>
      <div class="field" style="margin-bottom:0">
        <label style="margin-bottom:4px">Rekening Tujuan</label>
        <div id="bankSelectContainer">${bankHTML}</div>
      </div>
    </div>
  `;
}

// setDraftPPN removed

function updateBankSection() {
  const container = document.getElementById('bankSelectContainer');
  if (!container) return;
  const bankHTML = DraftState.vendorBankAccts.length
    ? `<select id="bankSelect" onchange="DraftState.selectedBankId=this.value">
        ${DraftState.vendorBankAccts.map(a =>
          `<option value="${escHtml(a.id)}" ${a.id === DraftState.selectedBankId ? 'selected' : ''}>
            ${escHtml(a.bank_name)} — ${escHtml(a.account_number)} (${escHtml(a.account_name)})
           </option>`
        ).join('')}
       </select>`
    : `<div style="font-size:11px;color:var(--muted);font-family:var(--mono);padding:8px 0">Tidak ada rekening terdaftar</div>`;
  container.innerHTML = bankHTML;
}

// onVendorInputChange / onVendorInputBlur removed

// ── Items section (raw editable) ──────────────────────────────────
function renderItemsSection() {
  const el   = document.getElementById('itemsSection');
  const chip = document.getElementById('itemCountChip');
  if (chip) chip.textContent = `${DraftState.items.length} item`;

  if (!DraftState.items.length) {
    el.innerHTML = `
      <div class="empty-state" style="padding:20px;text-align:center;color:var(--muted);font-size:13px">Tidak ada item dari OCR</div>
      <div style="padding:8px 0">
        <button class="btn btn-ghost btn-sm" onclick="addItemRow()" style="width:100%;justify-content:center">＋ Tambah Item</button>
      </div>`;
    return;
  }

  el.innerHTML = `
    <!-- Header kolom -->
    <div style="display:flex;align-items:center;padding:4px 6px;gap:6px;border-bottom:1px solid var(--border);margin-bottom:2px">
      <div style="flex:1;font-size:9px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Nama Barang</div>
      <div style="width:64px;flex-shrink:0;text-align:right;font-size:9px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Qty</div>
      <div style="width:72px;flex-shrink:0;text-align:center;font-size:9px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Satuan</div>
      <div style="width:120px;flex-shrink:0;text-align:right;font-size:9px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Harga Sat.</div>
      <div style="width:24px;flex-shrink:0"></div>
    </div>
    <!-- Rows -->
    <div id="draftItemRows">${DraftState.items.map(renderItemRow).join('')}</div>
    <!-- Add button -->
    <div style="padding:6px 0 2px">
      <button class="btn btn-ghost btn-sm" onclick="addItemRow()" style="width:100%;justify-content:center">＋ Tambah Item</button>
    </div>`;
}

function renderItemRow(item) {
  const subtotal = formatRp(item.qty * item.harga);
  return `
    <div style="padding:6px;border-bottom:1px solid rgba(255,255,255,0.04)">
      <div style="font-size:10px;font-family:var(--mono);color:var(--accent3);margin-bottom:3px">📄 ${escHtml(item.namaOcr || '—')}</div>
      <div style="display:flex;align-items:center;gap:6px">
        <input class="item-input" type="text" style="flex:1;min-width:0;text-align:left" value="${escHtml(item.namaEdit)}" placeholder="Nama barang"
          onchange="updateItemField(${item.idx},'namaEdit',this.value)"/>
        <input class="item-input" type="text" inputmode="decimal" value="${item.qty}" style="width:64px;flex-shrink:0;text-align:right"
          oninput="this.value=this.value.replace(',','.');updateItemField(${item.idx},'qty',parseFloat(this.value)||0)"
          onblur="this.value=parseFloat(this.value)||0"/>
        <input class="item-input" type="text" value="${escHtml(item.satuan)}" style="width:72px;flex-shrink:0;text-align:center"
          onchange="updateItemField(${item.idx},'satuan',this.value)"/>
        <input class="item-input" type="text" inputmode="decimal" value="${item.harga}" style="width:120px;flex-shrink:0;text-align:right"
          oninput="this.value=this.value.replace(',','.');updateItemField(${item.idx},'harga',parseFloat(this.value)||0)"
          onblur="this.value=parseFloat(this.value)||0"/>
        <button onclick="removeItemRow(${item.idx})" style="width:24px;flex-shrink:0;background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:0;line-height:1" title="Hapus">✕</button>
      </div>
      <div style="text-align:right;font-size:11px;color:var(--muted);font-family:var(--mono);margin-top:3px" id="draftSub_${item.idx}">${subtotal}</div>
    </div>`;
}

function addItemRow() {
  const idx = DraftState.items.length;
  DraftState.items.push({ idx, namaOcr: '', namaEdit: '', qty: 1, satuan: '', harga: 0 });
  renderItemsSection();
  renderSummarySection();
}

function removeItemRow(idx) {
  DraftState.items.splice(idx, 1);
  DraftState.items.forEach((it, i) => { it.idx = i; });
  renderItemsSection();
  renderSummarySection();
}

function updateItemField(idx, field, val) {
  DraftState.items[idx][field] = val;
  const sub = document.getElementById(`draftSub_${idx}`);
  if (sub) {
    const it = DraftState.items[idx];
    sub.textContent = formatRp(it.qty * it.harga);
  }
  renderSummarySection();
}

// ── Summary action bar ────────────────────────────────────────────
function renderSummarySection() {
  const draft = DraftState.activeDraft;
  if (!draft) return;
  const isDone = draft.status === 'confirmed' || draft.status === 'rejected';
  const _inp   = (style='') => `background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:var(--mono);outline:none;padding:10px 14px;width:100%;box-sizing:border-box;font-size:15px;font-weight:600;${style}`;

  document.getElementById('summarySection').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
      <div>
        <div style="font-size:9px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">Subtotal (exc. PPN)</div>
        <input type="number" min="0" step="1"
          value="${DraftState.subtotalEdit || ''}" placeholder="0"
          onchange="DraftState.subtotalEdit=Number(this.value)"
          style="${_inp()}"/>
      </div>
      <div>
        <div style="font-size:9px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">PPN</div>
        <input type="number" min="0" step="1"
          value="${DraftState.ppnEdit || ''}" placeholder="0"
          onchange="DraftState.ppnEdit=Number(this.value)"
          style="${_inp()}"/>
      </div>
      <div>
        <div style="font-size:9px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">Grand Total</div>
        <input type="number" min="0" step="1"
          value="${DraftState.grandTotalEdit || ''}" placeholder="0"
          onchange="DraftState.grandTotalEdit=Number(this.value)"
          style="${_inp('color:var(--accent2);font-weight:600')}"/>
      </div>
    </div>
    ${!isDone
      ? `<div style="display:flex;gap:8px;justify-content:flex-end">
           <button class="btn btn-ghost is-destructive" onclick="openRejectModal()">✕ Tolak</button>
           <button class="btn btn-primary" onclick="confirmDraft()">✓ Konfirmasi → Pembayaran</button>
         </div>`
      : `<div style="display:flex;gap:8px;align-items:center;justify-content:flex-end">
           <span style="font-size:12px;color:var(--muted)">Draft sudah ${draft.status}.</span>
           ${draft.status === 'confirmed'
             ? `<button class="btn btn-ghost is-destructive" style="font-size:12px" onclick="undoConfirmDraft()">↩ Batal Konfirmasi</button>`
             : ''}
         </div>`}
  `;
}

// ── Duplikat check — port dari pembelian.html (proven working) ────
let _dupCheckTimer = null;
function checkDuplikatDraft(val) {
  clearTimeout(_dupCheckTimer);
  const v = (val || '').trim();
  const hint = document.getElementById('duplikatWarning');
  if (!hint) return;
  if (!v) { hint.innerHTML = ''; hint.style.display = 'none'; return; }
  hint.innerHTML = '';

  _dupCheckTimer = setTimeout(async () => {
    const draftId = DraftState.activeDraft?.id;
    const [r1, r2, r3] = await Promise.all([
      window._sb.from('invoice_drafts')
        .select('id,ocr_result,brand_id,created_at,status,purchased_at,discord_rejected_at')
        .filter('ocr_result->>nomor_faktur', 'eq', v)
        .neq('id', draftId),
      window._sb.from('invoice_drafts')
        .select('id,ocr_result,brand_id,created_at,status,purchased_at,discord_rejected_at')
        .filter('ocr_result->>nomor_invoice', 'eq', v)
        .neq('id', draftId),
      window._sb.from('riwayat_beli')
        .select('id,tanggal,nomor_faktur,total,status')
        .eq('nomor_faktur', v),
    ]);

    const seen = new Set();
    const dupDrafts = [...(r1.data||[]), ...(r2.data||[])].filter(r => {
      if (seen.has(r.id)) return false; seen.add(r.id); return true;
    }).sort((a,b) => new Date(a.created_at)-new Date(b.created_at));
    const dupBeli = r3.data || [];

    const hintEl = document.getElementById('duplikatWarning');
    if (!hintEl) return;
    if (!dupDrafts.length && !dupBeli.length) { hintEl.innerHTML = ''; hintEl.style.display = 'none'; return; }

    const stDraft = r => {
      if (r.purchased_at)        return { lbl:'Sudah Input',  clr:'var(--accent2)' };
      if (r.discord_rejected_at) return { lbl:'Ditolak',      clr:'var(--danger)'  };
      return                            { lbl:'Belum Dicek',  clr:'var(--muted)'   };
    };
    const stBeli = r => ({
      selesai: { lbl:'✓ Selesai', clr:'var(--accent2)' },
      pending: { lbl:'⏳ Pending', clr:'var(--accent3)' },
      batal:   { lbl:'✕ Batal',   clr:'var(--danger)'  },
    }[r.status] || { lbl:r.status||'—', clr:'var(--muted)' });

    const draftRows = dupDrafts.map((r, idx) => {
      const o      = r.ocr_result || {};
      const vendor = o.vendor || o.nama_vendor || '—';
      const tgl    = formatDate(r.created_at);
      const bNama  = (window.allBrands||[]).find(x=>x.id===r.brand_id)?.nama || '';
      const st     = stDraft(r);
      return `<div style="display:flex;align-items:center;gap:8px;padding:7px 8px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:11px">
        <span style="font-size:9px;color:${idx===0?'var(--muted)':'var(--accent3)'};font-family:var(--mono);white-space:nowrap;flex-shrink:0">${idx===0?'1st':'+'+(idx+1)}</span>
        <div style="flex:1;min-width:0">
          <div style="color:var(--text);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(vendor)}</div>
          <div style="color:var(--muted);font-family:var(--mono);font-size:10px">${tgl}${bNama?' · '+escHtml(bNama):''}</div>
        </div>
        <span style="font-size:10px;color:${st.clr};white-space:nowrap;flex-shrink:0">${st.lbl}</span>
      </div>`;
    }).join('');

    const beliRows = dupBeli.map(r => {
      const st  = stBeli(r);
      const tot = r.total ? formatRp(Math.round(r.total)) : '—';
      return `<div style="display:flex;align-items:center;gap:8px;padding:7px 8px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:11px">
        <span style="font-size:9px;color:var(--accent2);font-family:var(--mono);white-space:nowrap;flex-shrink:0">riwayat</span>
        <div style="flex:1;min-width:0">
          <div style="color:var(--text);font-weight:500">${r.tanggal || '—'}</div>
        </div>
        <div style="font-family:var(--mono);color:var(--accent2);font-size:11px;white-space:nowrap">${tot}</div>
        <span style="font-size:10px;color:${st.clr};white-space:nowrap;flex-shrink:0">${st.lbl}</span>
      </div>`;
    }).join('');

    const total = dupDrafts.length + dupBeli.length;
    hintEl.innerHTML = `<div style="border:1px solid rgba(247,146,79,0.3);border-radius:8px;overflow:hidden">
      <div style="background:rgba(247,146,79,0.10);padding:6px 10px;font-size:11px;font-family:var(--mono);color:var(--accent3);font-weight:600">
        ⚠ ${total} entri dengan nomor faktur yang sama
      </div>${draftRows}${beliRows}
    </div>`;
    hintEl.style.display = 'block';
  }, 400);
}
window.checkDuplikatDraft = checkDuplikatDraft;

// ── Reject modal ──────────────────────────────────────────────────
function openRejectModal() {
  document.getElementById('rejectReason').value = '';
  document.getElementById('rejectModal').style.display = 'flex';
  setTimeout(() => document.getElementById('rejectReason')?.focus(), 40);
}

function closeRejectModal() {
  document.getElementById('rejectModal').style.display = 'none';
}

async function doReject() {
  const draft = DraftState.activeDraft;
  if (!draft) return;

  const { data: { user } } = await window._sb.auth.getUser();
  const { error } = await window._sb.from('invoice_drafts').update({
    status:      'rejected',
    reviewed_by: user?.id || null,
    reviewed_at: new Date().toISOString(),
  }).eq('id', draft.id);

  if (error) { showToast('Gagal menolak: ' + error.message, 'error'); return; }

  closeRejectModal();
  showToast('Draft ditolak', 'success');
  DraftState.activeDraft.status = 'rejected';
  renderInfoSection();
  renderSummarySection();
  loadDrafts();
}

// ── Confirm draft → riwayat_beli + payment_requests ───────────────
async function confirmDraft() {
  const draft = DraftState.activeDraft;
  if (!draft) return;

  if (!DraftState.vendorNamaEdit.trim()) {
    showToast('Nama vendor wajib diisi', 'error'); return;
  }

  const sb          = window._sb;
  const ocr         = draft.ocr_result || {};
  const ppnRate     = (window._ppnRate || 11) / 100;
  const ppnIncluded = ocr.ppn_included !== false;
  const subtotal    = DraftState.items.reduce((s, i) => s + i.qty * i.harga, 0);
  const subEx       = ppnIncluded ? subtotal / (1 + ppnRate) : subtotal;
  const ppnAmt      = subEx * ppnRate;
  const diskon      = Number(ocr.diskon) || 0;
  const ongkir      = Number(ocr.ongkir) || 0;
  const total       = Math.round(subEx + ppnAmt - diskon + ongkir);
  const tanggal     = DraftState.tanggalEdit || new Date().toISOString().slice(0, 10);
  const { data: { user } } = await sb.auth.getUser();

  try {
    // 1. riwayat_beli
    const { data: beli, error: beliErr } = await sb.from('riwayat_beli').insert({
      tanggal,
      nomor_faktur: DraftState.nomorFakturEdit || ocr.nomor_faktur || ocr.nomor_invoice || null,
      vendor_id:    null,
      brand_id:     draft.brand_id,
      catatan:      null,
      status:       'selesai',
      ppn_included: ppnIncluded,
      diskon, diskon_mode: 'nominal', diskon_pct: 0, ongkir,
      subtotal:     Math.round(subEx + ppnAmt),
      total,
      updated_at:   new Date().toISOString(),
    }).select().single();
    if (beliErr) throw beliErr;

    // 2. riwayat_beli_items — semua is_unmatched=true, barang_id=null
    const itemPayloads = DraftState.items.map(item => {
      const hExc = ppnIncluded ? Math.round(item.harga / (1 + ppnRate)) : item.harga;
      const hInc = ppnIncluded ? item.harga : Math.round(item.harga * (1 + ppnRate));
      return {
        beli_id:        beli.id,
        brand_id:       draft.brand_id,
        barang_id:      null,
        nama:           item.namaEdit || item.namaOcr,
        sku:            '',
        satuan:         item.satuan || '',
        qty:            item.qty,
        harga_satuan:   hExc,
        harga_exc_ppn:  hExc,
        harga_inc_ppn:  hInc,
        ppn_included:   ppnIncluded,
        subtotal:       item.qty * hExc,
        is_unmatched:   true,
        unmatched_nama: item.namaOcr || item.namaEdit,
      };
    });
    const { error: itemErr } = await sb.from('riwayat_beli_items').insert(itemPayloads);
    if (itemErr) throw itemErr;

    // 3. payment_requests
    const { error: payErr } = await sb.from('payment_requests').insert({
      riwayat_beli_id: beli.id,
      vendor_id:       null,
      brand_id:        draft.brand_id,
      amount:          total,
      status_payment:  'pending',
      status_xero:     'not_input',
      bank_account_id: DraftState.selectedBankId || null,
    });
    if (payErr) throw payErr;

    // 4. Update invoice_drafts
    const { error: draftErr } = await sb.from('invoice_drafts').update({
      status:          'confirmed',
      reviewed_by:     user?.id || null,
      reviewed_at:     new Date().toISOString(),
      riwayat_beli_id: beli.id,
    }).eq('id', draft.id);
    if (draftErr) throw draftErr;

    showToast('✓ Draft dikonfirmasi — pembayaran dibuat', 'success');
    DraftState.activeDraft.status          = 'confirmed';
    DraftState.activeDraft.riwayat_beli_id = beli.id;
    renderInfoSection();
    renderSummarySection();
    loadDrafts();

  } catch(e) {
    showToast('Gagal konfirmasi: ' + (e.message || e), 'error');
  }
}

// ── Undo Konfirmasi ───────────────────────────────────────────────
async function undoConfirmDraft() {
  const draft = DraftState.activeDraft;
  if (!draft || draft.status !== 'confirmed') return;
  if (!draft.riwayat_beli_id) {
    showToast('Tidak ada data pembelian terkait', 'error'); return;
  }
  const ok = confirm('Batalkan konfirmasi? Ini akan menghapus riwayat pembelian & payment request yang sudah dibuat.');
  if (!ok) return;

  const sb     = window._sb;
  const beliId = draft.riwayat_beli_id;
  try {
    await sb.from('invoice_drafts').update({
      status: 'needs_review', reviewed_by: null, reviewed_at: null, riwayat_beli_id: null,
    }).eq('id', draft.id);
    await sb.from('payment_requests').delete().eq('riwayat_beli_id', beliId);
    await sb.from('riwayat_beli_items').delete().eq('beli_id', beliId);
    await sb.from('riwayat_beli').delete().eq('id', beliId);

    showToast('Konfirmasi dibatalkan', 'success');
    DraftState.activeDraft.status          = 'needs_review';
    DraftState.activeDraft.riwayat_beli_id = null;
    renderInfoSection();
    renderSummarySection();
    loadDrafts();
  } catch(e) {
    showToast('Gagal undo: ' + (e.message || e), 'error');
  }
}

// ── Init ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (typeof applyTheme === 'function') applyTheme();

  const sb = window._sb;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'index.html'; return; }

  const role = await getUserRole();
  applyRoleUI(role);
  try {
    if (typeof renderSidebar === 'function') {
      renderSidebar('invoice-drafts.html', 'Pilih Brand', 'onBrandChange()');
    }
  } catch (e) {
    console.error('[invoice-drafts] renderSidebar gagal:', e);
  }

  try { await loadMasterData(); }
  catch (e) { console.error('[invoice-drafts] loadMasterData gagal:', e); }
  try { await loadBrands(); }
  catch (e) { console.error('[invoice-drafts] loadBrands gagal:', e); }

  hideLoader();

  // Cek apakah ada brand tersimpan dari sesi sebelumnya
  const savedBrand = localStorage.getItem('draftActiveBrand');
  const screen = document.getElementById('brandSelectScreen');
  if (savedBrand) {
    const inlineSel = document.getElementById('filterBrand');
    if (inlineSel) inlineSel.value = savedBrand;
    if (screen) screen.style.display = 'none';
    loadDrafts();
  } else {
    // Tampilkan brand selection screen — jangan load drafts dulu
    if (screen) screen.style.display = 'flex';
  }
});
