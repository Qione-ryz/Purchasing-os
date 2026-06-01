/* ================================================================
   invoice-drafts.js — Finance flow: OCR raw → edit → payment_requests
   Alur: Discord n8n → OCR → invoice_drafts → review nama/qty/satuan/harga → confirmed
   ================================================================ */

// ── Zoom ──────────────────────────────────────────────────────────
const DRAFT_ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 200, 300, 400];
let _draftZoomIdx = 3;
let _draftRotate  = 0;

// ── State ─────────────────────────────────────────────────────────
const DraftState = {
  allDrafts:        [],
  activeDraft:      null,
  allVendor:        [],
  vendorMap:        {},
  vendorBankAccts:  [],
  items:            [],  // [{idx, namaOcr, namaEdit, qty, satuan, harga}]
  selectedVendorId: null,
  selectedBankId:   null,
  vendorNamaOcr:    '',
  vendorNamaEdit:   '',
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
  const img   = document.getElementById('draftImgEl');
  const inner = document.getElementById('draftImgInner');
  if (!img || !inner) return;

  const pct      = DRAFT_ZOOM_LEVELS[_draftZoomIdx] / 100;
  const sideways = _draftRotate === 90 || _draftRotate === 270;
  const lbl      = document.getElementById('draftZoomLabel');
  if (lbl) lbl.textContent = DRAFT_ZOOM_LEVELS[_draftZoomIdx] + '%';

  if (sideways) {
    const cw    = (document.getElementById('draftImgContainer')?.clientWidth || 400) - 24;
    const natW  = img.naturalWidth  || img.offsetWidth  || 400;
    const natH  = img.naturalHeight || img.offsetHeight || 600;
    const scale = (cw / natH) * pct;
    inner.style.width    = (natH * scale) + 'px';
    inner.style.height   = (natW * scale) + 'px';
    inner.style.position = 'relative';
    img.style.position   = 'absolute';
    img.style.top        = ((natH * scale - natH * scale / pct * pct) / 2 + (natH * scale - natW * scale) / 2) + 'px';
    img.style.left       = '0';
    img.style.width      = natW + 'px';
    img.style.height     = natH + 'px';
    img.style.maxWidth   = 'none';
    img.style.transform  = `rotate(${_draftRotate}deg) scale(${scale})`;
    img.style.transformOrigin = 'center center';
  } else {
    inner.style.width    = '';
    inner.style.height   = '';
    inner.style.position = '';
    img.style.position   = '';
    img.style.top        = '';
    img.style.left       = '';
    img.style.width      = '';
    img.style.height     = '';
    img.style.maxWidth   = '100%';
    img.style.transform  = `rotate(${_draftRotate}deg) scale(${pct})`;
    img.style.transformOrigin = 'top center';
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
  _draftZoomIdx = 3;
  _draftRotate  = 0;
  _applyDraftTransform();
}

// ── Master data (vendor only) ─────────────────────────────────────
async function loadMasterData() {
  const { data: vRows } = await window._sb.from('vendor').select('id,nama').eq('aktif', true).order('nama');
  DraftState.allVendor = vRows || [];
  DraftState.vendorMap = Object.fromEntries(DraftState.allVendor.map(v => [v.id, v]));
}

async function loadBrands() {
  const { data } = await window._sb.from('brands').select('*').order('nama');
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
}

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
    ['filterBrand','brandSelect'].forEach(id => {
      const bs = document.getElementById(id);
      if (bs) { const first = bs.querySelector('option'); bs.innerHTML = ''; if (first) bs.appendChild(first); }
    });
    await loadMasterData();
    await loadBrands();
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
  renderDraftList();
}

