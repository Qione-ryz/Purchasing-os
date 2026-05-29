/* ================================================================
   scan-invoice.js — v4
   ⚠️  Ganti SUPABASE_URL sebelum deploy.
   ================================================================ */

// URL diambil otomatis dari config.js
const SCAN_SUPABASE_URL = (typeof APP_CONFIG !== "undefined" && APP_CONFIG.supabaseUrl)
  ? APP_CONFIG.supabaseUrl
  : "https://YOUR_PROJECT_ID.supabase.co";

// ────────────────────────────────────────────────────────────────
// SISTEM PEMBELAJARAN — simpan & load riwayat mapping ke Supabase
// Tabel: scan_mappings (nama_invoice TEXT, barang_id UUID, vendor_nama TEXT, vendor_id UUID)
// ────────────────────────────────────────────────────────────────
let _learnedMappings = null; // cache: { "nama_invoice_lower": barang_id }
let _learnedVendors  = null; // cache: { "nama_vendor_lower":  vendor_id }

async function loadLearnedMappings() {
  if (_learnedMappings !== null) return; // sudah di-cache
  try {
    const sb = window._sb;
    if (!sb) return;
    const { data } = await sb.from("scan_mappings").select("nama_invoice,barang_id,vendor_nama,vendor_id");
    _learnedMappings = {};
    _learnedVendors  = {};
    (data || []).forEach(r => {
      if (r.nama_invoice && r.barang_id) _learnedMappings[r.nama_invoice.toLowerCase()] = r.barang_id;
      if (r.vendor_nama  && r.vendor_id) _learnedVendors[r.vendor_nama.toLowerCase()]   = r.vendor_id;
    });
  } catch(e) {
    _learnedMappings = {};
    _learnedVendors  = {};
  }
}

async function saveLearnedMapping(namaInvoice, barangId) {
  if (!namaInvoice || !barangId) return;
  try {
    const sb = window._sb;
    if (!sb) return;
    await sb.from("scan_mappings").upsert(
      { nama_invoice: namaInvoice.toLowerCase(), barang_id: barangId },
      { onConflict: "nama_invoice" }
    );
    if (_learnedMappings) _learnedMappings[namaInvoice.toLowerCase()] = barangId;
  } catch(e) { /* silent */ }
}

async function saveLearnedVendor(namaVendorInvoice, vendorId) {
  if (!namaVendorInvoice || !vendorId) return;
  try {
    const sb = window._sb;
    if (!sb) return;
    await sb.from("scan_mappings").upsert(
      { nama_invoice: "__vendor__" + namaVendorInvoice.toLowerCase(), vendor_nama: namaVendorInvoice.toLowerCase(), vendor_id: vendorId },
      { onConflict: "nama_invoice" }
    );
    if (_learnedVendors) _learnedVendors[namaVendorInvoice.toLowerCase()] = vendorId;
  } catch(e) { /* silent */ }
}

function findLearnedBarang(namaInvoice) {
  if (!_learnedMappings || !namaInvoice) return null;
  const id = _learnedMappings[namaInvoice.toLowerCase()];
  if (!id) return null;
  return (window.allBarang || []).find(b => String(b.id) === String(id)) || null;
}

function findLearnedVendor(namaVendorInvoice) {
  if (!_learnedVendors || !namaVendorInvoice) return null;
  const id = _learnedVendors[namaVendorInvoice.toLowerCase()];
  if (!id) return null;
  return (window.allVendors || window.PageState?.allVendors || []).find(v => String(v.id) === String(id)) || null;
}

// ────────────────────────────────────────────────────────────────
// 1. INJECT CSS
// ────────────────────────────────────────────────────────────────
(function injectCSS() {
  const style = document.createElement("style");
  style.textContent = `
    /* Tombol utama scan */
    .scan-invoice-btn {
      display:flex; align-items:center; gap:8px; padding:10px 16px;
      background:rgba(79,142,247,0.1); border:1px dashed rgba(79,142,247,0.4);
      border-radius:8px; color:var(--accent); font-size:13px; font-weight:500;
      cursor:pointer; width:100%; justify-content:center; transition:all .2s;
      font-family:var(--sans); position:relative;
    }
    .scan-invoice-btn:hover  { background:rgba(79,142,247,0.18); border-color:var(--accent); }
    .scan-invoice-btn:disabled { opacity:.5; cursor:not-allowed; }
    .scan-invoice-btn .scan-spinner {
      width:14px; height:14px; border:2px solid rgba(79,142,247,0.3);
      border-top-color:var(--accent); border-radius:50%;
      animation:scanSpin .7s linear infinite; flex-shrink:0;
    }
    @keyframes scanSpin { to { transform:rotate(360deg); } }
    #scanInvoiceInput { display:none; }

    /* Expand zone — muncul setelah tombol diklik */
    .scan-expand-zone {
      display:none; margin-top:8px;
      border:2px dashed rgba(79,142,247,0.35); border-radius:10px;
      background:rgba(79,142,247,0.04); padding:20px 16px;
      text-align:center; transition:all .2s;
      animation:scanZoneIn .18s ease;
    }
    @keyframes scanZoneIn {
      from { opacity:0; transform:translateY(-6px); }
      to   { opacity:1; transform:translateY(0); }
    }
    .scan-expand-zone.open { display:block; }
    .scan-expand-zone.dragover {
      background:rgba(79,142,247,0.12); border-color:var(--accent);
      box-shadow:0 0 0 3px rgba(79,142,247,0.12);
    }
    .scan-ez-title {
      font-size:13px; font-weight:600; color:var(--text); margin-bottom:4px;
    }
    .scan-ez-sub {
      font-size:11px; color:var(--muted); font-family:var(--mono);
      margin-bottom:14px; line-height:1.6;
    }
    .scan-ez-kbd {
      display:inline-block; padding:1px 6px; border-radius:4px;
      background:var(--surface2); border:1px solid var(--border);
      font-size:10px; font-family:var(--mono); color:var(--text);
    }
    .scan-ez-actions { display:flex; gap:8px; justify-content:center; flex-wrap:wrap; }
    .scan-ez-btn {
      display:inline-flex; align-items:center; gap:6px;
      padding:7px 14px; border-radius:7px; font-size:12px; font-weight:500;
      cursor:pointer; transition:all .15s; border:1px solid var(--border);
      background:var(--surface2); color:var(--text); font-family:var(--sans);
    }
    .scan-ez-btn:hover { border-color:var(--accent); color:var(--accent); background:rgba(79,142,247,0.07); }
    .scan-ez-btn.primary {
      background:rgba(79,142,247,0.12); border-color:rgba(79,142,247,0.4); color:var(--accent);
    }
    .scan-ez-btn.primary:hover { background:rgba(79,142,247,0.2); }
    .scan-ez-formats {
      margin-top:10px; font-size:10px; color:var(--muted); font-family:var(--mono);
    }
    .scan-ez-close {
      float:right; background:none; border:none; color:var(--muted);
      cursor:pointer; font-size:16px; line-height:1; padding:0; margin-top:-4px;
    }
    .scan-ez-close:hover { color:var(--text); }

    #scanInvoiceWrapper {
      margin-bottom:20px;
      padding-bottom:20px;
      border-bottom:1px solid var(--border);
    }
    .scan-preview-box {
      background:var(--surface2); border:1px solid var(--border);
      border-radius:8px; padding:12px 14px; margin-bottom:0;
      font-size:12px; font-family:var(--mono); color:var(--muted); display:none;
    }
    .scan-preview-box.show { display:block; }
    .scan-preview-name { font-weight:600; color:var(--text); margin-bottom:4px; font-size:13px; }
    .scan-result-badge {
      display:inline-flex; align-items:center; gap:5px;
      font-size:11px; font-family:var(--mono); padding:3px 8px; border-radius:4px; margin-top:6px;
    }
    .scan-result-badge.ok  { background:rgba(56,217,169,0.12); color:var(--accent2); border:1px solid rgba(56,217,169,0.25); }
    .scan-result-badge.err { background:rgba(248,113,113,0.12); color:var(--danger);  border:1px solid rgba(248,113,113,0.25); }

    /* Suggest dropdown */
    .scan-suggest-wrap { position:relative; }
    .scan-suggest-input {
      width:100%; background:var(--bg); border:1px solid var(--border);
      border-radius:6px; color:var(--text); font-family:var(--sans);
      font-size:12px; padding:6px 10px; outline:none; transition:border-color .15s; box-sizing:border-box;
    }
    .scan-suggest-input:focus { border-color:var(--accent); }
    .scan-suggest-dropdown {
      position:fixed;
      background:var(--surface2); border:1px solid var(--border);
      border-radius:7px; max-height:220px; overflow-y:auto;
      z-index:99999; box-shadow:0 6px 20px rgba(0,0,0,0.5); display:none;
      min-width:200px;
    }
    .scan-suggest-dropdown.open { display:block; }
    .scan-suggest-opt {
      padding:8px 12px; cursor:pointer; font-size:12px;
      border-bottom:1px solid rgba(37,40,48,0.5); transition:background .1s;
    }
    .scan-suggest-opt:last-child { border-bottom:none; }
    .scan-suggest-opt:hover, .scan-suggest-opt:active { background:rgba(79,142,247,0.1); }
    .scan-suggest-opt-name { font-weight:500; }
    .scan-suggest-opt-sub { font-size:10px; color:var(--muted); font-family:var(--mono); margin-top:1px; }

    /* Badge status */
    .scan-badge {
      font-size:9px; font-family:var(--mono); padding:1px 6px;
      border-radius:3px; vertical-align:middle; font-weight:600;
    }
    .scan-badge.exact  { background:rgba(56,217,169,0.15); color:var(--accent2); }
    .scan-badge.fuzzy  { background:rgba(247,146,79,0.15);  color:var(--accent3); }
    .scan-badge.manual { background:rgba(107,114,128,0.15); color:var(--muted); }
    .scan-badge.vendor-ok { background:rgba(56,217,169,0.15); color:var(--accent2); }
    .scan-badge.vendor-no { background:rgba(247,146,79,0.15); color:var(--accent3); }

    /* Layout tabel modal */
    .scan-tbl { width:100%; border-collapse:collapse; }
    .scan-tbl thead tr { border-bottom:1px solid var(--border); }
    .scan-tbl th { font-size:10px; font-family:var(--mono); color:var(--muted);
                   text-transform:uppercase; letter-spacing:.5px; font-weight:500; padding:7px 8px; }
    .scan-tbl td { padding:0; vertical-align:top; }
    .scan-tbl tr.scan-item-row { border-bottom:1px solid rgba(37,40,48,0.6); }
    .scan-tbl tr.scan-item-row:last-child { border-bottom:none; }

    /* Input kecil */
    .scan-num-input {
      background:var(--bg); border:1px solid var(--border); border-radius:5px;
      color:var(--text); font-family:var(--mono); font-size:12px;
      padding:5px 7px; text-align:right; outline:none; width:100%; box-sizing:border-box;
    }
    .scan-num-input:focus { border-color:var(--accent); }
    .scan-qty-wrap { display:flex; align-items:center; gap:4px; justify-content:flex-end; white-space:nowrap; }
    .scan-satuan-note { font-size:10px; color:var(--muted); font-family:var(--mono); margin-top:3px; text-align:right; }
    .scan-harga-note  { font-size:10px; color:var(--muted); font-family:var(--mono); margin-top:3px; text-align:right; }

    /* PPN toggle di modal */
    .scan-ppn-toggle { display:flex; gap:4px; margin-top:4px; }
    .scan-ppn-btn {
      flex:1; padding:4px 6px; border:1px solid var(--border); border-radius:5px;
      background:var(--bg); color:var(--muted); font-family:var(--mono);
      font-size:10px; cursor:pointer; text-align:center; transition:all .15s;
    }
    .scan-ppn-btn.active { background:rgba(79,142,247,0.12); color:var(--accent); border-color:var(--accent); }

    /* Info tag di bawah nama barang */
    .scan-from-invoice { font-size:10px; color:var(--muted); font-family:var(--mono); }
    .btn-review-ulang {
      display:inline-flex; align-items:center; gap:6px;
      padding:5px 12px; border-radius:6px; font-size:12px; cursor:pointer;
      background:rgba(79,142,247,0.1); border:1px solid rgba(79,142,247,0.3);
      color:var(--accent); font-family:var(--sans); transition:all .15s;
    }
    .btn-review-ulang:hover { background:rgba(79,142,247,0.2); }

    /* Progress bar scan */
    .scan-progress-wrap {
      margin-top:10px; background:var(--surface2);
      border:1px solid var(--border); border-radius:8px; padding:12px 14px;
    }
    .scan-progress-label {
      font-size:12px; font-family:var(--mono); color:var(--text);
      margin-bottom:8px; display:flex; justify-content:space-between;
    }
    .scan-progress-bar-track {
      height:6px; background:rgba(79,142,247,0.15); border-radius:3px; overflow:hidden;
    }
    .scan-progress-bar-fill {
      height:100%; border-radius:3px; transition:width .4s ease;
      background:linear-gradient(90deg, var(--accent), rgba(56,217,169,0.8));
    }
    .scan-progress-steps {
      display:flex; gap:6px; margin-top:8px;
    }
    .scan-progress-step {
      flex:1; font-size:10px; font-family:var(--mono); color:var(--muted);
      text-align:center; padding:4px 2px; border-radius:4px;
      border:1px solid transparent; transition:all .3s;
      pointer-events:none; cursor:default; user-select:none;
    }
    .scan-progress-step.active {
      color:var(--accent); border-color:rgba(79,142,247,0.4);
      background:rgba(79,142,247,0.08);
    }
    .scan-progress-step.done {
      color:var(--accent2); border-color:rgba(56,217,169,0.3);
      background:rgba(56,217,169,0.08);
    }

    /* Popup konfirmasi kalikan qty */
    .scan-qty-popup {
      position:fixed; z-index:99999;
      background:var(--surface2); border:1px solid var(--border);
      border-radius:8px; padding:10px 12px;
      box-shadow:0 6px 20px rgba(0,0,0,0.5);
      min-width:200px;
      animation:scanZoneIn .12s ease;
    }
    .scan-qty-popup-title {
      font-size:11px; font-family:var(--mono); color:var(--muted);
      margin-bottom:8px;
    }
    .scan-qty-popup-formula {
      font-size:13px; font-weight:600; color:var(--text);
      font-family:var(--mono); margin-bottom:10px;
      padding:6px 8px; background:rgba(79,142,247,0.08);
      border:1px solid rgba(79,142,247,0.2); border-radius:5px;
    }
    .scan-qty-popup-btns {
      display:flex; gap:6px;
    }
    .scan-qty-popup-btn {
      flex:1; padding:5px 8px; border-radius:5px; font-size:12px;
      font-family:var(--sans); cursor:pointer; text-align:center;
      border:1px solid var(--border); background:var(--bg);
      color:var(--text); transition:all .15s;
    }
    .scan-qty-popup-btn:hover { border-color:var(--accent); color:var(--accent); }
    .scan-qty-popup-btn.primary {
      background:rgba(79,142,247,0.12); border-color:rgba(79,142,247,0.4);
      color:var(--accent);
    }
    .scan-qty-popup-btn.primary:hover { background:rgba(79,142,247,0.22); }
  `;
  document.head.appendChild(style);
})();

