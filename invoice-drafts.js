/* ================================================================
   invoice-drafts.js — Review antrian invoice draft dari Discord
   ================================================================ */

// ── Zoom constants ────────────────────────────────────────────────
const DRAFT_ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 200, 300, 400];
let _draftZoomIdx = 3;
let _draftRotate  = 0;

// ── State ─────────────────────────────────────────────────────────
const DraftState = {
  allDrafts:         [],
  activeDraft:       null,
  allBarang:         [],
  allVendor:         [],
  barangMap:         {},
  vendorMap:         {},
  vendorBankAccts:   [],
  items:             [],
  selectedVendorId:  null,
  selectedBankId:    null,
  vendorNamaOcr:     '',
  vendorCandidates:  [],
  _addBarangItemIdx: null,
};

let _learnedMappings = null;
let _learnedVendors  = null;

// ── Helpers ───────────────────────────────────────────────────────
function formatRp(n) {
  return 'Rp ' + (n || 0).toLocaleString('id-ID');
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

// ── Learned mappings (mirrors scan-invoice.js logic) ─────────────
async function loadLearnedMappingsLocal() {
  if (_learnedMappings !== null) return;
  try {
    const { data } = await window._sb.from('scan_mappings')
      .select('nama_invoice,barang_id,vendor_nama,vendor_id');
    _learnedMappings = {};
    _learnedVendors  = {};
    (data || []).forEach(r => {
      if (r.nama_invoice && r.barang_id) _learnedMappings[r.nama_invoice.toLowerCase()] = r.barang_id;
      if (r.vendor_nama  && r.vendor_id) _learnedVendors[r.vendor_nama.toLowerCase()]   = r.vendor_id;
    });
  } catch {
    _learnedMappings = {};
    _learnedVendors  = {};
  }
}

async function saveLearnedMappingLocal(namaInvoice, barangId) {
  if (!namaInvoice || !barangId) return;
  try {
    await window._sb.from('scan_mappings').upsert(
      { nama_invoice: namaInvoice.toLowerCase(), barang_id: barangId },
      { onConflict: 'nama_invoice' }
    );
    if (_learnedMappings) _learnedMappings[namaInvoice.toLowerCase()] = barangId;
  } catch { /* silent */ }
}

async function saveLearnedVendorLocal(namaVendor, vendorId) {
  if (!namaVendor || !vendorId) return;
  try {
    await window._sb.from('scan_mappings').upsert(
      { vendor_nama: namaVendor.toLowerCase(), vendor_id: vendorId },
      { onConflict: 'vendor_nama' }
    );
    if (_learnedVendors) _learnedVendors[namaVendor.toLowerCase()] = vendorId;
  } catch { /* silent */ }
}

function findLearnedBarang(namaInvoice) {
  return (_learnedMappings && namaInvoice)
    ? (_learnedMappings[namaInvoice.toLowerCase()] || null)
    : null;
}

function findLearnedVendor(namaVendor) {
  return (_learnedVendors && namaVendor)
    ? (_learnedVendors[namaVendor.toLowerCase()] || null)
    : null;
}

// ── Fuzzy match ───────────────────────────────────────────────────
function _tokenize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
}

function _fuzzyScore(a, b) {
  const ta = _tokenize(a), tb = _tokenize(b);
  if (!ta.length || !tb.length) return 0;
  let match = 0;
  ta.forEach(t => { if (tb.some(u => u.includes(t) || t.includes(u))) match++; });
  return match / Math.max(ta.length, tb.length);
}

