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

// _learnedMappings & _learnedVendors di-deklarasi di scan-invoice.js (sudah loaded sebelumnya).
// JANGAN re-declare di sini — bikin SyntaxError "already declared" → seluruh script gagal load.

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
// Stopword: kata satuan/qty yg sering ada di OCR tapi gak signifikan utk match nama barang
const _STOPWORDS = new Set([
  'pcs','pc','pack','pak','box','dus','rol','set','lusin','dozen',
  'kg','gr','gram','ml','ltr','liter','cm','mm','inch','meter','mtr',
  'isi','net','netto','bruto','utk','dan','dgn','dari','untuk','dengan'
]);

function _tokenize(s) {
  return (s || '').toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter(t =>
      t.length >= 3 &&            // skip token pendek (s, 1, 6, pc)
      !/^\d+$/.test(t) &&         // skip pure number (1, 6, 100, 1000)
      !_STOPWORDS.has(t)          // skip satuan/qty word
    );
}

// Ekstrak angka terpanjang dari token (e.g. "4x105" → "105", "105oz" → "105")
function _mainNum(t) {
  const nums = (t.match(/\d+/g) || []);
  return nums.reduce((a, b) => b.length > a.length ? b : a, '');
}

function _fuzzyScore(a, b) {
  const ta = _tokenize(a), tb = _tokenize(b);
  if (!ta.length || !tb.length) return 0;
  let match = 0;
  ta.forEach(t => {
    const nt = _mainNum(t);
    if (tb.some(u => {
      if (u === t) return true;
      // Numeric-core match: "4x105" vs "105oz" — keduanya punya "105"
      if (nt.length >= 2) { const nu = _mainNum(u); if (nu === nt) return true; }
      // Substring match antar token ≥4 huruf
      return t.length >= 4 && u.length >= 4 && (u.includes(t) || t.includes(u));
    })) match++;
  });
  return match / Math.min(ta.length, tb.length);
}

// Hitung jumlah token yang match (tanpa dibagi — untuk OCR coverage check)
function _countMatches(ta, tb) {
  let count = 0;
  ta.forEach(t => {
    const nt = _mainNum(t);
    if (tb.some(u => {
      if (u === t) return true;
      if (nt.length >= 2) { const nu = _mainNum(u); if (nu === nt) return true; }
      return t.length >= 4 && u.length >= 4 && (u.includes(t) || t.includes(u));
    })) count++;
  });
  return count;
}

function findBarangCandidates(nama, limit = 8) {
  const ta = _tokenize(nama);
  return DraftState.allBarang
    .map(b => {
      const tb = _tokenize(b.nama);
      const matchCount = _countMatches(ta, tb);
      let score = matchCount ? matchCount / Math.min(ta.length, tb.length) : 0;
      const hasAnchor = ta.some(t => t.length >= 5 && tb.includes(t));
      if (hasAnchor) score = Math.max(score, 0.45);
      return { ...b, score, _matchCount: matchCount };
    })
    .filter(b => b.score >= 0.3)
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
  // Match pola pembelian.html — TANPA filter `aktif` supaya barang dgn aktif=null tetap kebawa
  const [{ data: bRows }, { data: vRows }] = await Promise.all([
    sb.from('barang').select('id,nama,sku,satuan').order('nama'),
    sb.from('vendor').select('id,nama').order('nama'),
  ]);
  DraftState.allBarang  = bRows || [];
  DraftState.allVendor  = vRows || [];
  DraftState.barangMap  = Object.fromEntries(DraftState.allBarang.map(b => [b.id, b]));
  DraftState.vendorMap  = Object.fromEntries(DraftState.allVendor.map(v => [v.id, v]));
  console.log(`[invoice-drafts] Loaded ${DraftState.allBarang.length} barang, ${DraftState.allVendor.length} vendor`);
}

async function loadBrands() {
  const { data } = await window._sb.from('brands').select('*').order('nama');
  // Populate kedua select: filterBrand (inline, visible) + brandSelect (sidebar, hidden)
  const inlineSel = document.getElementById('filterBrand');
  const sidebarSel = document.getElementById('brandSelect');
  (data || []).forEach(b => {
    if (inlineSel) {
      const o = document.createElement('option');
      o.value = b.id; o.textContent = b.nama;
      inlineSel.appendChild(o);
    }
    if (sidebarSel) {
      const o = document.createElement('option');
      o.value = b.id; o.textContent = b.nama;
      sidebarSel.appendChild(o);
    }
  });
  // Default 'all' — abaikan localStorage.activeBrand di page ini
  if (inlineSel) inlineSel.value = 'all';
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
  // Sync ke sidebar hidden select biar kode lama gak break
  const sidebarSel = document.getElementById('brandSelect');
  if (sidebarSel && sel) sidebarSel.value = sel.value;
  _updateBrandLabel();
  loadDrafts();
}