// ────────────────────────────────────────────────────────────────
// 2. INJECT HTML
// ────────────────────────────────────────────────────────────────
function injectScanHTML() {
  if (document.getElementById("btnScanInvoice")) return;

  const cardTitle = Array.from(document.querySelectorAll(".card-title"))
    .find(el => el.textContent.trim() === "Informasi Pembelian");
  if (!cardTitle) return;

  const cardBody = cardTitle.closest(".card")?.querySelector(".card-body");
  if (!cardBody) return;

  const wrapper = document.createElement("div");
  wrapper.id = "scanInvoiceWrapper";
  wrapper.innerHTML = `
    <input type="file" id="scanInvoiceInput" accept="image/jpeg,image/png,image/webp,application/pdf"/>
    <button type="button" class="scan-invoice-btn" id="btnScanInvoice">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
      </svg>
      📄 Scan Invoice Otomatis
    </button>
    <div class="scan-expand-zone" id="scanExpandZone">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
        <div class="scan-ez-title">📄 Upload Invoice</div>
        <button class="scan-ez-close" id="btnCloseExpandZone" type="button">✕</button>
      </div>
      <div class="scan-ez-sub">
        Drag &amp; drop file ke area ini, atau tekan <span class="scan-ez-kbd">Ctrl+V</span> untuk paste gambar dari clipboard
      </div>
      <div class="scan-ez-actions">
        <button type="button" class="scan-ez-btn primary" id="btnEzFile">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Pilih File
        </button>
        <button type="button" class="scan-ez-btn" id="btnEzPaste">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Paste dari Clipboard
        </button>
      </div>
      <div class="scan-ez-formats">JPG · PNG · PDF · maks 10MB</div>
    </div>
    <div class="scan-preview-box" id="scanPreviewBox">
      <div class="scan-preview-name" id="scanFileName">—</div>
      <div id="scanStatusBadge"></div>
    </div>
  `;

  cardBody.insertBefore(wrapper, cardBody.firstChild);
  document.getElementById("scanInvoiceInput").addEventListener("change", handleInvoiceFile);

  const btn = document.getElementById("btnScanInvoice");
  const ez  = document.getElementById("scanExpandZone");

  function openExpandZone()  { ez.classList.add("open"); }
  function closeExpandZone() { ez.classList.remove("open"); ez.classList.remove("dragover"); }

  // ── Tombol utama: toggle expand zone ──
  btn.addEventListener("click", e => {
    e.stopPropagation();
    ez.classList.contains("open") ? closeExpandZone() : openExpandZone();
  });

  // ── Tutup expand zone ──
  document.getElementById("btnCloseExpandZone").addEventListener("click", e => {
    e.stopPropagation();
    closeExpandZone();
  });
  document.addEventListener("click", e => {
    if (!wrapper.contains(e.target)) closeExpandZone();
  });

  // ── Tombol Pilih File di expand zone ──
  document.getElementById("btnEzFile").addEventListener("click", e => {
    e.stopPropagation();
    closeExpandZone();
    triggerScanInvoice();
  });

  // ── Tombol Paste dari Clipboard ──
  document.getElementById("btnEzPaste").addEventListener("click", async e => {
    e.stopPropagation();
    const b = e.currentTarget;
    const origText = b.innerHTML;
    b.textContent = "Membaca clipboard...";
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = item.types.find(t => t.startsWith("image/"));
        if (imgType) {
          const blob = await item.getType(imgType);
          closeExpandZone();
          processScannedFile(new File([blob], "clipboard.png", { type: imgType }));
          return;
        }
      }
      b.innerHTML = origText;
      if (typeof showToast === "function") showToast("Tidak ada gambar di clipboard. Coba Ctrl+V.", "error");
    } catch {
      b.innerHTML = origText;
      if (typeof showToast === "function") showToast("Tekan Ctrl+V kapan saja untuk paste gambar.", "error");
    }
  });

  // ── Drag & Drop ke expand zone ──
  ez.addEventListener("dragover", e => {
    e.preventDefault(); e.stopPropagation();
    ez.classList.add("dragover");
  });
  ez.addEventListener("dragleave", e => {
    if (!ez.contains(e.relatedTarget)) ez.classList.remove("dragover");
  });
  ez.addEventListener("drop", e => {
    e.preventDefault(); e.stopPropagation();
    closeExpandZone();
    const file = e.dataTransfer.files?.[0];
    if (file) processScannedFile(file);
  });

  // ── Paste global Ctrl+V (aktif kapan saja selama modal review tidak terbuka) ──
  document.addEventListener("paste", e => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (document.getElementById("scanItemsOverlay")) return;
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          closeExpandZone();
          processScannedFile(file);
          return;
        }
      }
    }
  });

  // Fix layout: brand & vendor rata bawah
  const firstFieldRow = cardBody.querySelector(".field-row");
  if (firstFieldRow) firstFieldRow.style.alignItems = "end";

  // Hook onFormBrandChange: jika ada vendor dari scan, re-set setelah brand change
  const origOnFormBrandChange = window.onFormBrandChange;
  window.onFormBrandChange = function() {
    if (origOnFormBrandChange) origOnFormBrandChange.call(this);
    // Re-set vendor dari scan jika ada, karena onFormBrandChange selalu clearVendorSearch()
    const sv = window._scanVendor;
    if (sv?.id && typeof selectVendor === "function") {
      setTimeout(() => selectVendor(sv.id, sv.nama), 30);
    }
  };
}