function findBarangCandidates(nama, limit = 6) {
  return DraftState.allBarang
    .map(b => ({ ...b, score: _fuzzyScore(nama, b.nama) }))
    .filter(b => b.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function findVendorCandidates(nama, limit = 5) {
  return DraftState.allVendor
    .map(v => ({ ...v, score: _fuzzyScore(nama, v.nama) }))
    .filter(v => v.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ── Master data ───────────────────────────────────────────────────
async function loadMasterData() {
  const sb = window._sb;
  const [{ data: bRows }, { data: vRows }] = await Promise.all([
    sb.from('barang').select('id,nama,sku,satuan').eq('aktif', true).order('nama'),
    sb.from('vendor').select('id,nama').eq('aktif', true).order('nama'),
  ]);
  DraftState.allBarang  = bRows || [];
  DraftState.allVendor  = vRows || [];
  DraftState.barangMap  = Object.fromEntries(DraftState.allBarang.map(b => [b.id, b]));
  DraftState.vendorMap  = Object.fromEntries(DraftState.allVendor.map(v => [v.id, v]));
}

async function loadBrands() {
  const { data } = await window._sb.from('brands').select('*').order('nama');
  const sel = document.getElementById('brandSelect');
  if (!sel) return;
  (data || []).forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id; opt.textContent = b.nama;
    sel.appendChild(opt);
  });
  const saved = localStorage.getItem('activeBrand');
  if (saved) sel.value = saved;
  _updateBrandLabel();
}

function _updateBrandLabel() {
  const sel = document.getElementById('brandSelect');
  const lbl = document.getElementById('activeBrandLabel');
  if (!sel || !lbl) return;
  const opt = sel.options[sel.selectedIndex];
  lbl.textContent = opt?.value ? opt.textContent : 'Semua Brand';
}

function onBrandChange() {
  const sel = document.getElementById('brandSelect');
  if (sel?.value) localStorage.setItem('activeBrand', sel.value);
  _updateBrandLabel();
  loadDrafts();
}

// ── Load & render draft list ──────────────────────────────────────
async function loadDrafts() {
  const sb     = window._sb;
  const status = document.getElementById('filterStatus')?.value ?? '';
  const brand  = document.getElementById('brandSelect')?.value  ?? '';

  document.getElementById('draftItems').innerHTML =
    `<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">Memuat...</div>`;

  let q = sb.from('invoice_drafts')
    .select('*, brands(nama)')
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (brand && brand !== 'all') q = q.eq('brand_id', brand);

  const { data, error } = await q;
  if (error) { showToast('Gagal memuat draft: ' + error.message, 'error'); return; }

  DraftState.allDrafts = data || [];
  renderDraftList();
}

function filterDraftList() {
  renderDraftList();
}

const _STATUS_BADGE = {
  needs_review: `<span class="badge-orange" style="font-size:10px;white-space:nowrap">Perlu Review</span>`,
  confirmed:    `<span class="badge-green"  style="font-size:10px">Confirmed</span>`,
  rejected:     `<span class="badge-red"    style="font-size:10px">Rejected</span>`,
};

function renderDraftList() {
  const q = (document.getElementById('searchDraft')?.value || '').toLowerCase().trim();
  const drafts = q
    ? DraftState.allDrafts.filter(d => {
        const v = (d.ocr_result?.vendor || '').toLowerCase();
        const f = (d.ocr_result?.nomor_faktur || '').toLowerCase();
        return v.includes(q) || f.includes(q);
      })
    : DraftState.allDrafts;

  const el = document.getElementById('draftItems');
  if (!drafts.length) {
    el.innerHTML = `<div style="padding:32px 16px;text-align:center;color:var(--muted);font-size:13px">Tidak ada draft</div>`;
    return;
  }

  el.innerHTML = drafts.map(d => {
    const ocr      = d.ocr_result || {};
    const vendor   = ocr.vendor || '—';
    const faktur   = ocr.nomor_faktur || '—';
    const total    = ocr.total ? formatRp(ocr.total) : '—';
    const date     = formatDate(d.created_at);
    const badge    = _STATUS_BADGE[d.status] || '';
    const isActive = d.id === DraftState.activeDraft?.id;
    return `<div
      class="nav-item${isActive ? ' active' : ''}"
      style="flex-direction:column;align-items:flex-start;gap:4px;padding:10px 12px;cursor:pointer;border-radius:var(--radius);margin-bottom:4px"
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

  document.getElementById('emptyReview').style.display   = 'none';
  const rc = document.getElementById('reviewContent');
  rc.style.display = 'flex';

  // Reset image
  _draftZoomIdx = 3; _draftRotate = 0;
  const img = document.getElementById('draftImgEl');
  if (img) {
    img.style.transform = '';
    img.onload = () => _applyDraftTransform();
    img.src = draft.image_url || '';
    if (!draft.image_url) img.style.display = 'none';
    else img.style.display = 'block';
  }

  const ocr = draft.ocr_result || {};

  // Init items state
  DraftState.items = (ocr.items || []).map((item, idx) => {
    const namaOcr    = item.nama || '';
    const learnedId  = findLearnedBarang(namaOcr);
    const barang     = learnedId ? DraftState.barangMap[learnedId] : null;
    const candidates = findBarangCandidates(namaOcr);
    const topMatch   = candidates[0];
    let matchType    = 'none', barangId = null, barangNama = '';
    if (barang) {
      matchType  = 'learned'; barangId = barang.id; barangNama = barang.nama;
    } else if (topMatch?.score >= 0.85) {
      matchType  = 'exact';   barangId = topMatch.id; barangNama = topMatch.nama;
    } else if (topMatch) {
      matchType  = 'fuzzy';   barangId = topMatch.id; barangNama = topMatch.nama;
    }
    return {
      idx, namaOcr,
      qty:         parseFloat(item.qty)   || 1,
      satuan:      item.satuan            || '',
      harga:       parseFloat(item.harga) || 0,
      barangId, barangNama, matchType,
      isUnmatched: false,
      searchOpen:  false,
      searchQuery: '',
      candidates,
    };
  });

  // Init vendor
  DraftState.vendorNamaOcr    = ocr.vendor || '';
  DraftState.vendorCandidates = findVendorCandidates(DraftState.vendorNamaOcr);
  const learnedVId = findLearnedVendor(DraftState.vendorNamaOcr);
  DraftState.selectedVendorId = learnedVId
    || (DraftState.vendorCandidates[0]?.score >= 0.5 ? DraftState.vendorCandidates[0].id : null);

  DraftState.vendorBankAccts = [];
  DraftState.selectedBankId  = null;
  if (DraftState.selectedVendorId) await loadVendorBankAccts(DraftState.selectedVendorId);

  renderInfoBar(draft);
  renderVendorSection();
  renderItemsSection();
  renderSummarySection();
}

// ── Info bar ──────────────────────────────────────────────────────
function renderInfoBar(draft) {
  const STATUS_LABEL = {
    needs_review: '<span style="color:var(--muted)">⏳ Perlu Review</span>',
    confirmed:    '<span style="color:var(--accent3)">✅ Confirmed</span>',
    rejected:     '<span style="color:var(--danger)">❌ Rejected</span>',
  };
  const ocr = draft.ocr_result || {};
  document.getElementById('draftInfoBar').innerHTML = `
    <span style="font-size:12px;color:var(--muted)">Sumber: <b style="color:var(--text)">${escHtml(draft.source || 'discord')}</b></span>
    <span style="font-size:12px;color:var(--muted)">Masuk: <b style="color:var(--text)">${formatDate(draft.created_at)}</b></span>
    <span style="font-size:12px;color:var(--muted)">No. Faktur: <b style="color:var(--text);font-family:'DM Mono',monospace">${escHtml(ocr.nomor_faktur || '—')}</b></span>
    <span style="font-size:12px;color:var(--muted)">Tgl Invoice: <b style="color:var(--text)">${escHtml(ocr.tanggal || '—')}</b></span>
    <span style="margin-left:auto;font-size:12px">${STATUS_LABEL[draft.status] || ''}</span>
  `;
}

// ── Vendor section ────────────────────────────────────────────────
async function loadVendorBankAccts(vendorId) {
  const { data } = await window._sb.from('vendor_bank_accounts')
    .select('*').eq('vendor_id', vendorId).order('is_primary', { ascending: false });
  DraftState.vendorBankAccts = data || [];
  DraftState.selectedBankId  = data?.[0]?.id || null;
}

function renderVendorSection() {
  const vid   = DraftState.selectedVendorId;
  const score = DraftState.vendorCandidates[0]?.score || 0;
  const badge = !vid
    ? `<span class="badge-gray" style="font-size:10px">no match</span>`
    : score >= 0.85
      ? `<span class="badge-green" style="font-size:10px">exact</span>`
      : `<span class="badge-orange" style="font-size:10px">fuzzy</span>`;

  const bankHTML = DraftState.vendorBankAccts.length
    ? `<select id="bankSelect" class="search-input" style="flex:1;min-width:180px" onchange="DraftState.selectedBankId=this.value">
        ${DraftState.vendorBankAccts.map(a =>
          `<option value="${escHtml(a.id)}" ${a.id === DraftState.selectedBankId ? 'selected' : ''}>
            ${escHtml(a.bank_name)} — ${escHtml(a.account_number)} (${escHtml(a.account_name)})
           </option>`
        ).join('')}
       </select>`
    : `<span style="font-size:12px;color:var(--muted)">Tidak ada rekening terdaftar</span>`;

  document.getElementById('vendorSection').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--muted);min-width:90px">Dari OCR:</span>
        <span style="font-size:13px;font-family:'DM Mono',monospace">${escHtml(DraftState.vendorNamaOcr || '—')}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--muted);min-width:90px">Matched ke:</span>
        <select id="vendorSelect" class="search-input" style="flex:1;min-width:180px" onchange="onVendorChange()">
          <option value="">— Pilih Vendor —</option>
          ${DraftState.allVendor.map(v =>
            `<option value="${escHtml(v.id)}" ${v.id === vid ? 'selected' : ''}>${escHtml(v.nama)}</option>`
          ).join('')}
        </select>
        ${badge}
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--muted);min-width:90px">Rekening:</span>
        ${bankHTML}
      </div>
    </div>
  `;
}

async function onVendorChange() {
  const newVid = document.getElementById('vendorSelect')?.value || null;
  DraftState.selectedVendorId = newVid;
  DraftState.vendorBankAccts  = [];
  DraftState.selectedBankId   = null;
  if (newVid) await loadVendorBankAccts(newVid);
  renderVendorSection();
}

// ── Items section ─────────────────────────────────────────────────
function renderItemsSection() {
  const el = document.getElementById('itemsSection');
  if (!DraftState.items.length) {
    el.innerHTML = `<div style="color:var(--muted);font-size:13px;text-align:center;padding:16px">Tidak ada item dari OCR</div>`;
    return;
  }
  el.innerHTML = DraftState.items
    .map((item, i) => (i > 0 ? '<hr style="border:none;border-top:1px solid var(--border);margin:10px 0"/>' : '') + renderItemRow(item))
    .join('');
}

const _MATCH_BADGE = {
  learned: `<span class="badge-blue"   style="font-size:10px">learned</span>`,
  exact:   `<span class="badge-green"  style="font-size:10px">exact</span>`,
  fuzzy:   `<span class="badge-orange" style="font-size:10px">fuzzy</span>`,
  none:    `<span class="badge-gray"   style="font-size:10px">no match</span>`,
};

function renderItemRow(item) {
  const candidateRows = item.candidates.length
    ? item.candidates.map(c =>
        `<div style="padding:7px 12px;cursor:pointer;font-size:13px;border-radius:6px;transition:background .1s"
              onmouseover="this.style.background='var(--surface)'"
              onmouseout="this.style.background=''"
              onclick="selectItemBarang(${item.idx},'${escHtml(c.id)}',${JSON.stringify(escHtml(c.nama))})">
           ${escHtml(c.nama)} <span style="font-size:10px;color:var(--muted)">${Math.round(c.score * 100)}%</span>
         </div>`
      ).join('')
    : `<div style="padding:8px 12px;font-size:13px;color:var(--muted)">Tidak ada kandidat</div>`;

  return `
    <div id="itemRow_${item.idx}" style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:11px;color:var(--muted);min-width:70px;flex-shrink:0">Dari OCR:</span>
        <span style="font-size:12px;font-family:'DM Mono',monospace;color:var(--text)">${escHtml(item.namaOcr)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:11px;color:var(--muted);min-width:70px;flex-shrink:0">Barang:</span>
        ${item.isUnmatched
          ? `<span style="font-size:12px;color:var(--muted);font-style:italic;flex:1">Simpan sebagai barang bebas</span>`
          : `<div style="flex:1;position:relative;min-width:180px">
               <div onclick="toggleItemSearch(${item.idx})"
                    class="search-input"
                    style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:6px;padding-right:8px;user-select:none">
                 <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;flex:1">${escHtml(item.barangNama || '— Pilih Barang —')}</span>
                 <span style="color:var(--muted);flex-shrink:0;font-size:11px">▾</span>
               </div>
               ${item.searchOpen ? `
                 <div style="position:absolute;top:100%;left:0;right:0;z-index:200;background:var(--surface2);border:1px solid var(--border);border-radius:8px;margin-top:2px;box-shadow:0 4px 20px rgba(0,0,0,.35);max-height:220px;overflow-y:auto">
                   <div style="padding:6px 8px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface2)">
                     <input class="search-input"
                            style="width:100%;box-sizing:border-box;font-size:12px"
                            placeholder="Cari barang..."
                            id="itemSearch_${item.idx}"
                            oninput="updateItemSearch(${item.idx},this.value)"
                            value="${escHtml(item.searchQuery)}"
                            onclick="event.stopPropagation()"/>
                   </div>
                   <div id="itemSearchResults_${item.idx}">${candidateRows}</div>
                 </div>` : ''}
             </div>`
        }
        ${_MATCH_BADGE[item.matchType] || ''}
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <label style="font-size:11px;color:var(--muted);cursor:pointer;display:flex;align-items:center;gap:4px">
          <input type="checkbox" ${item.isUnmatched ? 'checked' : ''} onchange="toggleUnmatched(${item.idx},this.checked)"/>
          Barang bebas
        </label>
        ${!item.isUnmatched
          ? `<button class="btn-ghost" style="font-size:11px;padding:2px 8px" onclick="openAddBarangModal(${item.idx})">＋ Tambah ke Master</button>`
          : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div style="display:flex;flex-direction:column;gap:3px">
          <label style="font-size:11px;color:var(--muted)">Qty</label>
          <input type="number" class="search-input" style="width:76px" value="${item.qty}" min="0" step="any"
                 onchange="updateItemField(${item.idx},'qty',parseFloat(this.value)||0)"/>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px">
          <label style="font-size:11px;color:var(--muted)">Satuan</label>
          <input type="text" class="search-input" style="width:76px" value="${escHtml(item.satuan)}"
                 onchange="updateItemField(${item.idx},'satuan',this.value)"/>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px">
          <label style="font-size:11px;color:var(--muted)">Harga/satuan</label>
          <input type="number" class="search-input" style="width:120px" value="${item.harga}" min="0"
                 onchange="updateItemField(${item.idx},'harga',parseFloat(this.value)||0)"/>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px">
          <label style="font-size:11px;color:var(--muted)">Subtotal</label>
          <span id="subtotal_${item.idx}" style="font-size:13px;color:var(--accent3);height:36px;display:flex;align-items:center;font-family:'DM Mono',monospace">${formatRp(item.qty * item.harga)}</span>
        </div>
      </div>
    </div>
  `;
}

function toggleItemSearch(idx) {
  // Close other open searches
  DraftState.items.forEach((it, i) => { if (i !== idx) it.searchOpen = false; });
  DraftState.items[idx].searchOpen = !DraftState.items[idx].searchOpen;
  renderItemsSection();
  if (DraftState.items[idx].searchOpen) {
    setTimeout(() => document.getElementById(`itemSearch_${idx}`)?.focus(), 40);
  }
}

function updateItemSearch(idx, query) {
  DraftState.items[idx].searchQuery = query;
  const results = query.trim()
    ? DraftState.allBarang.filter(b => b.nama.toLowerCase().includes(query.toLowerCase())).slice(0, 10)
    : DraftState.items[idx].candidates;
  const el = document.getElementById(`itemSearchResults_${idx}`);
  if (!el) return;
  el.innerHTML = results.length
    ? results.map(c =>
        `<div style="padding:7px 12px;cursor:pointer;font-size:13px;border-radius:6px;transition:background .1s"
              onmouseover="this.style.background='var(--surface)'"
              onmouseout="this.style.background=''"
              onclick="selectItemBarang(${idx},'${escHtml(c.id)}',${JSON.stringify(escHtml(c.nama))})">
           ${escHtml(c.nama)}
         </div>`
      ).join('')
    : `<div style="padding:8px 12px;font-size:13px;color:var(--muted)">Tidak ada hasil</div>`;
}

function selectItemBarang(idx, barangId, barangNama) {
  const item = DraftState.items[idx];
  item.barangId    = barangId;
  item.barangNama  = barangNama;
  item.matchType   = 'exact';
  item.isUnmatched = false;
  item.searchOpen  = false;
  item.searchQuery = '';
  renderItemsSection();
  renderSummarySection();
}

function toggleUnmatched(idx, checked) {
  DraftState.items[idx].isUnmatched = checked;
  if (checked) { DraftState.items[idx].barangId = null; DraftState.items[idx].matchType = 'none'; }
  renderItemsSection();
  renderSummarySection();
}

function updateItemField(idx, field, val) {
  DraftState.items[idx][field] = val;
  const sub = document.getElementById(`subtotal_${idx}`);
  if (sub) {
    const it = DraftState.items[idx];
    sub.textContent = formatRp(it.qty * it.harga);
  }
  renderSummarySection();
}

// ── Summary + action bar ──────────────────────────────────────────
function renderSummarySection() {
  const total      = DraftState.items.reduce((s, i) => s + i.qty * i.harga, 0);
  const unresolved = DraftState.items.filter(i => !i.barangId && !i.isUnmatched).length;
  const draft      = DraftState.activeDraft;
  const isDone     = draft?.status === 'confirmed' || draft?.status === 'rejected';

  document.getElementById('summarySection').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:2px">Total</div>
        <div style="font-size:20px;font-weight:700;color:var(--accent);font-family:'DM Mono',monospace">${formatRp(total)}</div>
        ${unresolved > 0 ? `<div style="font-size:12px;color:var(--danger);margin-top:4px">&#9888; ${unresolved} item belum dipilih barangnya</div>` : ''}
      </div>
      ${!isDone ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-ghost" style="color:var(--danger);border-color:rgba(255,77,106,.4)" onclick="openRejectModal()">&#10005; Tolak</button>
          <button class="btn-primary" onclick="confirmDraft()">&#10003; Konfirmasi</button>
        </div>
      ` : `<span style="font-size:13px;color:var(--muted)">Draft sudah ${draft.status}.</span>`}
    </div>
  `;
}

// ── Quick add barang ──────────────────────────────────────────────
function openAddBarangModal(idx) {
  DraftState._addBarangItemIdx = idx;
  document.getElementById('newBarangNama').value     = DraftState.items[idx]?.namaOcr || '';
  document.getElementById('newBarangSku').value      = '';
  document.getElementById('newBarangSatuan').value   = DraftState.items[idx]?.satuan || '';
  document.getElementById('newBarangKategori').value = '';
  document.getElementById('addBarangModal').style.display = 'flex';
  setTimeout(() => document.getElementById('newBarangNama')?.focus(), 40);
}

function closeAddBarangModal() {
  document.getElementById('addBarangModal').style.display = 'none';
}

async function doAddBarang() {
  const nama     = document.getElementById('newBarangNama').value.trim();
  const sku      = document.getElementById('newBarangSku').value.trim();
  const satuan   = document.getElementById('newBarangSatuan').value.trim();
  const kategori = document.getElementById('newBarangKategori').value.trim();
  if (!nama) { showToast('Nama barang wajib diisi', 'error'); return; }

  const { data, error } = await window._sb.from('barang').insert({
    nama, sku: sku || null, satuan: satuan || null,
    kategori: kategori || null, aktif: true,
  }).select().single();
  if (error) { showToast('Gagal tambah barang: ' + error.message, 'error'); return; }

  DraftState.allBarang.push(data);
  DraftState.barangMap[data.id] = data;

  const idx = DraftState._addBarangItemIdx;
  if (idx !== null) selectItemBarang(idx, data.id, data.nama);

  closeAddBarangModal();
  showToast(`Barang "${nama}" ditambahkan`, 'success');
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
  renderInfoBar(DraftState.activeDraft);
  renderSummarySection();
  loadDrafts();
}

// ── Confirm draft ─────────────────────────────────────────────────
async function confirmDraft() {
  const draft = DraftState.activeDraft;
  if (!draft) return;

  if (!DraftState.selectedVendorId) {
    showToast('Pilih vendor terlebih dahulu', 'error'); return;
  }
  const unresolved = DraftState.items.filter(i => !i.barangId && !i.isUnmatched);
  if (unresolved.length) {
    showToast(`${unresolved.length} item belum dipilih barangnya`, 'error'); return;
  }

  const sb      = window._sb;
  const ocr     = draft.ocr_result || {};
  const ppnRate = (window._ppnRate || 11) / 100;
  const total   = DraftState.items.reduce((s, i) => s + i.qty * i.harga, 0);
  const tanggal = ocr.tanggal || new Date().toISOString().slice(0, 10);
  const { data: { user } } = await sb.auth.getUser();

  try {
    // 1. INSERT riwayat_beli
    const { data: beli, error: beliErr } = await sb.from('riwayat_beli').insert({
      tanggal,
      nomor_faktur: ocr.nomor_faktur || null,
      vendor_id:    DraftState.selectedVendorId,
      brand_id:     draft.brand_id,
      catatan:      null,
      status:       'confirmed',
      ppn_included: false,
      diskon:       0,
      diskon_mode:  'nominal',
      diskon_pct:   0,
      ongkir:       0,
      subtotal:     total,
      total,
      updated_at:   new Date().toISOString(),
    }).select().single();
    if (beliErr) throw beliErr;

    // 2. INSERT riwayat_beli_items
    const itemPayloads = DraftState.items.map(item => ({
      beli_id:       beli.id,
      barang_id:     item.isUnmatched ? null : (item.barangId || null),
      nama:          item.barangNama || item.namaOcr,
      sku:           (!item.isUnmatched && item.barangId) ? (DraftState.barangMap[item.barangId]?.sku || '') : '',
      satuan:        item.satuan || '',
      brand_id:      draft.brand_id,
      qty:           item.qty,
      harga_satuan:  item.harga,
      harga_exc_ppn: item.harga,
      harga_inc_ppn: Math.round(item.harga * (1 + ppnRate)),
      ppn_included:  false,
      subtotal:      item.qty * item.harga,
      is_unmatched:  item.isUnmatched || false,
      unmatched_nama: item.isUnmatched ? item.namaOcr : null,
    }));
    const { error: itemErr } = await sb.from('riwayat_beli_items').insert(itemPayloads);
    if (itemErr) throw itemErr;

    // 3. INSERT payment_requests
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

    // 4. UPDATE invoice_drafts
    const { error: draftErr } = await sb.from('invoice_drafts').update({
      status:          'confirmed',
      reviewed_by:     user?.id || null,
      reviewed_at:     new Date().toISOString(),
      riwayat_beli_id: beli.id,
    }).eq('id', draft.id);
    if (draftErr) throw draftErr;

    // 5. Save learned mappings
    for (const item of DraftState.items) {
      if (!item.isUnmatched && item.barangId && item.namaOcr) {
        await saveLearnedMappingLocal(item.namaOcr, item.barangId);
      }
    }
    if (DraftState.vendorNamaOcr && DraftState.selectedVendorId) {
      await saveLearnedVendorLocal(DraftState.vendorNamaOcr, DraftState.selectedVendorId);
    }

    showToast('Draft dikonfirmasi — pembelian & payment request disimpan ✓', 'success');
    DraftState.activeDraft.status          = 'confirmed';
    DraftState.activeDraft.riwayat_beli_id = beli.id;
    renderInfoBar(DraftState.activeDraft);
    renderSummarySection();
    loadDrafts();

  } catch(e) {
    showToast('Gagal konfirmasi: ' + (e.message || e), 'error');
  }
}

// ── Close dropdowns on outside click ─────────────────────────────
document.addEventListener('click', e => {
  const hasOpen = DraftState.items.some(i => i.searchOpen);
  if (!hasOpen) return;
  if (!e.target.closest('#itemsSection')) {
    DraftState.items.forEach(i => { i.searchOpen = false; });
    renderItemsSection();
  }
});

// ── Init ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (typeof applyTheme === 'function') applyTheme();

  const sb = window._sb;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'index.html'; return; }

  const role = await getUserRole();
  if (role !== 'admin' && role !== 'finance') {
    document.querySelector('.content').innerHTML = `
      <div style="padding:60px;text-align:center;color:var(--muted)">
        <div style="font-size:48px;margin-bottom:16px">⛔</div>
        <div>Akses ditolak. Halaman ini hanya untuk Admin dan Finance.</div>
      </div>`;
    hideLoader();
    return;
  }

  applyRoleUI(role);
  renderSidebar('invoice-drafts.html', 'Pilih Brand', 'onBrandChange()');

  await Promise.all([loadMasterData(), loadLearnedMappingsLocal()]);
  await loadBrands();

  hideLoader();
  loadDrafts();
});