function filterDraftList() { renderDraftList(); }

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
  el.innerHTML = drafts.map(d => {
    const ocr    = d.ocr_result || {};
    const vendor = ocr.vendor || ocr.nama_vendor || '—';
    const faktur = ocr.nomor_faktur || ocr.nomor_invoice || '—';
    const totalNum = ocr.total || (Array.isArray(ocr.items)
      ? ocr.items.reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat(it.harga_satuan ?? it.harga) || 0), 0)
      : 0);
    const total    = totalNum ? formatRp(totalNum) : '—';
    const date     = formatDate(d.created_at);
    const badge    = _STATUS_BADGE[d.status] || '';
    const isActive = d.id === DraftState.activeDraft?.id;
    return `<div class="nav-item${isActive ? ' active' : ''}"
      style="flex-direction:column;align-items:flex-start;gap:4px;padding:10px 12px;cursor:pointer;border-radius:var(--radius-sm);margin-bottom:4px"
      onclick="selectDraft('${d.id}')">
      <div style="display:flex;justify-content:space-between;width:100%;gap:6px">
        <span style="font-size:13px;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(vendor)}</span>
        ${badge}
      </div>
      <div style="display:flex;justify-content:space-between;width:100%;gap:6px">
        <span style="font-size:11px;color:var(--muted);font-family:'DM Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${escHtml(faktur)}</span>
        <span style="font-size:11px;color:var(--muted);white-space:nowrap">${date}</span>
      </div>
      <span style="font-size:11px;color:var(--accent3);font-family:'DM Mono',monospace">${total}</span>
    </div>`;
  }).join('');
}

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

  _draftZoomIdx = 3; _draftRotate = 0;
  const img = document.getElementById('draftImgEl');
  if (img) {
    img.style.transform = '';
    img.onload = () => _applyDraftTransform();
    img.src = draft.image_url || '';
    img.style.display = draft.image_url ? 'block' : 'none';
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
  DraftState.vendorNamaOcr    = ocr.vendor || ocr.nama_vendor || '';
  DraftState.vendorNamaEdit   = DraftState.vendorNamaOcr;
  DraftState.selectedVendorId = null;
  DraftState.vendorBankAccts  = [];
  DraftState.selectedBankId   = null;

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
  const vid = DraftState.selectedVendorId;

  const chip = document.getElementById('draftStatusChip');
  if (chip) chip.innerHTML = _STATUS_CHIP[draft.status] || '';

  const nomorFaktur = ocr.nomor_faktur || ocr.nomor_invoice || '';
  const ppnIncluded = ocr.ppn_included !== false;

  const bankHTML = DraftState.vendorBankAccts.length
    ? `<select id="bankSelect" onchange="DraftState.selectedBankId=this.value">
        ${DraftState.vendorBankAccts.map(a =>
          `<option value="${escHtml(a.id)}" ${a.id === DraftState.selectedBankId ? 'selected' : ''}>
            ${escHtml(a.bank_name)} — ${escHtml(a.account_number)} (${escHtml(a.account_name)})
           </option>`
        ).join('')}
       </select>`
    : `<div style="font-size:11px;color:var(--muted);font-family:var(--mono);padding:8px 0">${vid ? 'Tidak ada rekening terdaftar' : 'Pilih vendor terlebih dahulu'}</div>`;

  // Cek duplikat nomor faktur (async)
  if (nomorFaktur) {
    Promise.all([
      window._sb.from('invoice_drafts').select('id').eq('ocr_result->>nomor_faktur', nomorFaktur).neq('id', draft.id),
      window._sb.from('riwayat_beli').select('id').eq('nomor_faktur', nomorFaktur),
    ]).then(([{data: dDup}, {data: rDup}]) => {
      const el    = document.getElementById('duplikatWarning');
      if (!el) return;
      const total = (dDup?.length || 0) + (rDup?.length || 0);
      if (total > 0) {
        el.innerHTML = `<div style="padding:7px 12px;background:rgba(255,77,106,0.1);border:1px solid rgba(255,77,106,0.3);border-radius:7px;font-size:11px;font-family:var(--mono);color:var(--danger)">⚠ Nomor faktur <b>${escHtml(nomorFaktur)}</b> sudah ada — periksa duplikat</div>`;
        el.style.display = 'block';
      } else {
        el.style.display = 'none';
      }
    }).catch(() => {});
  }

  document.getElementById('infoSection').innerHTML = `
    <!-- Meta banner -->
    <div style="margin-bottom:14px;padding:10px 14px;background:var(--surface2);
                border:1px solid var(--border);border-radius:var(--radius-sm);
                display:flex;gap:18px;flex-wrap:wrap;align-items:center">
      <div>
        <div style="font-size:9px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:2px">No. Faktur</div>
        <div style="font-size:13px;font-family:var(--mono);color:var(--accent);font-weight:600">${escHtml(nomorFaktur || '—')}</div>
      </div>
      <div style="width:1px;height:24px;background:var(--border);flex-shrink:0"></div>
      <div>
        <div style="font-size:9px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:2px">Tanggal</div>
        <div style="font-size:13px;font-family:var(--mono);color:var(--text);font-weight:500">${escHtml(ocr.tanggal || ocr.tanggal_invoice || '—')}</div>
      </div>
      <div style="width:1px;height:24px;background:var(--border);flex-shrink:0"></div>
      <div>
        <div style="font-size:9px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:2px">Masuk</div>
        <div style="font-size:13px;font-family:var(--mono);color:var(--muted)">${formatDate(draft.created_at)}</div>
      </div>
      <div style="width:1px;height:24px;background:var(--border);flex-shrink:0;margin-left:auto"></div>
      <div style="text-align:right">
        <div style="font-size:9px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:2px">Sumber</div>
        <div style="font-size:12px;font-family:var(--mono);color:var(--accent3);font-weight:500">${escHtml(draft.source || 'discord')}</div>
      </div>
    </div>

    <!-- Duplikat warning -->
    <div id="duplikatWarning" style="display:none;margin-bottom:10px"></div>

    <!-- Nominal OCR (subtotal / ppn / grand total dari invoice) -->
    ${(ocr.subtotal || ocr.ppn_amount || ocr.ppn || ocr.grand_total) ? `
    <div style="margin-bottom:14px;padding:10px 14px;background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.12);border-radius:var(--radius-sm)">
      <div style="font-size:9px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">Nominal dari Invoice (OCR)</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        ${ocr.subtotal ? `<div>
          <div style="font-size:9px;font-family:var(--mono);color:var(--muted);margin-bottom:2px">Subtotal</div>
          <div style="font-size:12px;font-family:var(--mono);color:var(--text);font-weight:500">${formatRp(Number(ocr.subtotal))}</div>
        </div>` : ''}
        ${(ocr.ppn_amount || ocr.ppn) ? `<div>
          <div style="font-size:9px;font-family:var(--mono);color:var(--muted);margin-bottom:2px">PPN</div>
          <div style="font-size:12px;font-family:var(--mono);color:var(--text);font-weight:500">${formatRp(Number(ocr.ppn_amount || ocr.ppn))}</div>
        </div>` : ''}
        ${ocr.grand_total ? `<div>
          <div style="font-size:9px;font-family:var(--mono);color:var(--muted);margin-bottom:2px">Grand Total</div>
          <div style="font-size:12px;font-family:var(--mono);color:var(--accent2);font-weight:600">${formatRp(Number(ocr.grand_total))}</div>
        </div>` : ''}
      </div>
    </div>` : ''}

    <!-- Vendor + Rekening -->
    <div class="field-row" style="margin-bottom:14px">
      <div class="field" style="margin-bottom:0">
        <label style="margin-bottom:4px">Vendor</label>
        ${DraftState.vendorNamaOcr ? `<div style="font-size:10px;color:var(--accent3);font-family:var(--mono);margin-bottom:6px">OCR: ${escHtml(DraftState.vendorNamaOcr)}</div>` : ''}
        <input type="text" id="vendorInput" list="vendorDatalist"
               placeholder="Ketik nama vendor..."
               value="${escHtml(DraftState.vendorNamaEdit)}"
               oninput="onVendorInputChange(this.value)"
               onblur="onVendorInputBlur()"/>
        <datalist id="vendorDatalist">
          ${DraftState.allVendor.map(v => `<option value="${escHtml(v.nama)}"></option>`).join('')}
        </datalist>
      </div>
      <div class="field" style="margin-bottom:0">
        <label style="margin-bottom:4px">Rekening Tujuan</label>
        <div id="bankSelectContainer">${bankHTML}</div>
      </div>
    </div>

    <!-- PPN toggle -->
    <div>
      <label style="display:block;font-family:var(--mono);font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px">
        Status Harga <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--accent3)">(koreksi jika salah)</span>
      </label>
      <div class="diskon-toggle" style="max-width:280px">
        <button class="diskon-toggle-btn ${!ppnIncluded ? 'active' : ''}" onclick="setDraftPPN(false)">Exc PPN</button>
        <button class="diskon-toggle-btn ${ppnIncluded  ? 'active' : ''}" onclick="setDraftPPN(true)">Inc PPN ${(window._ppnRate || 11)}%</button>
      </div>
    </div>
  `;
}