// ────────────────────────────────────────────────────────────────
// 3. FUZZY MATCH — lebih akurat dengan bobot kata
// ────────────────────────────────────────────────────────────────

// Stopwords yang diabaikan saat scoring
const STOP = new Set(["dan","the","of","for","with","box","pcs","kg","gr","ltr","roll","pack","dus","karton","lusin"]);

function tokenize(str) {
  return (str || "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOP.has(w));
}

function fuzzyScore(a, b) {
  const wa = tokenize(a);
  const wb = tokenize(b);
  if (!wa.length || !wb.length) return 0;

  let hits = 0;
  for (const w of wa) {
    // exact token match lebih tinggi skornya
    if (wb.includes(w)) { hits += 2; continue; }
    // partial match
    if (wb.some(x => x.includes(w) || w.includes(x))) { hits += 1; }
  }
  // Normalize: hits / (jumlah token unik gabungan * 2)
  const union = new Set([...wa, ...wb]).size;
  return hits / (union * 2);
}

function findCandidates(namaInvoice, limit = 6) {
  const allBarang = window.allBarang || window.masterBarang || [];
  return allBarang
    .map(b => ({ b, score: fuzzyScore(namaInvoice, b.nama) }))
    .filter(x => x.score > 0.05) // threshold minimal
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.b);
}

// Cari vendor dari master berdasarkan nama (fuzzy)
function findVendorByName(namaVendor) {
  if (!namaVendor) return null;
  const all = window.allVendors || window.PageState?.allVendors || [];
  const q   = namaVendor.toLowerCase().trim();
  // exact dulu
  let v = all.find(x => x.nama?.toLowerCase() === q);
  if (v) return v;
  // contains
  v = all.find(x => x.nama?.toLowerCase().includes(q) || q.includes(x.nama?.toLowerCase()));
  return v || null;
}

// ────────────────────────────────────────────────────────────────
// 3b. HELPER — ambil harga terakhir dari hargaCache
// ────────────────────────────────────────────────────────────────
function getLastKnownPrice(barangId, vendorId, mode) {
  // mode: 'exc' | 'inc' — ambil harga sesuai mode PPN; default exc
  const cache = window.hargaCache;
  if (!cache) return null;

  function _pick(entry) {
    if (!entry) return null;
    if (typeof entry !== "object") return entry || null; // format lama (angka = exc)
    if (mode === "inc") return entry.inc || entry.exc || null;
    return entry.exc || entry.inc || null; // default: exc
  }

  // Prioritaskan harga dari vendor yang dipilih
  if (vendorId && cache[barangId]?.[vendorId]) {
    return _pick(cache[barangId][vendorId]);
  }

  // Fallback: cari harga dari vendor manapun
  const byBarang = cache[barangId];
  if (!byBarang) return null;
  for (const vId of Object.keys(byBarang)) {
    const price = _pick(byBarang[vId]);
    if (price) return price;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────
// 4. LOGIKA SCAN
// ────────────────────────────────────────────────────────────────
function triggerScanInvoice() {
  document.getElementById("scanInvoiceInput").click();
}

// Re-scan file yang sudah di-upload sebelumnya (tanpa buka file picker lagi)
function rescanFile() {
  if (window._scanFile) {
    handleInvoiceFileRaw(window._scanFile);
  } else {
    triggerScanInvoice();
  }
}
window.rescanFile = rescanFile;

// Entry point tunggal — dipanggil dari file picker, drag & drop, maupun paste
function processScannedFile(file) {
  if (!file) return;

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!allowedTypes.includes(file.type)) {
    if (typeof showToast === "function") showToast(`Format tidak didukung: ${file.type}. Gunakan JPG, PNG, atau PDF.`, "error");
    return;
  }

  // Buat synthetic event-like object agar bisa masuk handleInvoiceFile
  handleInvoiceFileRaw(file);
}

// handleInvoiceFile untuk input[type=file]
async function handleInvoiceFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = ""; // reset input agar file yang sama bisa di-upload lagi
  handleInvoiceFileRaw(file);
}