// Backward-compat: sidebar.js mungkin masih panggil onBrandChange()
function onBrandChange() { onFilterBrandChange(); }

// ── Status tab filter ─────────────────────────────────────────────
function setStatusTab(status) {
  document.querySelectorAll('#statusTabBar .status-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === status);
  });
  const sel = document.getElementById('filterStatus');
  if (sel) sel.value = status;
  loadDrafts();
}
window.setStatusTab = setStatusTab;

// ── Load & render draft list ──────────────────────────────────────
// Refresh master data + drafts (pola sama dgn pembelian.html refreshMasterData)
window.refreshDraftsData = async function() {
  const btn = document.getElementById('btnRefreshData');
  const origHTML = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '⟳ Memuat...'; }
  try {
    if (typeof window._invalidateAllCache === 'function') window._invalidateAllCache();
    // Reset brand selects (preserve first option "Semua Brand")
    ['filterBrand','brandSelect'].forEach(id => {
      const bs = document.getElementById(id);
      if (bs) { const first = bs.querySelector('option'); bs.innerHTML = ''; if (first) bs.appendChild(first); }
    });
    await loadMasterData();
    await loadBrands();
    await loadDrafts();
    if (typeof showToast === 'function') showToast('✓ Data draft & master diperbarui', 'success');
  } catch (e) {
    if (typeof showToast === 'function') showToast('Gagal refresh: ' + e.message, 'error');
  }
  if (btn) { btn.disabled = false; btn.innerHTML = origHTML || 'Refresh Data'; }
};