function setDraftPPN(included) {
  if (!DraftState.activeDraft) return;
  if (!DraftState.activeDraft.ocr_result) DraftState.activeDraft.ocr_result = {};
  DraftState.activeDraft.ocr_result.ppn_included = included;
  renderInfoSection();
  renderSummarySection();
}

function updateBankSection() {
  const container = document.getElementById('bankSelectContainer');
  if (!container) return;
  const vid = DraftState.selectedVendorId;
  const bankHTML = DraftState.vendorBankAccts.length
    ? `<select id="bankSelect" onchange="DraftState.selectedBankId=this.value">
        ${DraftState.vendorBankAccts.map(a =>
          `<option value="${escHtml(a.id)}" ${a.id === DraftState.selectedBankId ? 'selected' : ''}>
            ${escHtml(a.bank_name)} — ${escHtml(a.account_number)} (${escHtml(a.account_name)})
           </option>`
        ).join('')}
       </select>`
    : `<div style="font-size:11px;color:var(--muted);font-family:var(--mono);padding:8px 0">${vid ? 'Tidak ada rekening terdaftar' : 'Pilih vendor terlebih dahulu'}</div>`;
  container.innerHTML = bankHTML;
}

async function onVendorInputChange(val) {
  DraftState.vendorNamaEdit = val;
  const matched = DraftState.allVendor.find(v => v.nama.toLowerCase() === val.toLowerCase().trim());
  if (matched) {
    if (DraftState.selectedVendorId !== matched.id) {
      DraftState.selectedVendorId = matched.id;
      DraftState.vendorBankAccts  = [];
      DraftState.selectedBankId   = null;
      await loadVendorBankAccts(matched.id);
      updateBankSection();
    }
  } else {
    if (DraftState.selectedVendorId !== null) {
      DraftState.selectedVendorId = null;
      DraftState.vendorBankAccts  = [];
      DraftState.selectedBankId   = null;
      updateBankSection();
    }
  }
}