async function handleInvoiceFileRaw(file) {
  const previewBox = document.getElementById("scanPreviewBox");
  const fileNameEl = document.getElementById("scanFileName");
  const statusEl   = document.getElementById("scanStatusBadge");
  previewBox.classList.add("show");
  fileNameEl.textContent = file.name || "clipboard-image.png";
  statusEl.innerHTML = "";

  // Simpan file di state untuk Review Ulang (hanya di memory, tidak ke server)
  if (window._scanFileUrl) URL.revokeObjectURL(window._scanFileUrl);
  window._scanFile     = file;
  window._scanFileUrl  = URL.createObjectURL(file);
  window._scanFileType = file.type;

  if (file.size > 10 * 1024 * 1024) {
    statusEl.innerHTML = `<span class="scan-result-badge err">✕ File terlalu besar (max 10MB)</span>`;
    return;
  }

  // Set tombol ke loading state
  const btn = document.getElementById("btnScanInvoice");
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="scan-spinner"></span> Menganalisis...'; }

  // ── Tampilkan progress bar ──
  const progWrap = document.createElement("div");
  progWrap.id = "scanProgressWrap";
  progWrap.className = "scan-progress-wrap";
  progWrap.innerHTML = `
    <div class="scan-progress-label">
      <span id="scanProgLabel">Mempersiapkan...</span>
      <span id="scanProgPct" style="color:var(--accent)">0%</span>
    </div>
    <div class="scan-progress-bar-track">
      <div class="scan-progress-bar-fill" id="scanProgFill" style="width:0%"></div>
    </div>
    <div class="scan-progress-steps">
      <div class="scan-progress-step active" id="scanStep0">📤 Upload</div>
      <div class="scan-progress-step" id="scanStep1">🤖 AI Analisis</div>
      <div class="scan-progress-step" id="scanStep2">✅ Selesai</div>
    </div>
  `;
  if (previewBox) previewBox.after(progWrap);

  function updateProgress(pct, label, step) {
    const fill = document.getElementById("scanProgFill");
    const lbl  = document.getElementById("scanProgLabel");
    const pctEl= document.getElementById("scanProgPct");
    if (fill) fill.style.width = pct + "%";
    if (lbl)  lbl.textContent  = label;
    if (pctEl)pctEl.textContent = pct + "%";
    [0,1,2].forEach(i => {
      const el = document.getElementById("scanStep" + i);
      if (!el) return;
      el.className = "scan-progress-step" + (i < step ? " done" : i === step ? " active" : "");
    });
  }

  try {
    // Step 0: Upload
    updateProgress(10, "Mengunggah file...", 0);

    // Fungsi kirim satu kali — FormData dibuat baru setiap attempt agar bisa di-retry
    const sendOnce = () => new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("invoice", file); // buat fd baru setiap kali agar tidak kosong saat retry

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${SCAN_SUPABASE_URL}/functions/v1/scan-invoice`);

      const _anonKey = (typeof APP_CONFIG !== "undefined" && APP_CONFIG.supabaseKey) ? APP_CONFIG.supabaseKey : "";
      if (_anonKey) {
        xhr.setRequestHeader("apikey", _anonKey);
        xhr.setRequestHeader("Authorization", `Bearer ${_anonKey}`);
      }

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 30) + 10;
          updateProgress(pct, `Mengunggah... (${Math.round(e.loaded / 1024)}KB)`, 0);
        }
      };

      xhr.upload.onload = () => {
        updateProgress(40, "File terkirim, AI sedang menganalisis...", 1);
        let p = 40;
        const interval = setInterval(() => {
          p = Math.min(90, p + (Math.random() * 3 + 1));
          updateProgress(Math.round(p), "AI menganalisis invoice...", 1);
          if (p >= 90) clearInterval(interval);
        }, 600);
        xhr._progressInterval = interval;
      };

      xhr.onload = () => {
        if (xhr._progressInterval) clearInterval(xhr._progressInterval);
        updateProgress(95, "Memproses hasil...", 1);
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Respons tidak valid dari server"));
        }
      };

      xhr.onerror = () => {
        if (xhr._progressInterval) clearInterval(xhr._progressInterval);
        reject(new Error("Gagal terhubung ke server"));
      };

      xhr.ontimeout = () => {
        if (xhr._progressInterval) clearInterval(xhr._progressInterval);
        reject(new Error("Request timeout — coba lagi"));
      };

      xhr.send(fd);
    });

    // Auto retry untuk 503 — max 3x dengan jeda bertambah
    const MAX_RETRY = 3;
    let uploadResult = null;

    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      try {
        const result = await sendOnce();

        if (!result.success) {
          const is503 = result.error?.includes("503") || result.error?.includes("UNAVAILABLE");
          if (is503 && attempt < MAX_RETRY) {
            const wait = attempt * 3000;
            updateProgress(35, `Server sibuk, coba lagi dalam ${wait / 1000}s... (${attempt}/${MAX_RETRY})`, 1);
            await new Promise(r => setTimeout(r, wait));
            continue;
          }
          throw new Error(result.error || "Gagal memproses invoice");
        }

        uploadResult = result;
        break;

      } catch (err) {
        const is503 = err.message?.includes("503") || err.message?.includes("UNAVAILABLE");
        if (is503 && attempt < MAX_RETRY) {
          const wait = attempt * 3000;
          updateProgress(35, `Server sibuk, coba lagi dalam ${wait / 1000}s... (${attempt}/${MAX_RETRY})`, 1);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw err;
      }
    }

    if (!uploadResult) {
      throw new Error("Server masih sibuk setelah beberapa percobaan. Coba lagi nanti.");
    }

    // Step 2: Selesai
    updateProgress(100, "Selesai!", 2);
    await new Promise(r => setTimeout(r, 500)); // tahan sebentar biar user lihat 100%

    fillFormFromScan(uploadResult.data);

    const n = uploadResult.data.items?.length || 0;
    if (n === 0) {
      statusEl.innerHTML = `
        <span class="scan-result-badge err">⚠ Selesai — 0 item terdeteksi</span>
        <button class="btn-review-ulang" style="margin-left:8px" onclick="rescanFile()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-3.36"/></svg>
          Scan Ulang
        </button>
        <div style="margin-top:6px;font-size:11px;color:var(--muted);font-family:var(--mono)">
          Tidak ada item terdeteksi. Coba scan ulang atau isi barang secara manual.
        </div>`;
      const fill = document.getElementById("scanProgFill");
      if (fill) fill.style.background = "rgba(247,146,79,0.7)";
      if (typeof showToast === "function") showToast("Scan selesai — 0 item terdeteksi", "error");
    } else {
      statusEl.innerHTML = `
        <span class="scan-result-badge ok">✓ ${n} item ditemukan</span>
        <button class="btn-review-ulang" style="margin-left:8px" onclick="reviewUlangScan()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-3.36"/></svg>
          Review Ulang
        </button>`;
      if (typeof showToast === "function") showToast(`✓ ${n} item berhasil di-scan`, "success");
    }

  } catch (err) {
    console.error("[scan-invoice]", err);
    statusEl.innerHTML = `
      <span class="scan-result-badge err">✕ ${err.message}</span>
      <button class="btn-review-ulang" style="margin-left:8px" onclick="rescanFile()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-3.36"/></svg>
        Scan Ulang
      </button>`;
    if (typeof showToast === "function") showToast("Gagal scan invoice: " + err.message, "error");

  } finally {
    const _btn = document.getElementById("btnScanInvoice");
    if (_btn) {
      _btn.disabled = false;
      _btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
        📄 Scan Invoice Otomatis
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-left:auto;opacity:.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    }
    setTimeout(() => {
      document.getElementById("scanProgressWrap")?.remove();
    }, 2000);
  }
}

function fillFormFromScan(data) {
  if (data.nomor_faktur) {
    const el = document.getElementById("fNomorFaktur");
    if (el) { el.value = data.nomor_faktur; if (typeof checkDuplikatFaktur === "function") checkDuplikatFaktur(data.nomor_faktur); }
  }
  if (data.tanggal) {
    const el = document.getElementById("fTanggal");
    if (el) {
      let tanggal = data.tanggal;
      // Koreksi tahun OCR yang terlalu jauh di belakang (sering salah baca)
      const parsed = new Date(tanggal);
      const now    = new Date();
      const diffTahun = now.getFullYear() - parsed.getFullYear();
      if (!isNaN(parsed) && diffTahun > 1) {
        const corrected = new Date(parsed);
        corrected.setFullYear(now.getFullYear());
        // Jika setelah koreksi masih di masa depan, pakai tahun lalu
        if (corrected > now) corrected.setFullYear(now.getFullYear() - 1);
        const yyyy = corrected.getFullYear();
        const mm   = String(corrected.getMonth() + 1).padStart(2, "0");
        const dd   = String(corrected.getDate()).padStart(2, "0");
        const tanggalAsli = tanggal;
        tanggal = `${yyyy}-${mm}-${dd}`;
        data._tanggalAsli    = tanggalAsli;
        data._tanggalKoreksi = tanggal;
      }
      el.value = tanggal;
      data.tanggal = tanggal; // update agar modal review tampil tanggal yg sudah dikoreksi
    }
  }
  // Catatan tidak diisi otomatis dari scan
  if (data.diskon > 0) {
    const el = document.getElementById("fDiskon");
    if (el) { el.value = data.diskon; if (typeof setDiskonMode === "function") setDiskonMode("rp"); }
  }
  if (data.ongkir > 0) { const el = document.getElementById("fOngkir"); if (el) el.value = data.ongkir; }
  if (typeof updateSummary === "function") updateSummary();

  // Simpan data mentah untuk dipakai modal
  window._scanData = data;

  if (data.items?.length > 0) {
    // Gabungkan item dengan nama persis sama — jumlahkan qty, ambil harga pertama
    const merged = [];
    const seen   = {};
    for (const item of data.items) {
      const key = (item.nama || "").trim().toLowerCase();
      if (seen[key] !== undefined) {
        merged[seen[key]].qty = (merged[seen[key]].qty || 1) + (item.qty || 1);
      } else {
        seen[key] = merged.length;
        merged.push({ ...item });
      }
    }
    showScanItemsModal(merged, data.vendor, data.ppn_included);
  }
}

// ────────────────────────────────────────────────────────────────
// 5. MODAL REVIEW
// ────────────────────────────────────────────────────────────────
let _scanMappings  = {}; // { i: { barang, mode } | null }
let _scanPPNMode   = "exc"; // default exc, user bisa ganti per item

async function showScanItemsModal(items, vendorNamaDariInvoice, ppnIncluded) {
  document.getElementById("scanItemsOverlay")?.remove();
  closeScanQtyPopup();
  window._scanItems = items;
  _scanMappings     = {};
  _scanSatuanFaktor = {}; // reset faktor per item

  _scanPPNMode = (ppnIncluded === false) ? "exc" : "inc";

  // Load riwayat mapping dari Supabase (sekali, di-cache)
  await loadLearnedMappings();

  // Cari vendor — cek learned dulu, lalu fuzzy
  const learnedVendor = findLearnedVendor(vendorNamaDariInvoice);
  const vendorMatch   = learnedVendor || findVendorByName(vendorNamaDariInvoice);

  // Pre-compute mapping barang — prioritas: learned > exact > fuzzy
  items.forEach((item, i) => {
    const allBarang = window.allBarang || [];
    const nameLower = (item.nama || "").toLowerCase();

    // 1. Learned mapping (dari riwayat konfirmasi sebelumnya)
    const learned = findLearnedBarang(item.nama);
    if (learned) { _scanMappings[i] = { barang: learned, mode: "exact" }; return; }

    // 2. Exact match nama
    const exact = allBarang.find(b => b.nama?.toLowerCase() === nameLower);
    if (exact) { _scanMappings[i] = { barang: exact, mode: "exact" }; return; }

    // 3. Fuzzy match
    const candidates = findCandidates(item.nama, 6);
    _scanMappings[i] = candidates.length > 0
      ? { barang: candidates[0], mode: "fuzzy", candidates }
      : null;
  });

  // ── Vendor section ──
  const vendorBadge = vendorMatch
    ? `<span class="scan-badge vendor-ok">✓ ditemukan</span>`
    : `<span class="scan-badge vendor-no">tidak ditemukan di master</span>`;

  // Info nomor invoice dari data scan
  const nomorFakturDariScan = window._scanData?.nomor_faktur || "";
  const tanggalDariScan     = window._scanData?.tanggal      || "";

  const infoSection = (nomorFakturDariScan || tanggalDariScan) ? `
    <div style="margin-bottom:14px;padding:8px 14px;background:rgba(79,142,247,0.06);
                border:1px solid rgba(79,142,247,0.15);border-radius:8px;
                display:flex;gap:20px;flex-wrap:wrap;align-items:center">
      ${nomorFakturDariScan ? `
        <div>
          <div style="font-size:9px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">No. Faktur</div>
          <div style="font-size:13px;font-family:var(--mono);color:var(--accent);font-weight:600">${nomorFakturDariScan}</div>
        </div>` : ""}
      ${tanggalDariScan ? `
        <div>
          <div style="font-size:9px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Tanggal${window._scanData?._tanggalKoreksi ? " <span style='color:var(--accent3)'>⚠ dikoreksi</span>" : ""}</div>
          <div style="font-size:13px;font-family:var(--mono);color:var(--text)">${tanggalDariScan}${window._scanData?._tanggalAsli ? `<span style="font-size:10px;color:var(--muted);margin-left:6px">OCR: ${window._scanData._tanggalAsli}</span>` : ""}</div>
        </div>` : ""}
    </div>
    ${window._scanData?._tanggalKoreksi ? `
    <div style="margin-bottom:10px;padding:7px 12px;background:rgba(247,146,79,0.08);border:1px solid rgba(247,146,79,0.25);border-radius:6px;font-size:11px;font-family:var(--mono);color:var(--accent3)">
      ⚠ Tahun dari OCR terdeteksi tidak wajar (<span style="font-weight:600">${window._scanData._tanggalAsli}</span>). Sudah dikoreksi otomatis menjadi <span style="font-weight:600">${window._scanData._tanggalKoreksi}</span> — periksa kembali jika perlu.
    </div>` : ""}` : "";

  const vendorSection = `
    <div style="margin-bottom:14px;padding:10px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:8px">
      <div style="font-size:10px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Vendor</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:12px;font-family:var(--mono);color:var(--accent3)">${vendorNamaDariInvoice || "—"}</span>
        ${vendorBadge}
        ${vendorMatch ? `<span style="font-size:11px;color:var(--muted)">→ ${vendorMatch.nama}</span>` : ""}
      </div>
      <div class="scan-suggest-wrap" style="margin-top:8px">
        <input type="text" class="scan-suggest-input" id="scanVendorInput"
          placeholder="Cari vendor dari master..."
          value="${vendorMatch ? vendorMatch.nama : ""}"
          autocomplete="off"
          oninput="onScanVendorInput(this.value)"
          onfocus="onScanVendorFocus()"
        />
        <div class="scan-suggest-dropdown" id="scanVendorDrop"></div>
        <input type="hidden" id="scanVendorId" value="${vendorMatch ? vendorMatch.id : ""}"/>
      </div>
      <div style="font-size:11px;color:var(--muted);font-family:var(--mono);margin-top:5px">
        Vendor yang dipilih di sini akan otomatis di-set ke form saat "Tambahkan ke Form"
      </div>
    </div>
  `;

  // ── PPN global section ──
  const ppnSection = `
    <div style="margin-bottom:14px;padding:10px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:8px">
      <div style="font-size:10px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">
        Status Harga Invoice
        <span style="font-weight:400;text-transform:none;letter-spacing:0;margin-left:4px;color:var(--accent3)">(terdeteksi dari invoice — koreksi jika salah)</span>
      </div>
      <div class="scan-ppn-toggle">
        <button class="scan-ppn-btn ${_scanPPNMode === 'exc' ? 'active' : ''}" id="scanPpnExc" onclick="setScanPPN('exc')">Exc PPN</button>
        <button class="scan-ppn-btn ${_scanPPNMode === 'inc' ? 'active' : ''}" id="scanPpnInc" onclick="setScanPPN('inc')">Inc PPN 11%</button>
      </div>
    </div>
  `;

  // ── Rows barang ──
  const rows = items.map((item, i) => {
    const mapping = _scanMappings[i];
    const barang  = mapping?.barang;
    const mode    = mapping?.mode || "manual";
    const icon    = mode === "exact" ? "✅" : mode === "fuzzy" ? "🔶" : "✏️";
    const badgeCls= mode === "exact" ? "exact" : mode === "fuzzy" ? "fuzzy" : "manual";
    const badgeTxt= mode === "exact" ? "cocok" : mode === "fuzzy" ? "mirip" : "manual";

    // Ambil harga: dari OCR, atau fallback ke harga terakhir jika 0
    const vendorIdSekarang = document.getElementById("scanVendorId")?.value
      || window._scanVendor?.id
      || document.getElementById("fVendor")?.value
      || "";
    let hargaAwal = item.harga_satuan || 0;
    let hargaDariCache = false;
    if (!hargaAwal && barang) {
      const lastPrice = getLastKnownPrice(barang.id, vendorIdSekarang, _scanPPNMode);
      if (lastPrice) { hargaAwal = lastPrice; hargaDariCache = true; }
    }

    // Bangun opsi satuan: satuan dasar + satuan_order dari master
    const satuanDasar  = barang?.satuan || "";
    const satuanOrders = barang?.satuan_order || [];
    const satuanOpts   = satuanDasar
      ? [
          `<option value="${satuanDasar}|1">${satuanDasar}</option>`,
          ...satuanOrders.map(so =>
            `<option value="${so.satuan}|${so.faktor}">${so.satuan} (×${so.faktor})</option>`)
        ].join("")
      : `<option value="">—</option>`;
    // Tentukan satuan invoice (dari invoice) untuk label info
    const satuanInvoice = item.satuan || "";
    // Inisialisasi faktor awal = 1 (satuan dasar)
    _scanSatuanFaktor[i] = 1;

    return `
      <div class="scan-item-row" style="padding:10px 8px">
        <div class="scan-from-invoice" style="margin-bottom:6px">
          📄 ${item.nama || "—"} ${satuanInvoice ? `<span style="color:var(--accent3)">[${satuanInvoice}]</span>` : ""}
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:20px;flex-shrink:0;text-align:center">
            <span id="scanIcon_${i}" style="font-size:13px">${icon}</span>
          </div>
          <div style="flex:1;min-width:0" class="scan-suggest-wrap">
            <input type="text" class="scan-suggest-input" id="scanSuggest_${i}"
              placeholder="Cari barang dari master..."
              value="${barang ? barang.nama : ""}"
              autocomplete="off"
              oninput="onScanBarangInput(${i}, this.value)"
              onfocus="onScanBarangFocus(${i})"
            />
            <div class="scan-suggest-dropdown" id="scanDrop_${i}"></div>
          </div>
          <div style="width:70px;flex-shrink:0">
            <input type="number" class="scan-num-input" id="scanQty_${i}"
              value="${item.qty || 1}" min="0.001" step="any" style="width:100%;text-align:right"/>
          </div>
          <div style="width:100px;flex-shrink:0" id="scanSatuanCell_${i}">
            <select id="scanSatuan_${i}"
              onchange="onScanSatuanChange(${i}, this.value)"
              style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text);font-family:var(--mono);font-size:11px;padding:5px 4px;outline:none;cursor:pointer"
            >${satuanOpts}</select>
          </div>
          <div style="width:130px;flex-shrink:0">
            <input type="number" class="scan-num-input" id="scanHarga_${i}"
              value="${hargaAwal}" min="0" step="any"
              style="${hargaDariCache ? "border-color:rgba(247,146,79,0.5)" : ""}"/>
          </div>
          <div style="width:24px;flex-shrink:0;text-align:center">
            <input type="checkbox" id="scanChk_${i}" checked
              style="accent-color:var(--accent2);width:15px;height:15px;cursor:pointer"/>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:5px">
          <div style="width:20px;flex-shrink:0"></div>
          <div style="flex:1;min-width:0;font-size:11px">
            <span class="scan-badge ${badgeCls}" id="scanBadge_${i}">${badgeTxt}</span>
            <span style="color:var(--muted);font-family:var(--mono)" id="scanMatchLbl_${i}">
              ${barang ? `${barang.nama}${barang.satuan ? " · " + barang.satuan : ""}` : "ketik untuk cari"}
            </span>
          </div>
          <div style="width:70px;flex-shrink:0;text-align:right">
            ${satuanInvoice ? `<div class="scan-satuan-note">invoice: <span style="color:var(--accent3)">${satuanInvoice}</span></div>` : ""}
          </div>
          <div style="width:100px;flex-shrink:0"></div>
          <div style="width:130px;flex-shrink:0;text-align:right">
            <div id="scanHargaNote_${i}" class="scan-harga-note">
              ${hargaDariCache
                ? `<span style="color:var(--accent3)">dari riwayat</span>`
                : (_scanPPNMode === "inc" ? "inc PPN" : "exc PPN")}
            </div>
          </div>
          <div style="width:24px;flex-shrink:0"></div>
        </div>
      </div>
    `;
  }).join("");

  // Panel gambar invoice (hanya dari ObjectURL lokal, tidak tersimpan ke server)
  const fileUrl  = window._scanFileUrl  || "";
  const fileType = window._scanFileType || "";
  const isPDF    = fileType === "application/pdf";
  // Untuk gambar: auto-detect portrait lalu rotate ke landscape saat load
  const imgPanel = fileUrl ? `
    <div style="width:420px;min-width:300px;max-width:460px;flex-shrink:0;
                border-right:1px solid var(--border);display:flex;flex-direction:column">
      <div style="padding:8px 10px;border-bottom:1px solid var(--border);
                  font-size:11px;font-family:var(--mono);color:var(--muted);
                  display:flex;align-items:center;justify-content:space-between;gap:6px">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px">
          📄 lokal — tidak tersimpan
        </span>
        ${!isPDF ? `
        <div style="display:flex;gap:3px;flex-shrink:0;align-items:center">
          <button onclick="scanImgRotate(-1)" title="Rotate kiri"
            style="width:26px;height:26px;border-radius:5px;border:1px solid var(--border);
                   background:var(--bg);color:var(--text);cursor:pointer;font-size:13px;
                   display:flex;align-items:center;justify-content:center">↺</button>
          <span id="scanRotateLabel"
            style="font-size:10px;font-family:var(--mono);color:var(--muted);
                   min-width:28px;text-align:center">0°</span>
          <button onclick="scanImgRotate(1)" title="Rotate kanan"
            style="width:26px;height:26px;border-radius:5px;border:1px solid var(--border);
                   background:var(--bg);color:var(--text);cursor:pointer;font-size:13px;
                   display:flex;align-items:center;justify-content:center">↻</button>
          <div style="width:1px;height:16px;background:var(--border);margin:0 2px"></div>
          <button onclick="scanImgZoom(-1)"
            style="width:26px;height:26px;border-radius:5px;border:1px solid var(--border);
                   background:var(--bg);color:var(--text);cursor:pointer;font-size:16px;line-height:1;
                   display:flex;align-items:center;justify-content:center">−</button>
          <span id="scanZoomLabel"
            style="font-size:11px;font-family:var(--mono);color:var(--muted);
                   min-width:34px;text-align:center">100%</span>
          <button onclick="scanImgZoom(1)"
            style="width:26px;height:26px;border-radius:5px;border:1px solid var(--border);
                   background:var(--bg);color:var(--text);cursor:pointer;font-size:16px;line-height:1;
                   display:flex;align-items:center;justify-content:center">＋</button>
          <button onclick="scanImgReset()" title="Reset zoom & rotate"
            style="padding:0 7px;height:26px;border-radius:5px;border:1px solid var(--border);
                   background:var(--bg);color:var(--muted);cursor:pointer;font-size:10px;
                   font-family:var(--mono)">⟳</button>
        </div>` : ""}
      </div>
      <div id="scanImgContainer"
        style="flex:1;overflow:auto;background:var(--bg);position:relative;${isPDF ? "" : "cursor:grab;"}user-select:none">
        ${isPDF
          ? `<iframe src="${fileUrl}#toolbar=1&view=FitH"
               style="width:100%;height:100%;min-height:500px;border:none;display:block"
               title="Invoice PDF"></iframe>`
          : `<div id="scanImgInner" style="padding:8px;box-sizing:border-box;min-width:100%">
               <img id="scanImgEl" src="${fileUrl}"
                 style="display:block;border-radius:4px;width:100%;max-width:100%;transition:transform .2s"
                 alt="Invoice" draggable="false"
                 onload="scanImgAutoLandscape(this)"/>
             </div>`
        }
      </div>
    </div>` : "";

  const overlay = document.createElement("div");
  overlay.id = "scanItemsOverlay";
  overlay.className = "modal-overlay";
  overlay.style.cssText = "display:flex;align-items:center;justify-content:center;z-index:10000;padding:12px";
  overlay.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
                max-width:${fileUrl ? "1100px" : "740px"};width:100%;max-height:94vh;
                overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.6)">
      <!-- Header -->
      <div class="modal-header">
        <span class="modal-title">📄 Review Hasil Scan Invoice</span>
        <button class="modal-close" onclick="document.getElementById('scanItemsOverlay').remove()">✕</button>
      </div>
      <!-- Body: 2 panel -->
      <div style="display:flex;flex:1;overflow:hidden;min-height:0">
        ${imgPanel}
        <!-- Panel review -->
        <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;min-width:0">
          <div style="padding:14px 16px;flex:1;overflow-y:auto">
            ${infoSection}
            ${vendorSection}
            ${ppnSection}
            <div style="font-size:11px;color:var(--muted);font-family:var(--mono);margin-bottom:10px">
              ✅ cocok &nbsp;·&nbsp; 🔶 mirip (periksa dulu) &nbsp;·&nbsp; ✏️ tidak ditemukan (pilih manual)
            </div>
            <div>
              <!-- Header -->
              <div style="display:flex;align-items:center;padding:6px 8px;gap:8px;border-bottom:1px solid var(--border)">
                <div style="width:20px;flex-shrink:0"></div>
                <div style="flex:1;font-size:10px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:500">Barang invoice → master</div>
                <div style="width:70px;flex-shrink:0;text-align:right;font-size:10px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:500">Qty</div>
                <div style="width:100px;flex-shrink:0;text-align:right;font-size:10px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:500">Satuan</div>
                <div style="width:130px;flex-shrink:0;text-align:right;font-size:10px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:500">Harga Satuan</div>
                <div style="width:24px;flex-shrink:0;text-align:center;font-size:10px;font-family:var(--mono);color:var(--muted);font-weight:500">✓</div>
              </div>
              <!-- Rows -->
              <div id="scanItemRows">${rows}</div>
            </div>
          </div>
          <!-- Footer -->
          <div class="modal-footer" style="justify-content:space-between;align-items:center;flex-shrink:0">
            <div style="font-size:11px;color:var(--muted);font-family:var(--mono)">
              Item tidak tercentang tidak akan ditambahkan
            </div>
            <div style="display:flex;gap:8px">
              <button onclick="document.getElementById('scanItemsOverlay').remove()" class="btn btn-ghost">Batal</button>
              <button onclick="window._applyScanItems(${items.length})" class="btn btn-primary" style="min-width:160px">
                ＋ Tambahkan ke Form
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  // Reset zoom setiap buka modal baru
  _scanZoomIdx = 3;
  _scanRotate   = 0;

  // Revoke ObjectURL saat overlay dihapus (observer sederhana)
  const _obs = new MutationObserver(() => {
    if (!document.getElementById("scanItemsOverlay")) {
      // Modal sudah dihapus — biarkan URL tetap ada untuk Review Ulang
      // URL di-revoke hanya saat scan baru atau halaman ditutup
      _obs.disconnect();
    }
  });
  _obs.observe(document.body, { childList: true });

  // Tutup dropdown saat klik di luar
  overlay.addEventListener("mousedown", e => {
    if (!e.target.closest(".scan-suggest-wrap")) closeScanDropdowns();
  });

  // Pre-populate vendor jika ada kandidat fuzzy
  if (vendorMatch) {
    window._scanVendor = vendorMatch;
  } else {
    window._scanVendor = null;
  }
}

// ── PPN toggle ──
function setScanPPN(mode) {
  _scanPPNMode = mode;
  document.getElementById("scanPpnExc")?.classList.toggle("active", mode === "exc");
  document.getElementById("scanPpnInc")?.classList.toggle("active", mode === "inc");

  const items = window._scanItems || [];
  const vendorId = document.getElementById("scanVendorId")?.value
    || window._scanVendor?.id
    || document.getElementById("fVendor")?.value
    || "";

  items.forEach((item, i) => {
    // Update note harga
    const note = document.getElementById(`scanHargaNote_${i}`);

    // Jika harga input berasal dari riwayat cache, update nilainya sesuai mode baru
    const hargaInput = document.getElementById(`scanHarga_${i}`);
    if (hargaInput) {
      const ocrHarga = item.harga_satuan || 0;
      if (!ocrHarga) {
        // Harga dari OCR = 0, artinya diisi dari cache — update sesuai mode
        const barang = _scanMappings[i]?.barang;
        if (barang) {
          const newPrice = getLastKnownPrice(barang.id, vendorId, mode);
          if (newPrice) {
            hargaInput.value = newPrice;
            if (note) note.innerHTML = `<span style="color:var(--accent3)">dari riwayat</span>`;
            return;
          }
        }
      }
    }

    if (note) note.textContent = mode === "inc" ? "inc PPN — exc dihitung otomatis" : "exc PPN";
  });
}
window.setScanPPN = setScanPPN;

// ── Vendor suggest ──
function onScanVendorInput(val) {
  const all = window.allVendors || window.PageState?.allVendors || [];
  const q   = val.toLowerCase().trim();
  const res = q.length >= 1
    ? all.filter(v => v.nama?.toLowerCase().includes(q)).slice(0, 8)
    : all.slice(0, 8);
  renderVendorDropdown(res);
  window._scanVendor = null;
  document.getElementById("scanVendorId").value = "";
}
window.onScanVendorInput = onScanVendorInput;

function onScanVendorFocus() {
  const val = document.getElementById("scanVendorInput")?.value || "";
  onScanVendorInput(val);
}
window.onScanVendorFocus = onScanVendorFocus;

function renderVendorDropdown(vendors) {
  const drop  = document.getElementById("scanVendorDrop");
  const input = document.getElementById("scanVendorInput");
  if (!drop) return;
  if (!vendors.length) {
    drop.innerHTML = `<div style="padding:10px 12px;font-size:12px;color:var(--muted)">Vendor tidak ditemukan</div>`;
  } else {
    window._scanVendorList = vendors;
    drop.innerHTML = vendors.map((v, vi) => `
      <div class="scan-suggest-opt" onmousedown="selectScanVendorByIdx(${vi})">
        <div class="scan-suggest-opt-name">${v.nama}</div>
      </div>
    `).join("");
  }
  drop.classList.add("open");
  positionDropdown(drop, input);
}

function selectScanVendorByIdx(idx) {
  const v = (window._scanVendorList || [])[idx];
  if (!v) return;
  selectScanVendor(v.id, v.nama);
}
window.selectScanVendorByIdx = selectScanVendorByIdx;

function selectScanVendor(id, nama) {
  window._scanVendor = { id, nama };
  document.getElementById("scanVendorInput").value = nama;
  document.getElementById("scanVendorId").value    = id;
  closeScanDropdowns();
}
window.selectScanVendor = selectScanVendor;

// ── Barang suggest ──
function onScanBarangInput(i, val) {
  const candidates = val.trim().length >= 1
    ? findCandidates(val, 8)
    : (window.allBarang || []).slice(0, 8);
  renderBarangDropdown(i, candidates);
  _scanMappings[i] = { barang: null, mode: "manual" };
  updateScanBadge(i, null, "manual");
}
window.onScanBarangInput = onScanBarangInput;

function onScanBarangFocus(i) {
  const val = document.getElementById(`scanSuggest_${i}`)?.value || "";
  const candidates = val.trim().length >= 1
    ? findCandidates(val, 8)
    : (window.allBarang || []).slice(0, 8);
  renderBarangDropdown(i, candidates);
}
window.onScanBarangFocus = onScanBarangFocus;

function renderBarangDropdown(i, candidates) {
  const drop  = document.getElementById(`scanDrop_${i}`);
  const input = document.getElementById(`scanSuggest_${i}`);
  if (!drop) return;
  if (!candidates.length) {
    drop.innerHTML = `<div style="padding:10px 12px;font-size:12px;color:var(--muted)">Tidak ada barang ditemukan</div>`;
  } else {
    drop.innerHTML = candidates.map(b => `
      <div class="scan-suggest-opt" onmousedown="selectScanBarang(${i}, '${b.id}')">
        <div class="scan-suggest-opt-name">${b.nama}</div>
        <div class="scan-suggest-opt-sub">${[b.sku, b.satuan].filter(Boolean).join(" · ")}</div>
      </div>
    `).join("");
  }
  drop.classList.add("open");
  positionDropdown(drop, input);
}

function selectScanBarang(i, barangId) {
  const allBarang = window.allBarang || [];
  const b = allBarang.find(x => String(x.id) === String(barangId));
  if (!b) return;
  _scanMappings[i] = { barang: b, mode: "fuzzy" };
  updateScanBadge(i, b, "fuzzy");
  const input = document.getElementById(`scanSuggest_${i}`);
  if (input) input.value = b.nama;

  // Rebuild select satuan dengan opsi dari master
  const satuanCell = document.getElementById(`scanSatuanCell_${i}`);
  if (satuanCell) {
    const satuanDasar  = b.satuan || "";
    const satuanOrders = b.satuan_order || [];
    const opts = satuanDasar
      ? [
          `<option value="${satuanDasar}|1">${satuanDasar}</option>`,
          ...satuanOrders.map(so =>
            `<option value="${so.satuan}|${so.faktor}">${so.satuan} (×${so.faktor})</option>`)
        ].join("")
      : `<option value="">—</option>`;
    satuanCell.innerHTML = `
      <select id="scanSatuan_${i}"
        onchange="onScanSatuanChange(${i}, this.value)"
        style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text);font-family:var(--mono);font-size:11px;padding:5px 4px;outline:none;cursor:pointer"
      >${opts}</select>`;
  }

  closeScanDropdowns();
}
window.selectScanBarang = selectScanBarang;

// Simpan faktor satuan yang dipilih user — dipakai saat "Tambahkan ke Form"
let _scanSatuanFaktor = {}; // { i: faktor saat ini }
let _scanQtyPopup     = null; // elemen popup aktif

function closeScanQtyPopup() {
  if (_scanQtyPopup) { _scanQtyPopup.remove(); _scanQtyPopup = null; }
}

function onScanSatuanChange(i, val) {
  closeScanQtyPopup();

  const parts     = (val || "").split("|");
  const newFaktor = parseFloat(parts[1]) || 1;
  const oldFaktor = _scanSatuanFaktor[i] !== undefined ? _scanSatuanFaktor[i] : 1;

  _scanSatuanFaktor[i] = newFaktor;

  // Hanya tampilkan popup jika faktor > 1 (bukan satuan dasar)
  if (newFaktor <= 1) return;

  const qtyInput = document.getElementById(`scanQty_${i}`);
  if (!qtyInput) return;

  const qtyLama  = parseFloat(qtyInput.value) || 1;
  const qtyBaru  = qtyLama * newFaktor;
  const qtyBulat = Number.isInteger(qtyBaru) ? qtyBaru : parseFloat(qtyBaru.toFixed(4));

  // Posisi popup di bawah field qty
  const rect = qtyInput.getBoundingClientRect();

  const popup = document.createElement("div");
  popup.className = "scan-qty-popup";
  popup.style.top  = (rect.bottom + 4) + "px";
  popup.style.left = rect.left + "px";
  popup.innerHTML = `
    <div class="scan-qty-popup-title">Kalikan qty dengan ${newFaktor}?</div>
    <div class="scan-qty-popup-formula">${qtyLama} × ${newFaktor} = <span style="color:var(--accent)">${qtyBulat}</span></div>
    <div class="scan-qty-popup-btns">
      <button class="scan-qty-popup-btn primary" onmousedown="confirmScanQtyMultiply(${i}, ${qtyBulat})">Ya, jadi ${qtyBulat}</button>
      <button class="scan-qty-popup-btn" onmousedown="closeScanQtyPopup()">Tidak</button>
    </div>
  `;

  document.body.appendChild(popup);
  _scanQtyPopup = popup;

  // Tutup popup saat klik di luar
  setTimeout(() => {
    document.addEventListener("mousedown", _scanQtyPopupOutsideHandler);
  }, 0);
}
window.onScanSatuanChange = onScanSatuanChange;

function _scanQtyPopupOutsideHandler(e) {
  if (_scanQtyPopup && !_scanQtyPopup.contains(e.target)) {
    closeScanQtyPopup();
    document.removeEventListener("mousedown", _scanQtyPopupOutsideHandler);
  }
}

function confirmScanQtyMultiply(i, qtyBaru) {
  const qtyInput = document.getElementById(`scanQty_${i}`);
  if (qtyInput) qtyInput.value = qtyBaru;
  closeScanQtyPopup();
  document.removeEventListener("mousedown", _scanQtyPopupOutsideHandler);
}
window.confirmScanQtyMultiply = confirmScanQtyMultiply;
window.closeScanQtyPopup      = closeScanQtyPopup;

function updateScanBadge(i, barang, mode) {
  const badge = document.getElementById(`scanBadge_${i}`);
  const lbl   = document.getElementById(`scanMatchLbl_${i}`);
  const icon  = document.getElementById(`scanIcon_${i}`);
  if (!badge) return;
  const map = {
    exact:  { cls:"exact",  txt:"cocok",   ico:"✅" },
    fuzzy:  { cls:"fuzzy",  txt:"dipilih", ico:"🔶" },
    manual: { cls:"manual", txt:"manual",  ico:"✏️" },
  };
  const m = map[mode] || map.manual;
  badge.className   = `scan-badge ${m.cls}`;
  badge.textContent = m.txt;
  if (icon) icon.textContent = m.ico;
  if (lbl) lbl.textContent = barang
    ? `${barang.nama}${barang.satuan ? " · " + barang.satuan : ""}`
    : "ketik untuk cari";
}

function closeScanDropdowns() {
  document.querySelectorAll(".scan-suggest-dropdown").forEach(d => d.classList.remove("open"));
}

// Posisikan dropdown tepat di bawah input menggunakan koordinat fixed
function positionDropdown(dropEl, inputEl) {
  if (!dropEl || !inputEl) return;
  const rect = inputEl.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const dropH = Math.min(220, dropEl.scrollHeight || 220);

  dropEl.style.left  = rect.left + "px";
  dropEl.style.width = rect.width + "px";

  if (spaceBelow >= dropH || spaceBelow >= spaceAbove) {
    // Tampilkan di bawah
    dropEl.style.top    = (rect.bottom + 3) + "px";
    dropEl.style.bottom = "auto";
    dropEl.style.maxHeight = Math.max(spaceBelow - 12, 100) + "px";
  } else {
    // Tampilkan di atas jika ruang bawah tidak cukup
    dropEl.style.bottom = (window.innerHeight - rect.top + 3) + "px";
    dropEl.style.top    = "auto";
    dropEl.style.maxHeight = Math.max(spaceAbove - 12, 100) + "px";
  }
}

// ────────────────────────────────────────────────────────────────
// 6. APPLY KE FORM
// ────────────────────────────────────────────────────────────────
function applyScanItems(count) {
  const items    = window._scanItems || [];
  const vendor   = window._scanVendor;
  let   added    = 0;
  const notFound = [];

  // ── Set PPN mode di form dulu ──
  if (typeof setPPNInput === "function") {
    setPPNInput(_scanPPNMode);
  }

  // ── Set vendor di form ──
  if (vendor?.id && typeof selectVendor === "function") {
    selectVendor(vendor.id, vendor.nama);
    setTimeout(() => {
      const fv = document.getElementById("fVendor");
      if (fv && !fv.value && vendor?.id) selectVendor(vendor.id, vendor.nama);
    }, 50);
    // Simpan vendor mapping ke riwayat pembelajaran
    const namaVendorInvoice = window._scanData?.vendor || "";
    if (namaVendorInvoice) saveLearnedVendor(namaVendorInvoice, vendor.id);
  }

  // ── Tambahkan items ──
  for (let i = 0; i < count; i++) {
    const chk = document.getElementById(`scanChk_${i}`);
    if (!chk?.checked) continue;

    const item    = items[i];
    if (!item) continue;

    const mapping  = _scanMappings[i];
    const barang   = mapping?.barang;
    const qtyVal   = parseFloat(document.getElementById(`scanQty_${i}`)?.value)   || item.qty          || 1;
    let   hargaVal = parseFloat(document.getElementById(`scanHarga_${i}`)?.value) || item.harga_satuan || 0;
    const satuanSelectVal = document.getElementById(`scanSatuan_${i}`)?.value || ""; // format "satuan|faktor"

    // Jika harga masih 0, coba ambil dari hargaCache sesuai mode PPN
    if (!hargaVal && barang) {
      const vendorId = document.getElementById("fVendor")?.value || window._scanVendor?.id || "";
      const lastPrice = getLastKnownPrice(barang.id, vendorId, _scanPPNMode);
      if (lastPrice) hargaVal = lastPrice;
    }

    if (barang && typeof addItem === "function") {
      const idxBefore = document.querySelectorAll("#itemList .item-row").length;
      addItem(barang.id);
      const idxAfter  = document.querySelectorAll("#itemList .item-row").length;

      if (idxAfter > idxBefore) {
        const newIdx = idxAfter - 1;
        // Set satuan order terlebih dahulu (mengubah faktor)
        if (satuanSelectVal && typeof updateItemSatuan === "function") {
          updateItemSatuan(newIdx, satuanSelectVal);
          // Sync select di form item jika ada
          const rows = document.querySelectorAll("#itemList .item-row");
          if (rows[newIdx]) {
            const satuanSelect = rows[newIdx].querySelector('select[title="Satuan"]');
            if (satuanSelect) satuanSelect.value = satuanSelectVal;
          }
        }
        if (typeof updateItemQty   === "function") updateItemQty(newIdx, qtyVal);
        if (typeof updateItemHarga === "function") updateItemHarga(newIdx, hargaVal);
        const rows = document.querySelectorAll("#itemList .item-row");
        if (rows[newIdx]) {
          const qtyInput   = rows[newIdx].querySelector('input[title="Qty"]');
          const hargaInput = rows[newIdx].querySelector('input.item-input[inputmode="decimal"]:not([title="Qty"])');
          if (qtyInput)   qtyInput.value   = qtyVal;
          if (hargaInput) hargaInput.value = hargaVal;
        }

        // ── Simpan mapping ke riwayat pembelajaran ──
        const namaInvoice = (item.nama || "").trim();
        if (namaInvoice) saveLearnedMapping(namaInvoice, barang.id);
      }
      added++;
    } else {
      const manualNama = document.getElementById(`scanSuggest_${i}`)?.value?.trim();
      notFound.push(manualNama || item.nama || `Item ${i + 1}`);
    }
  }

  document.getElementById("scanItemsOverlay")?.remove();

  // Render ulang setelah semua item ditambah
  if (added > 0) {
    if (typeof renderItems    === "function") renderItems();
    if (typeof updateSummary  === "function") updateSummary();
  }

  if (typeof showToast === "function") {
    if (added > 0) showToast(`✓ ${added} item ditambahkan ke form`, "success");
    notFound.forEach(nama =>
      showToast(`⚠ "${nama}" tidak ada di master — tambah manual`, "error")
    );
  }
}

// ────────────────────────────────────────────────────────────────
// 7. INIT
// ────────────────────────────────────────────────────────────────

window._applyScanItems = function(count) {
  applyScanItems(count);
};

// ── Review Ulang: buka modal review tanpa scan ulang, isi ulang field form ──
function reviewUlangScan() {
  const data = window._scanData;
  if (!data || !data.items?.length) {
    if (typeof showToast === "function") showToast("Tidak ada data scan sebelumnya", "error");
    return;
  }
  // Isi ulang field yang mungkin sudah ter-reset
  if (data.nomor_faktur) {
    const el = document.getElementById("fNomorFaktur");
    if (el && !el.value) {
      el.value = data.nomor_faktur;
      if (typeof checkDuplikatFaktur === "function") checkDuplikatFaktur(data.nomor_faktur);
    }
  }
  if (data.tanggal) {
    const el = document.getElementById("fTanggal");
    if (el && !el.value) el.value = data.tanggal;
  }
  // Catatan tidak diisi otomatis
  if (data.diskon > 0) {
    const el = document.getElementById("fDiskon");
    if (el && (!el.value || el.value === "0")) {
      el.value = data.diskon;
      if (typeof setDiskonMode === "function") setDiskonMode("rp");
    }
  }
  if (data.ongkir > 0) {
    const el = document.getElementById("fOngkir");
    if (el && (!el.value || el.value === "0")) el.value = data.ongkir;
  }
  // Gabungkan duplikat juga saat review ulang
  const mergedItems = [];
  const seenKeys    = {};
  for (const item of data.items) {
    const key = (item.nama || "").trim().toLowerCase();
    if (seenKeys[key] !== undefined) {
      mergedItems[seenKeys[key]].qty = (mergedItems[seenKeys[key]].qty || 1) + (item.qty || 1);
    } else {
      seenKeys[key] = mergedItems.length;
      mergedItems.push({ ...item });
    }
  }
  showScanItemsModal(mergedItems, data.vendor, data.ppn_included);
}
window.reviewUlangScan = reviewUlangScan;

// ── Zoom functions untuk panel gambar ──
// Level zoom: 25, 50, 75, 100, 125, 150, 200, 300, 400%
const ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 200, 300, 400];
let _scanRotate  = 0; // 0, 90, 180, 270
let _scanZoomIdx = 3; // index ke 100%

function _applyZoom() {
  const pct = ZOOM_LEVELS[_scanZoomIdx];
  const lbl = document.getElementById("scanZoomLabel");
  if (lbl) lbl.textContent = pct + "%";
  // Delegasi ke _applyRotate agar zoom + rotate selalu konsisten
  _applyRotate();
}

function scanImgRotate(dir) {
  _scanRotate = (_scanRotate + dir * 90 + 360) % 360;
  _applyRotate();
}

function _applyRotate() {
  const img       = document.getElementById("scanImgEl");
  const inner     = document.getElementById("scanImgInner");
  const container = document.getElementById("scanImgContainer");
  if (!img || !inner) return;

  const sideways  = _scanRotate === 90 || _scanRotate === 270;
  const pct       = ZOOM_LEVELS[_scanZoomIdx] / 100;
  const natW      = img.naturalWidth  || 1;
  const natH      = img.naturalHeight || 1;

  if (sideways) {
    // Saat rotate 90/270:
    // renderW = lebar gambar sebelum rotate (mengikuti container * zoom)
    // renderH = tinggi gambar sebelum rotate (proporsional)
    // Setelah rotate: dimensi outer = renderH (lebar) x renderW (tinggi)
    const cW      = container ? (container.clientWidth - 16) : 400;
    const renderW = Math.round(cW * pct);
    const renderH = Math.round(renderW * natH / natW);

    inner.style.cssText = [
      "width:" + renderH + "px",
      "height:" + renderW + "px",
      "padding:0",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "overflow:visible",
      "box-sizing:content-box",
      "flex-shrink:0",
      "margin:8px auto"
    ].join(";") + ";";

    img.style.width          = renderW + "px";
    img.style.height         = renderH + "px";
    img.style.maxWidth        = "none";
    img.style.transformOrigin = "center center";
    img.style.transform       = "rotate(" + _scanRotate + "deg)";
    img.style.flexShrink      = "0";
    img.style.display         = "block";
  } else {
    // 0° / 180° — normal
    const cW = container ? (container.clientWidth - 16) : 400;
    inner.style.cssText = "width:100%;height:auto;padding:8px;display:block;box-sizing:border-box;margin:0;";
    img.style.width          = Math.round(cW * pct) + "px";
    img.style.height         = "auto";
    img.style.maxWidth        = "none";
    img.style.transformOrigin = "center center";
    img.style.transform       = "rotate(" + _scanRotate + "deg)";
    img.style.flexShrink      = "";
    img.style.display         = "block";
  }

  const rotLbl = document.getElementById("scanRotateLabel");
  if (rotLbl) rotLbl.textContent = _scanRotate + "°";
}

function scanImgZoom(dir) {
  _scanZoomIdx = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, _scanZoomIdx + dir));
  _applyZoom();
}

function scanImgReset() {
  _scanZoomIdx = 3;
  _scanRotate  = 0;
  _applyRotate(); // applyRotate sudah handle zoom juga
}

// Drag-to-pan
(function setupDragPan() {
  let dragging = false, startX = 0, startY = 0, scrollLeft = 0, scrollTop = 0;

  document.addEventListener("mousedown", e => {
    const c = document.getElementById("scanImgContainer");
    if (!c || !c.contains(e.target)) return;
    if (e.target.tagName === "IFRAME") return;
    dragging = true;
    startX = e.pageX - c.offsetLeft;
    startY = e.pageY - c.offsetTop;
    scrollLeft = c.scrollLeft;
    scrollTop  = c.scrollTop;
    c.style.cursor = "grabbing";
    e.preventDefault();
  });

  document.addEventListener("mousemove", e => {
    if (!dragging) return;
    const c = document.getElementById("scanImgContainer");
    if (!c) return;
    c.scrollLeft = scrollLeft - (e.pageX - c.offsetLeft - startX);
    c.scrollTop  = scrollTop  - (e.pageY - c.offsetTop  - startY);
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    const c = document.getElementById("scanImgContainer");
    if (c) c.style.cursor = "grab";
  });

  // Scroll wheel untuk zoom
  document.addEventListener("wheel", e => {
    const c = document.getElementById("scanImgContainer");
    if (!c || !c.contains(e.target)) return;
    if (e.target.tagName === "IFRAME") return;
    e.preventDefault();
    scanImgZoom(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
})();

// Auto landscape tidak dipakai (browser sudah apply EXIF, naturalWidth tidak reliable)
// Gunakan tombol rotate ↺ ↻ di toolbar
function scanImgAutoLandscape(imgEl) {
  // Tidak melakukan auto rotate — biarkan user rotate manual
  // Reset label dan state saja
  _scanRotate = 0;
  const rotLbl = document.getElementById("scanRotateLabel");
  if (rotLbl) rotLbl.textContent = "0°";
}
window.scanImgAutoLandscape = scanImgAutoLandscape;

window.scanImgZoom   = scanImgZoom;
window.scanImgReset  = scanImgReset;
window.scanImgRotate = scanImgRotate;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", injectScanHTML);
} else {
  injectScanHTML();
}