async function loadDrafts() {
  const sb     = window._sb;
  const status = document.getElementById('filterStatus')?.value ?? '';
  // Filter brand dari inline select (default 'all')
  const brand  = document.getElementById('filterBrand')?.value ?? 'all';

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

  const el = document.getElementById('draftItems');
  // Count chip update — total drafts (post-filter)
  const chip = document.getElementById('draftCountChip');
  if (chip) {
    const n = drafts.length;
    if (n > 0) { chip.textContent = `${n} draft`; chip.style.display = 'inline-block'; }
    else { chip.style.display = 'none'; }
  }
  if (!drafts.length) {
    el.innerHTML = `<div style="padding:32px 16px;text-align:center;color:var(--muted);font-size:13px"><div style="font-size:28px;margin-bottom:8px;opacity:.6">📭</div>Tidak ada draft</div>`;
    return;
  }

  el.innerHTML = drafts.map(d => {
    const ocr      = d.ocr_result || {};
    const vendor   = ocr.vendor || ocr.nama_vendor || '—';
    const faktur   = ocr.nomor_faktur || ocr.nomor_invoice || '—';
    // Hitung total dari items jika field `total` gak ada
    const totalNum = ocr.total
      || (Array.isArray(ocr.items)
          ? ocr.items.reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat(it.harga_satuan ?? it.harga) || 0), 0)
          : 0);
    const total    = totalNum ? formatRp(totalNum) : '—';
    const date     = formatDate(d.created_at);
    const badge    = _STATUS_BADGE[d.status] || '';
    const isActive = d.id === DraftState.activeDraft?.id;
    return `<div
      class="nav-item${isActive ? ' active' : ''}"
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
  // Auto-close draft drawer on mobile setelah pilih
  if (window.innerWidth <= 768) {
    document.getElementById('draftListPanel')?.classList.remove('drawer-open');
    document.getElementById('draftDrawerOverlay')?.classList.remove('show');
  }

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

  // Init items state — handle both shapes:
  //   new (OCR n8n + edge fn): {nama, qty, satuan, harga_satuan}
  //   legacy:                  {nama, qty, satuan, harga}
  DraftState.items = (ocr.items || []).map((item, idx) => {
    const namaOcr    = item.nama || item.nama_item || '';
    const learnedId  = findLearnedBarang(namaOcr);
    const barang     = learnedId ? DraftState.barangMap[learnedId] : null;
    const candidates  = findBarangCandidates(namaOcr);
    const topMatch    = candidates[0];
    const taOcr       = _tokenize(namaOcr);
    // OCR coverage: berapa % token OCR yg ter-match. Cegah false auto-select
    // saat banyak token OCR tidak match (e.g. "CHEESE COLOURED BURGER SLICE" → "Cheesy Cheese Slice")
    const ocrCoverage = (topMatch && taOcr.length > 0)
      ? (topMatch._matchCount || 0) / taOcr.length : 0;
    let matchType    = 'none', barangId = null, barangNama = '';
    if (barang) {
      matchType  = 'learned'; barangId = barang.id; barangNama = barang.nama;
    } else if (topMatch && ocrCoverage > 0.4 && (
      topMatch.score >= 0.85 ||
      (topMatch.score >= 0.55 && (!candidates[1] || topMatch.score >= candidates[1].score * 1.2))
    )) {
      // Auto-pick: OCR coverage >40% + confident (≥85%) ATAU clear winner
      matchType  = 'exact';   barangId = topMatch.id; barangNama = topMatch.nama;
    }
    // Kalo fuzzy < 0.85, biarin user pilih manual — tetep show kandidat di dropdown
    const harga = parseFloat(item.harga_satuan ?? item.harga) || 0;
    return {
      idx, namaOcr,
      qty:         parseFloat(item.qty)   || 1,
      satuan:      item.satuan            || '',
      harga,
      barangId, barangNama, matchType,
      isUnmatched: false,
      searchOpen:  false,
      searchQuery: '',
      candidates,
    };
  });

  // Init vendor
  DraftState.vendorNamaOcr    = ocr.vendor || ocr.nama_vendor || '';
  DraftState.vendorCandidates = findVendorCandidates(DraftState.vendorNamaOcr);
  const learnedVId = findLearnedVendor(DraftState.vendorNamaOcr);
  DraftState.selectedVendorId = learnedVId
    || (DraftState.vendorCandidates[0]?.score >= 0.5 ? DraftState.vendorCandidates[0].id : null);

  DraftState.vendorBankAccts = [];
  DraftState.selectedBankId  = null;
  if (DraftState.selectedVendorId) await loadVendorBankAccts(DraftState.selectedVendorId);

  renderInfoSection();
  renderItemsSection();
  renderSummarySection();
}

// ── Status chip (header card) ─────────────────────────────────────
const _STATUS_CHIP = {
  needs_review: `<span style="background:rgba(247,146,79,0.15);color:var(--accent3);border:1px solid rgba(247,146,79,0.3)">⏳ Perlu Review</span>`,
  confirmed:    `<span style="background:rgba(56,217,169,0.15);color:var(--accent2);border:1px solid rgba(56,217,169,0.3)">✓ Confirmed</span>`,
  rejected:     `<span style="background:rgba(255,77,106,0.12);color:var(--danger);border:1px solid rgba(255,77,106,0.3)">✕ Rejected</span>`,
};

// ── Info + Vendor section (gabungan, pola pembelian.html) ───────
async function loadVendorBankAccts(vendorId) {
  const { data } = await window._sb.from('vendor_bank_accounts')
    .select('*').eq('vendor_id', vendorId).order('is_primary', { ascending: false });
  DraftState.vendorBankAccts = data || [];
  DraftState.selectedBankId  = data?.[0]?.id || null;
}

function renderInfoSection() {
  const draft = DraftState.activeDraft;
  if (!draft) return;
  const ocr = draft.ocr_result || {};
  const vid = DraftState.selectedVendorId;
  const vScore = DraftState.vendorCandidates[0]?.score || 0;
  const vendorBadge = !vid
    ? `<span class="harga-src fallback">tidak ditemukan</span>`
    : vScore >= 0.85
      ? `<span class="harga-src vendor">✓ ditemukan</span>`
      : `<span class="harga-src manual">mirip — periksa</span>`;

  const matchedVendorNama = vid
    ? (DraftState.vendorMap[vid]?.nama || '')
    : '';

  const bankHTML = DraftState.vendorBankAccts.length
    ? `<select id="bankSelect" onchange="DraftState.selectedBankId=this.value">
        ${DraftState.vendorBankAccts.map(a =>
          `<option value="${escHtml(a.id)}" ${a.id === DraftState.selectedBankId ? 'selected' : ''}>
            ${escHtml(a.bank_name)} — ${escHtml(a.account_number)} (${escHtml(a.account_name)})
           </option>`
        ).join('')}
       </select>`
    : `<div style="font-size:11px;color:var(--muted);font-family:var(--mono);padding:8px 0">Tidak ada rekening terdaftar utk vendor ini</div>`;

  const ppnIncluded = ocr.ppn_included !== false;

  // Status chip di header
  const chip = document.getElementById('draftStatusChip');
  if (chip) chip.innerHTML = _STATUS_CHIP[draft.status] || '';

  const nomorFaktur = ocr.nomor_faktur || ocr.nomor_invoice || '';

  // Cek duplikat nomor faktur di invoice_drafts + riwayat_beli (async, inject setelah render)
  if (nomorFaktur) {
    Promise.all([
      window._sb.from('invoice_drafts').select('id,brand_id').eq('ocr_result->>nomor_faktur', nomorFaktur).neq('id', draft.id),
      window._sb.from('riwayat_beli').select('id,tanggal').eq('nomor_faktur', nomorFaktur),
    ]).then(([{data: dDup}, {data: rDup}]) => {
      const el = document.getElementById('duplikatWarning');
      if (!el) return;
      const total = (dDup?.length || 0) + (rDup?.length || 0);
      if (total > 0) {
        el.innerHTML = `<div style="padding:7px 12px;background:rgba(255,77,106,0.1);border:1px solid rgba(255,77,106,0.3);border-radius:7px;font-size:11px;font-family:var(--mono);color:var(--danger)">⚠ Nomor faktur <b>${escHtml(nomorFaktur)}</b> sudah ada di ${dDup?.length ? `${dDup.length} draft` : ''}${dDup?.length && rDup?.length ? ' + ' : ''}${rDup?.length ? `${rDup.length} pembelian` : ''} — periksa duplikat</div>`;
        el.style.display = 'block';
      } else {
        el.style.display = 'none';
      }
    }).catch(() => {});
  }

  document.getElementById('infoSection').innerHTML = `
    <!-- Meta banner: No.Faktur + Tanggal + Masuk — compact -->
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

    <!-- Duplikat warning (injected async) -->
    <div id="duplikatWarning" style="display:none;margin-bottom:10px"></div>

    <!-- Vendor + Rekening — 2 kolom compact -->
    <div class="field-row" style="margin-bottom:14px">
      <div class="field" style="margin-bottom:0">
        <label style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <span>Vendor</span>
          ${vendorBadge}
        </label>
        <div style="font-size:10px;color:var(--accent3);font-family:var(--mono);margin-bottom:6px">
          OCR: ${escHtml(DraftState.vendorNamaOcr || '—')}
          ${matchedVendorNama ? `→ <span style="color:var(--text)">${escHtml(matchedVendorNama)}</span>` : ''}
        </div>
        <select id="vendorSelect" onchange="onVendorChange()">
          <option value="">— Pilih Vendor —</option>
          ${DraftState.allVendor.map(v =>
            `<option value="${escHtml(v.id)}" ${v.id === vid ? 'selected' : ''}>${escHtml(v.nama)}</option>`
          ).join('')}
        </select>
      </div>
      <div class="field" style="margin-bottom:0">
        <label style="margin-bottom:4px">Rekening Tujuan</label>
        ${bankHTML}
      </div>
    </div>

    <!-- PPN toggle compact -->
    <div>
      <label style="display:block;font-family:var(--mono);font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px">
        Status Harga <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--accent3)">(koreksi jika salah)</span>
      </label>
      <div class="diskon-toggle" style="max-width:280px">
        <button class="diskon-toggle-btn ${!ppnIncluded ? 'active' : ''}" onclick="setDraftPPN(false)">Exc PPN</button>
        <button class="diskon-toggle-btn ${ppnIncluded ? 'active' : ''}" onclick="setDraftPPN(true)">Inc PPN ${(window._ppnRate || 11)}%</button>
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