function onVendorInputBlur() {
  const val = document.getElementById('vendorInput')?.value || '';
  DraftState.vendorNamaEdit = val;
}

window.onVendorInputChange = onVendorInputChange;
window.onVendorInputBlur   = onVendorInputBlur;

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
        <input class="item-input" type="text" style="flex:1;min-width:0" value="${escHtml(item.namaEdit)}" placeholder="Nama barang"
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
  const ocr = draft.ocr_result || {};

  const subtotal    = DraftState.items.reduce((s, i) => s + i.qty * i.harga, 0);
  const ppnRate     = (window._ppnRate || 11) / 100;
  const ppnIncluded = ocr.ppn_included !== false;
  const subEx       = ppnIncluded ? subtotal / (1 + ppnRate) : subtotal;
  const ppnAmt      = subEx * ppnRate;
  const diskon      = Number(ocr.diskon) || 0;
  const ongkir      = Number(ocr.ongkir) || 0;
  const total       = subEx + ppnAmt - diskon + ongkir;
  const isDone      = draft.status === 'confirmed' || draft.status === 'rejected';

  document.getElementById('summarySection').innerHTML = `
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap">
      <div style="display:flex;gap:18px;flex-wrap:wrap;flex:1;min-width:0">
        <div>
          <div style="font-size:10px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px">Subtotal (exc PPN)</div>
          <div style="font-size:13px;font-family:var(--mono);margin-top:2px">${formatRp(Math.round(subEx))}</div>
        </div>
        <div>
          <div style="font-size:10px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px">+ PPN ${Math.round(ppnRate*100)}%</div>
          <div style="font-size:13px;font-family:var(--mono);color:var(--accent2);margin-top:2px">${formatRp(Math.round(ppnAmt))}</div>
        </div>
        <div style="padding-left:18px;border-left:1px solid var(--border)">
          <div style="font-size:10px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px">Total</div>
          <div class="summary-total" style="font-size:22px;margin-top:2px">${formatRp(Math.round(total))}</div>
        </div>
      </div>
      ${!isDone
        ? `<div style="display:flex;gap:8px;flex-wrap:wrap">
             <button class="btn btn-ghost is-destructive" onclick="openRejectModal()">✕ Tolak</button>
             <button class="btn btn-primary" onclick="confirmDraft()">✓ Konfirmasi → Pembayaran</button>
           </div>`
        : `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
             <span style="font-size:12px;color:var(--muted);padding:8px 12px">Draft sudah ${draft.status}.</span>
             ${draft.status === 'confirmed'
               ? `<button class="btn btn-ghost is-destructive" style="font-size:12px" onclick="undoConfirmDraft()">↩ Batal Konfirmasi</button>`
               : ''}
           </div>`}
    </div>`;
}

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

  if (!DraftState.selectedVendorId) {
    showToast('Pilih vendor terlebih dahulu', 'error'); return;
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
  const tanggal     = ocr.tanggal || ocr.tanggal_invoice || new Date().toISOString().slice(0, 10);
  const { data: { user } } = await sb.auth.getUser();

  try {
    // 1. riwayat_beli
    const { data: beli, error: beliErr } = await sb.from('riwayat_beli').insert({
      tanggal,
      nomor_faktur: ocr.nomor_faktur || ocr.nomor_invoice || null,
      vendor_id:    DraftState.selectedVendorId,
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
      vendor_id:       DraftState.selectedVendorId,
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
  loadDrafts();
});