async function onVendorChange() {
  const newVid = document.getElementById('vendorSelect')?.value || null;
  DraftState.selectedVendorId = newVid;
  DraftState.vendorBankAccts  = [];
  DraftState.selectedBankId   = null;
  if (newVid) await loadVendorBankAccts(newVid);
  renderInfoSection();
}

// ── Items section ─────────────────────────────────────────────────
// Layout mirip pembelian.html: header kolom (Barang invoice → master | Qty | Satuan | Harga | ✓)
function renderItemsSection() {
  const el = document.getElementById('itemsSection');
  // Update header chip
  const chip = document.getElementById('itemCountChip');
  if (chip) chip.textContent = `${DraftState.items.length} item`;

  if (!DraftState.items.length) {
    el.innerHTML = `<div class="empty-state" style="padding:24px;text-align:center;color:var(--muted);font-size:13px">Tidak ada item dari OCR</div>`;
    return;
  }
  el.innerHTML = `
    <div style="font-size:11px;font-family:var(--sans);margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap">
      <span class="badge badge-green" style="font-size:10px">✓ cocok</span>
      <span class="badge badge-orange" style="font-size:10px">🔶 mirip</span>
      <span class="badge badge-gray" style="font-size:10px">✎ manual</span>
    </div>
    <!-- Header kolom -->
    <div style="display:flex;align-items:center;padding:6px 8px;gap:8px;border-bottom:1px solid var(--border)">
      <div style="width:20px;flex-shrink:0"></div>
      <div style="flex:1;font-size:10px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:500">Barang invoice → master</div>
      <div style="width:70px;flex-shrink:0;text-align:right;font-size:10px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:500">Qty</div>
      <div style="width:80px;flex-shrink:0;text-align:center;font-size:10px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:500">Satuan</div>
      <div style="width:130px;flex-shrink:0;text-align:right;font-size:10px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:500">Harga Satuan</div>
      <div style="width:24px;flex-shrink:0;text-align:center;font-size:10px;font-family:var(--mono);color:var(--muted);font-weight:500">✓</div>
    </div>
    <!-- Rows -->
    <div id="draftItemRows">${DraftState.items.map(renderItemRow).join('')}</div>
  `;
}

const _MATCH_ICON = {
  learned: '✅',
  exact:   '✅',
  fuzzy:   '🔶',
  none:    '✏️',
};
const _MATCH_LABEL = {
  learned: 'learned',
  exact:   'cocok',
  fuzzy:   'mirip',
  none:    'manual',
};

const _MATCH_BADGE = {
  learned: `<span class="harga-src vendor"   title="Dari mapping sebelumnya">learned</span>`,
  exact:   `<span class="harga-src vendor"   title="Cocok persis">exact</span>`,
  fuzzy:   `<span class="harga-src manual"   title="Mirip — perlu konfirmasi">fuzzy</span>`,
  none:    `<span class="harga-src fallback" title="Tidak ada match">no match</span>`,
};

function _renderCandidateOption(idx, c) {
  const sku = c.sku ? `<div class="item-option-sub">${escHtml(c.sku)}${c.satuan ? ' · ' + escHtml(c.satuan) : ''}</div>` : '';
  const pct = c.score ? `<span style="font-size:10px;color:var(--muted);font-family:var(--mono);margin-left:6px">${Math.round(c.score * 100)}%</span>` : '';
  const namaJson = JSON.stringify(c.nama).replace(/"/g, '&quot;');
  return `<div class="item-option"
       onclick="event.stopPropagation();selectItemBarang(${idx},'${escHtml(c.id)}',${namaJson})">
    <div class="item-option-name">${escHtml(c.nama)}${pct}</div>
    ${sku}
  </div>`;
}

// Pattern: row scan-invoice — 2 baris per item (search row + meta row)
function renderItemRow(item) {
  const initialList = item.candidates.length
    ? item.candidates
    : DraftState.allBarang.slice(0, 20).map(b => ({ ...b, score: 0 }));
  const candidateRows = initialList.length
    ? initialList.map(c => _renderCandidateOption(item.idx, c)).join('')
    : `<div class="empty-state" style="padding:18px 14px;text-align:center;font-size:12px;color:var(--muted)">Master barang kosong.<br/><span style="opacity:.8">Tambah dulu di menu Barang, atau centang "barang bebas".</span></div>`;

  const icon = _MATCH_ICON[item.matchType] || '✏️';
  const matchedNama = item.isUnmatched
    ? '— barang bebas —'
    : (item.barangNama
        ? `${item.barangNama}${item.satuan ? ' · ' + item.satuan : ''}`
        : 'ketik untuk cari');

  // Input pencarian (read-only trigger; expand → input search + dropdown candidates)
  const searchInput = `
    <div style="position:relative;width:100%">
      <input type="text" class="search-input" style="padding-left:12px;padding-right:28px;cursor:pointer;width:100%"
             readonly
             placeholder="— Pilih barang dari master —"
             value="${escHtml(item.isUnmatched ? '— barang bebas —' : item.barangNama)}"
             onclick="event.stopPropagation();toggleItemSearch(${item.idx})"/>
      <span class="combo-arrow" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none">▼</span>
    </div>`;

  const dropdown = item.searchOpen ? `
    <div class="item-dropdown" style="position:absolute;top:calc(100% + 4px);left:0;right:0;max-height:320px;border:1px solid rgba(0,212,255,0.25);box-shadow:0 8px 32px rgba(0,0,0,0.5), var(--glow-accent);z-index:9999"
         onclick="event.stopPropagation()">
      <div style="padding:8px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface2);z-index:1">
        <div class="search-wrap">
          <span class="search-icon">🔍</span>
          <input class="search-input"
                 placeholder="Cari barang..."
                 id="itemSearch_${item.idx}"
                 oninput="updateItemSearch(${item.idx},this.value)"
                 value="${escHtml(item.searchQuery)}"
                 onclick="event.stopPropagation()"
                 autofocus/>
        </div>
      </div>
      <div id="itemSearchResults_${item.idx}">${candidateRows}</div>
    </div>` : '';

  const subtotal = formatRp(item.qty * item.harga);

  return `
    <div class="item-row" id="itemRow_${item.idx}"
         style="grid-template-columns:1fr;gap:6px;padding:10px 8px;margin-bottom:8px;${item.searchOpen ? 'z-index:200;position:relative;' : ''}">
      <!-- Baris 1: dari OCR (full width) -->
      <div style="font-size:12px;font-family:var(--mono);color:var(--accent3);margin-bottom:4px">
        📄 ${escHtml(item.namaOcr || '—')}
        ${item.satuan ? `<span style="color:var(--muted)">[${escHtml(item.satuan)}]</span>` : ''}
      </div>

      <!-- Baris 2: icon · barang picker · qty · satuan · harga · checkbox -->
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:20px;flex-shrink:0;text-align:center;font-size:13px">${icon}</div>
        <div style="flex:1;min-width:0;position:relative">${searchInput}${dropdown}</div>
        <div style="width:70px;flex-shrink:0">
          <input class="item-input" type="text" inputmode="decimal" value="${item.qty}"
                 oninput="this.value=this.value.replace(',','.');updateItemField(${item.idx},'qty',parseFloat(this.value)||0)"
                 onblur="this.value=parseFloat(this.value)||''" title="Qty"/>
        </div>
        <div style="width:80px;flex-shrink:0">
          <input class="item-input" type="text" value="${escHtml(item.satuan)}" style="text-align:center"
                 onchange="updateItemField(${item.idx},'satuan',this.value)" title="Satuan"/>
        </div>
        <div style="width:130px;flex-shrink:0">
          <input class="item-input" type="text" inputmode="decimal" value="${item.harga}"
                 oninput="this.value=this.value.replace(',','.');updateItemField(${item.idx},'harga',parseFloat(this.value)||0)"
                 onblur="this.value=parseFloat(this.value)||''" title="Harga satuan"/>
        </div>
        <div style="width:24px;flex-shrink:0;text-align:center">
          <input type="checkbox" ${!item.isUnmatched && item.barangId || item.isUnmatched ? 'checked' : ''}
                 disabled
                 title="Akan disimpan saat konfirmasi"
                 style="accent-color:var(--accent2);width:15px;height:15px"/>
        </div>
      </div>

      <!-- Baris 3: meta (badge + matched name + subtotal) -->
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
        <div style="width:20px;flex-shrink:0"></div>
        <div style="flex:1;min-width:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span class="harga-src ${item.isUnmatched ? 'manual' : (item.matchType==='exact'||item.matchType==='learned' ? 'vendor' : item.matchType==='fuzzy' ? 'manual' : 'fallback')}">${_MATCH_LABEL[item.matchType] || 'manual'}</span>
          <span style="font-size:11px;color:var(--muted);font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(matchedNama)}</span>
          <label style="font-size:10px;color:var(--muted);cursor:pointer;display:flex;align-items:center;gap:4px;margin-left:auto;font-family:var(--mono)">
            <input type="checkbox" ${item.isUnmatched ? 'checked' : ''} onchange="toggleUnmatched(${item.idx},this.checked)"/>
            barang bebas
          </label>
          ${!item.isUnmatched
            ? `<button class="btn btn-ghost btn-sm" onclick="openAddBarangModal(${item.idx})" style="font-size:10px;padding:2px 8px" title="Tambah ke master">＋ master</button>`
            : ''}
        </div>
        <div style="width:328px;flex-shrink:0;text-align:right">
          <span class="item-subtotal" id="subtotal_${item.idx}" style="font-size:13px">${subtotal}</span>
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
  let results;
  const item = DraftState.items[idx];
  if (query.trim()) {
    const ta = _tokenize(item.namaOcr);
    results = DraftState.allBarang
      .filter(b => b.nama.toLowerCase().includes(query.toLowerCase()))
      .map(b => {
        const tb = _tokenize(b.nama);
        let score = _fuzzyScore(item.namaOcr, b.nama);
        const hasAnchor = ta.some(t => t.length >= 5 && tb.includes(t));
        if (hasAnchor) score = Math.max(score, 0.6);
        return { ...b, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  } else {
    // Query kosong: candidates fuzzy → fallback ke 20 barang teratas
    results = DraftState.items[idx].candidates.length
      ? DraftState.items[idx].candidates
      : DraftState.allBarang.slice(0, 20);
  }
  const el = document.getElementById(`itemSearchResults_${idx}`);
  if (!el) return;
  el.innerHTML = results.length
    ? results.map(c => _renderCandidateOption(idx, c)).join('')
    : `<div style="padding:16px;font-size:13px;color:var(--muted);text-align:center">Tidak ada hasil utk "<b>${escHtml(query)}</b>"</div>`;
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

// ── Summary action bar (bottom sticky) ───────────────────────────
function renderSummarySection() {
  const draft = DraftState.activeDraft;
  if (!draft) return;
  const ocr = draft.ocr_result || {};

  const subtotal = DraftState.items.reduce((s, i) => s + i.qty * i.harga, 0);
  const diskon = Number(ocr.diskon) || 0;
  const ongkir = Number(ocr.ongkir) || 0;
  const ppnRate = (window._ppnRate || 11) / 100;
  const ppnIncluded = ocr.ppn_included !== false;
  // Jika harga input udah INC PPN, subtotal sudah termasuk PPN — exc-nya dihitung mundur
  const subEx = ppnIncluded ? subtotal / (1 + ppnRate) : subtotal;
  const ppnAmt = subEx * ppnRate;
  const total = subEx + ppnAmt - diskon + ongkir;

  const unresolved = DraftState.items.filter(i => !i.barangId && !i.isUnmatched).length;
  const isDone = draft.status === 'confirmed' || draft.status === 'rejected';

  document.getElementById('summarySection').innerHTML = `
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap">
      <!-- Breakdown -->
      <div style="display:flex;gap:18px;flex-wrap:wrap;flex:1;min-width:0">
        <div>
          <div style="font-size:10px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px">Subtotal (exc PPN)</div>
          <div style="font-size:13px;font-family:var(--mono);margin-top:2px">${formatRp(Math.round(subEx))}</div>
        </div>
        <div>
          <div style="font-size:10px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px">+ PPN ${Math.round(ppnRate*100)}%</div>
          <div style="font-size:13px;font-family:var(--mono);color:var(--accent2);margin-top:2px">${formatRp(Math.round(ppnAmt))}</div>
        </div>
        ${diskon ? `<div>
          <div style="font-size:10px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px">Diskon</div>
          <div style="font-size:13px;font-family:var(--mono);color:var(--accent3);margin-top:2px">- ${formatRp(diskon)}</div>
        </div>` : ''}
        ${ongkir ? `<div>
          <div style="font-size:10px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px">Ongkir</div>
          <div style="font-size:13px;font-family:var(--mono);margin-top:2px">+ ${formatRp(ongkir)}</div>
        </div>` : ''}
        <div style="padding-left:18px;border-left:1px solid var(--border)">
          <div style="font-size:10px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.8px">Total</div>
          <div class="summary-total" style="font-size:22px;margin-top:2px">${formatRp(Math.round(total))}</div>
          ${unresolved > 0
            ? `<div style="font-size:11px;color:var(--danger);margin-top:2px;font-family:var(--mono)">&#9888; ${unresolved} item belum dipilih barangnya</div>`
            : ''}
        </div>
      </div>
      <!-- Actions -->
      ${!isDone ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost is-destructive" onclick="openRejectModal()">✕ Tolak</button>
          <button class="btn btn-primary" onclick="confirmDraft()">✓ Konfirmasi</button>
        </div>
      ` : `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="item-sub" style="padding:8px 12px">Draft sudah ${draft.status}.</span>
          ${draft.status === 'confirmed'
            ? `<button class="btn btn-ghost is-destructive" style="font-size:12px"
                onclick="undoConfirmDraft()">↩ Batal Konfirmasi</button>`
            : ''}
        </div>`}
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
  renderInfoSection();
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
  const tanggal = ocr.tanggal || ocr.tanggal_invoice || new Date().toISOString().slice(0, 10);
  const { data: { user } } = await sb.auth.getUser();

  try {
    // 1. INSERT riwayat_beli
    const { data: beli, error: beliErr } = await sb.from('riwayat_beli').insert({
      tanggal,
      nomor_faktur: ocr.nomor_faktur || ocr.nomor_invoice || null,
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
    showToast('Tidak ada data pembelian terkait untuk di-undo', 'error'); return;
  }
  const ok = confirm('Batalkan konfirmasi? Ini akan menghapus riwayat pembelian & payment request yang sudah dibuat.');
  if (!ok) return;

  const sb = window._sb;
  const beliId = draft.riwayat_beli_id;
  try {
    // 1. Reset invoice_drafts DULU — lepas FK sebelum hapus riwayat_beli
    const { error: draftErr } = await sb.from('invoice_drafts').update({
      status:          'needs_review',
      reviewed_by:     null,
      reviewed_at:     null,
      riwayat_beli_id: null,
    }).eq('id', draft.id);
    if (draftErr) throw draftErr;

    // 2. Hapus payment_requests
    const { error: payErr } = await sb.from('payment_requests')
      .delete().eq('riwayat_beli_id', beliId);
    if (payErr) throw payErr;

    // 3. Hapus riwayat_beli_items
    const { error: itemErr } = await sb.from('riwayat_beli_items')
      .delete().eq('beli_id', beliId);
    if (itemErr) throw itemErr;

    // 4. Hapus riwayat_beli (FK sudah dilepas di step 1)
    const { error: beliErr } = await sb.from('riwayat_beli')
      .delete().eq('id', beliId);
    if (beliErr) throw beliErr;

    showToast('Konfirmasi dibatalkan — draft dikembalikan ke Perlu Review', 'success');
    DraftState.activeDraft.status          = 'needs_review';
    DraftState.activeDraft.riwayat_beli_id = null;
    renderInfoSection();
    renderSummarySection();
    loadDrafts();
  } catch(e) {
    showToast('Gagal undo: ' + (e.message || e), 'error');
  }
}

// ── Close dropdowns on outside click ─────────────────────────────
// Cek target SEBELUM render — pakai composedPath() supaya tetap akurat
// walau elemen aslinya udah di-detach pas renderItemsSection() ditrigger.
document.addEventListener('click', e => {
  const hasOpen = DraftState.items.some(i => i.searchOpen);
  if (!hasOpen) return;
  const path = (typeof e.composedPath === 'function') ? e.composedPath() : [];
  const inside = path.some(n => n.id === 'itemsSection') || !!e.target.closest?.('#itemsSection');
  if (inside) return;
  DraftState.items.forEach(i => { i.searchOpen = false; });
  renderItemsSection();
});

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
    } else {
      console.error('[invoice-drafts] renderSidebar not loaded — cek sidebar.js include');
    }
  } catch (e) {
    console.error('[invoice-drafts] renderSidebar gagal:', e);
  }

  try { await Promise.all([loadMasterData(), loadLearnedMappingsLocal()]); }
  catch (e) { console.error('[invoice-drafts] loadMasterData/loadLearnedMappings gagal:', e); }
  try { await loadBrands(); }
  catch (e) { console.error('[invoice-drafts] loadBrands gagal:', e); }

  hideLoader();
  loadDrafts();
});
