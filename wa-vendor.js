// ═══════════════════════════════════════════════
// WA ORDER — MODE SELECTOR
// ═══════════════════════════════════════════════
function openWAModeSelector() {
  if (!_waOrderId) return;
  const o = allOrders.find(x => x.id === _waOrderId);
  if (!o) return;
  // Saat Grup Vendor OFF, mode "byGroup" tidak relevan (cuma satu grup "Semua Barang").
  // Skip mode selector — langsung manual.
  const groupByVendor = (typeof buildDetailModal !== 'undefined') && buildDetailModal._groupByVendor;
  if (!groupByVendor) {
    if (typeof openWAModal === 'function') openWAModal('byManual');
    return;
  }
  document.getElementById('waModeOrderMeta').textContent =
    `Order ${_waOrderId.substring(0,8).toUpperCase()} · ${brands[o.brand_id]||'—'}`;
  document.getElementById('modalWAMode').classList.add('show');
}

// ═══════════════════════════════════════════════
// WA ORDER — MODE 1: BY GROUP (original flow)
// ═══════════════════════════════════════════════

function _salamWaktu() {
  const h = new Date().getHours();
  if (h >= 3  && h < 11) return 'Selamat Pagi';
  if (h >= 11 && h < 15) return 'Selamat Siang';
  if (h >= 15 && h < 18) return 'Selamat Sore';
  return 'Selamat Malam';
}

function _toWaNum(telp) {
  if (!telp) return '';
  return telp.replace(/\D/g, '').replace(/^0/, '62');
}

async function openWAModal(mode) {
  // Jika dipanggil dari mode selector, tutup selector dulu
  if (mode) closeModal('modalWAMode');

  if (!_waOrderId) return;
  const o = allOrders.find(x => x.id === _waOrderId);
  if (!o) return;

  // Mode 2 — buka modal manual
  if (mode === 'byManual') {
    await _openWAManualModal();
    return;
  }

  // Mode 1 — flow lama
  // Jika dibuka dari mode selector (bukan shortcut openWAForVendor), reset preferred vendor
  if (mode === 'byGroup') window._waPreferredVendorId = null;
  document.getElementById('waMsgPreview').value = '';
  document.getElementById('waNoHp').style.display = 'none';
  document.getElementById('btnCopyWA').style.display = 'none';
  document.getElementById('btnOpenWA').style.display = 'none';
  document.getElementById('waHint').textContent = '⏳ Memuat items...';
  document.getElementById('waVendorMeta').textContent =
    `Order ${_waOrderId.substring(0,8).toUpperCase()} · ${brands[o.brand_id]||'—'}`;
  document.getElementById('waVendorSelect').innerHTML = '<option value="">— Pilih Vendor —</option>';
  document.getElementById('modalWA').classList.add('show');

  // 1. Fetch semua items order yang QTY-nya belum terpenuhi
  try {
    const { data, error } = await _sb.from('order_items')
      .select('barang_id,nama_barang,qty_order,satuan,satuan_db,faktor_konversi,harga_estimasi,qty_terpenuhi,is_custom')
      .eq('order_id', _waOrderId);
    if (error) throw error;

    _waOrderItems = (data || []).filter(it => {
      if (it.is_custom) return false;
      const f = it.faktor_konversi || 1;
      const hasFaktor = it.satuan_db && f > 1 && it.satuan !== it.satuan_db;
      const sisa = it.qty_order - (hasFaktor ? (it.qty_terpenuhi / f) : (it.qty_terpenuhi || 0));
      return sisa > 0;
    });
  } catch(e) {
    console.error('fetch order_items for WA:', e);
    _waOrderItems = [];
  }

  if (!_waOrderItems.length) {
    document.getElementById('waHint').textContent = '✓ Semua item sudah terpenuhi';
    return;
  }

  await _populateWAVendorData();
}

// Shared: fetch histori & populate dropdown (dipakai kedua mode)
async function _fetchWAHistori() {
  const barangIds = _waOrderItems.map(it => it.barang_id).filter(Boolean);
  let vendorPerBarang     = {};
  let bestVendorPerBarang = {};

  // Ambil brand_id order aktif — untuk memprioritaskan riwayat harga yang brand-nya cocok
  const _activeOrder  = allOrders.find(x => x.id === _waOrderId);
  const _orderBrandId = _activeOrder?.brand_id || null;

  if (barangIds.length > 0) {
    try {
      const cutoff1M = new Date(); cutoff1M.setMonth(cutoff1M.getMonth() - 1);
      const cutoffISO = cutoff1M.toISOString().split('T')[0];
      const _hRowsRaw = await _inBatch('riwayat_harga', 'barang_id,vendor_id,harga,tanggal,brand_id', 'barang_id', barangIds);
      const _result   = _calcBestVendorPerBarang(_hRowsRaw, cutoffISO, _orderBrandId);
      vendorPerBarang     = _result.vendorPerBarang;
      bestVendorPerBarang = _result.bestVendorPerBarang;
    } catch(e) { console.warn('riwayat_harga lookup failed:', e); }
  }

  // Build vendorItemsMap (dedup)
  const vendorItemsMap = {};
  _waOrderItems.forEach(it => {
    const bestVid = it.barang_id ? bestVendorPerBarang[it.barang_id] : null;
    if (bestVid) {
      if (!vendorItemsMap[bestVid]) vendorItemsMap[bestVid] = [];
      vendorItemsMap[bestVid].push(it);
    }
  });

  return { vendorPerBarang, bestVendorPerBarang, vendorItemsMap };
}

async function _populateWAVendorData() {
  const { vendorPerBarang, bestVendorPerBarang, vendorItemsMap } = await _fetchWAHistori();

  // vendorItemsMap tetap dipakai untuk generate pesan (best vendor per barang)
  const vendorCount = {};
  Object.entries(vendorItemsMap).forEach(([vid, its]) => { vendorCount[vid] = its.length; });

  const prefId = window._waPreferredVendorId || null;

  // Tentukan scope barang untuk filter "Vendor barang ini":
  // - Jika dibuka dari tombol WA Vendor grup tertentu → hanya barang di grup vendor itu
  // - Jika dibuka dari "Order via WA" umum → semua barang di order
  let scopeBarangIds;
  if (prefId && vendorItemsMap[prefId] && vendorItemsMap[prefId].length > 0) {
    // Scope = barang-barang yang jadi best vendor untuk vendor yang dipilih
    scopeBarangIds = new Set(vendorItemsMap[prefId].map(it => it.barang_id).filter(Boolean));
  } else {
    // Scope = semua barang di order
    scopeBarangIds = new Set(_waOrderItems.map(it => it.barang_id).filter(Boolean));
  }

  // vendorHasBarang: vendor yang pernah jual salah satu barang dalam scope
  const vendorHasBarang = new Set();
  const vendorBarangCount = {};
  Object.entries(vendorPerBarang).forEach(([barangId, vSet]) => {
    if (!scopeBarangIds.has(barangId)) return; // hanya hitung barang dalam scope
    vSet.forEach(vid => {
      vendorHasBarang.add(vid);
      vendorBarangCount[vid] = (vendorBarangCount[vid] || 0) + 1;
    });
  });

  // Sort: preferred vendor paling atas, lalu by jumlah barang dalam scope desc
  const withHist  = vendors.filter(v => vendorHasBarang.has(v.id))
                           .sort((a, b) => {
                             if (a.id === prefId) return -1;
                             if (b.id === prefId) return 1;
                             return (vendorBarangCount[b.id]||0) - (vendorBarangCount[a.id]||0);
                           });
  const otherVend = vendors.filter(v => !vendorHasBarang.has(v.id))
                           .sort((a, b) => {
                             if (a.id === prefId) return -1;
                             if (b.id === prefId) return 1;
                             return 0;
                           });

  const sel = document.getElementById('waVendorSelect');
  sel._vendorPerBarang     = vendorPerBarang;
  sel._vendorItemsMap      = vendorItemsMap;
  sel._bestVendorPerBarang = bestVendorPerBarang;

  let html = '<option value="">— Pilih Vendor —</option>';
  if (withHist.length) {
    html += `<optgroup label="── Vendor barang ini (${withHist.length} vendor)">`;
    withHist.forEach(v => {
      const n = vendorBarangCount[v.id] || 0;
      const isBest = vendorCount[v.id] > 0;
      const bestLabel = isBest ? ` ✦ best` : '';
      html += `<option value="${v.id}">${v.nama}${bestLabel}${v.telp ? ' 📱' : ''}</option>`;
    });
    html += '</optgroup>';
  }
  if (otherVend.length) {
    html += `<optgroup label="── Vendor lainnya">`;
    otherVend.forEach(v => {
      html += `<option value="${v.id}">${v.nama}${v.telp ? ' 📱' : ''}</option>`;
    });
    html += '</optgroup>';
  }
  sel.innerHTML = html;

  document.getElementById('waHint').textContent =
    `${_waOrderItems.length} item belum terpenuhi · Pilih vendor untuk generate pesan`;
}

// Shortcut: buka WA modal dengan vendor sudah dipilih
async function openWAForVendor(vendorId, orderId) {
  if (_waOrderId !== orderId) _waOrderId = orderId;
  // Set preferred vendor SEBELUM openWAModal — agar sorting dropdown menempatkannya di atas.
  // Panggil dengan mode=null agar tidak di-reset oleh openWAModal.
  window._waPreferredVendorId = vendorId || null;
  await openWAModal(null);
  const sel = document.getElementById('waVendorSelect');
  if (sel && vendorId) {
    sel.value = vendorId;
    onWAVendorChange();
  }
}

// ── HELPER: render kontak WA (1 = teks langsung, >1 = dropdown) ──
function _renderWAKontakUI(wrapId, valId, selectId, btnOpenId, kontakList) {
  const wrapEl  = document.getElementById(wrapId);
  const valEl   = document.getElementById(valId);
  const selEl   = document.getElementById(selectId);
  const btnOpen = document.getElementById(btnOpenId);
  if (!kontakList || kontakList.length === 0) {
    wrapEl.style.display = 'none';
    if (btnOpen) btnOpen.style.display = 'none';
    return;
  }
  wrapEl.style.display = 'block';
  if (kontakList.length === 1) {
    const k = kontakList[0];
    const label = [k.nama, k.jabatan ? `(${k.jabatan})` : '', k.telp].filter(Boolean).join(' ');
    valEl.textContent   = label;
    valEl.style.display = 'block';
    selEl.style.display = 'none';
  } else {
    valEl.style.display = 'none';
    selEl.style.display = 'block';
    selEl.innerHTML = kontakList.map((k, i) => {
      const label = k.jabatan ? `${k.nama} (${k.jabatan}) — ${k.telp}` : `${k.nama} — ${k.telp}`;
      return `<option value="${k.telp}"${i===0?' selected':''}>${label}</option>`;
    }).join('');
  }
  if (btnOpen) btnOpen.style.display = '';
}

function _getSelectedKontak(selectId, vendor) {
  const selEl = document.getElementById(selectId);
  if (selEl && selEl.style.display !== 'none' && selEl.value) return selEl.value;
  // Kasus 1 kontak: ambil dari kontak_list[0] dulu, fallback ke telp utama
  const kontakList = vendor?.kontak_list || [];
  return kontakList.length > 0 ? kontakList[0].telp : (vendor?.telp || '');
}

function onWAKontakChange(selectId, valId, btnOpenId) {
  if (selectId === 'waManualKontakSelect') _renderWAManualPreview();
  if (selectId === 'waKontakSelect') {
    // Ganti kontak → render checklist sesuai state kontak baru, lalu update preview
    _renderWAItemKontakList();
    _renderWAGroupPreview();
  }
}

// _waKontakCheckMap: { kontakTelp: Set(itemIdx) } — state checklist per kontak
// Inisialisasi saat vendor dipilih: tiap kontak default checklist = semua item

// ── PREFERENSI KONTAK PER BARANG ──
// Simpan mapping { barang_id: kontak_telp } per vendor di localStorage.
// Sistem belajar dari toggle user — kontak terakhir yang "pakai" item = pemilik default.
function _waKontakPrefKey(vendorId) { return `waKontakPref:${vendorId}`; }
function _loadWAKontakPref(vendorId) {
  try {
    const raw = localStorage.getItem(_waKontakPrefKey(vendorId));
    return raw ? JSON.parse(raw) : {};
  } catch(e) { return {}; }
}
function _saveWAKontakPref(vendorId, pref) {
  try { localStorage.setItem(_waKontakPrefKey(vendorId), JSON.stringify(pref)); } catch(e) {}
}
// Build default Set per-kontak berdasarkan preferensi tersimpan.
// Item dengan barang_id yang ke-pref ke kontak X → masuk Set kontak X saja.
// Item tanpa pref (atau pref ke kontak yang sudah dihapus) → default ke kontak[0].
function _buildKontakCheckMapFromPref(vendorId, kontakList, items) {
  const pref = _loadWAKontakPref(vendorId);
  const validTelps = new Set(kontakList.map(k => k.telp));
  const map = {};
  kontakList.forEach(k => { map[k.telp] = new Set(); });
  const defaultTelp = kontakList[0]?.telp;
  items.forEach((it, i) => {
    const bid = it.barang_id;
    const owned = bid && pref[bid];
    if (owned && validTelps.has(owned)) {
      map[owned].add(i);
    } else if (defaultTelp) {
      map[defaultTelp].add(i);
    }
  });
  return map;
}

function _renderWAItemKontakList() {
  const listEl = document.getElementById('waItemKontakList');
  if (!listEl) return;

  const sel          = document.getElementById('waVendorSelect');
  const vendorId     = sel.value;
  const vendorItemsMap = sel._vendorItemsMap || {};
  const assignedItems  = vendorItemsMap[vendorId];
  const itemsUntukVendor = (assignedItems && assignedItems.length > 0) ? assignedItems : _waOrderItems;

  const vendor       = vendors.find(v => v.id === vendorId);
  const kontakList   = vendor?.kontak_list || [];
  const selectedTelp = document.getElementById('waKontakSelect')?.value || kontakList[0]?.telp || '';
  const checkedSet   = window._waKontakCheckMap?.[selectedTelp] || new Set();

  listEl.innerHTML = itemsUntukVendor.map((it, i) => {
    const f = it.faktor_konversi || 1;
    const hasFaktor = it.satuan_db && f > 1 && it.satuan !== it.satuan_db;
    const sisa = Math.max(0, hasFaktor
      ? it.qty_order - (it.qty_terpenuhi / f)
      : it.qty_order - (it.qty_terpenuhi || 0));
    const qtyLabel = `${sisa % 1 === 0 ? sisa : sisa.toFixed(2)} ${it.satuan||''}`.trim();
    const checked = checkedSet.has(i);
    return `<label style="display:flex;align-items:center;gap:12px;padding:10px 14px;cursor:pointer;border-bottom:1px solid rgba(37,40,48,0.35);${i===itemsUntukVendor.length-1?'border-bottom:none':''}" onmouseover="this.style.background='rgba(79,142,247,0.04)'" onmouseout="this.style.background='transparent'">
      <input type="checkbox" data-item-idx="${i}" ${checked?'checked':''} onchange="onWAGroupItemToggle()" style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0"/>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${it.nama_barang}</div>
        <div style="font-size:11px;font-family:var(--mono);color:var(--muted);margin-top:2px">${qtyLabel}</div>
      </div>
    </label>`;
  }).join('');
}

function onWAGroupItemToggle() {
  const sel          = document.getElementById('waVendorSelect');
  const vendorId     = sel.value;
  const vendor       = vendors.find(v => v.id === vendorId);
  const kontakList   = vendor?.kontak_list || [];
  const selectedTelp = document.getElementById('waKontakSelect')?.value || kontakList[0]?.telp || '';

  if (!window._waKontakCheckMap) window._waKontakCheckMap = {};
  if (!window._waKontakCheckMap[selectedTelp]) window._waKontakCheckMap[selectedTelp] = new Set();

  const vendorItemsMap   = sel._vendorItemsMap || {};
  const assignedItems    = vendorItemsMap[vendorId];
  const itemsUntukVendor = (assignedItems && assignedItems.length > 0) ? assignedItems : _waOrderItems;

  const checkboxes = document.querySelectorAll('#waItemKontakList input[type=checkbox]');
  const newSet = new Set();
  checkboxes.forEach(cb => { if (cb.checked) newSet.add(parseInt(cb.dataset.itemIdx)); });
  window._waKontakCheckMap[selectedTelp] = newSet;

  // Persist preferensi: tiap item yang baru di-check ke kontak X → assign owner = X.telp.
  // Tiap item yang di-uncheck dari kontak X dan sebelumnya owned X → clear assignment.
  const pref = _loadWAKontakPref(vendorId);
  itemsUntukVendor.forEach((it, i) => {
    const bid = it.barang_id;
    if (!bid) return;
    if (newSet.has(i)) {
      pref[bid] = selectedTelp;
    } else if (pref[bid] === selectedTelp) {
      delete pref[bid];
    }
  });
  _saveWAKontakPref(vendorId, pref);

  // Refresh checklist semua kontak agar reflektif (item yang dipindah owner-nya hilang dari kontak lain)
  const newMap = _buildKontakCheckMapFromPref(vendorId, kontakList, itemsUntukVendor);
  // Pertahankan kontak yang baru saja di-toggle agar UI tidak loncat
  newMap[selectedTelp] = newSet;
  window._waKontakCheckMap = newMap;

  _renderWAGroupPreview();
}

function waGroupCheckAll(val) {
  const sel          = document.getElementById('waVendorSelect');
  const vendorId     = sel.value;
  const vendorItemsMap = sel._vendorItemsMap || {};
  const assignedItems  = vendorItemsMap[vendorId];
  const itemsUntukVendor = (assignedItems && assignedItems.length > 0) ? assignedItems : _waOrderItems;
  const vendor       = vendors.find(v => v.id === vendorId);
  const kontakList   = vendor?.kontak_list || [];
  const selectedTelp = document.getElementById('waKontakSelect')?.value || kontakList[0]?.telp || '';

  if (!window._waKontakCheckMap) window._waKontakCheckMap = {};
  window._waKontakCheckMap[selectedTelp] = val
    ? new Set(itemsUntukVendor.map((_, i) => i))
    : new Set();

  _renderWAItemKontakList();
  _renderWAGroupPreview();
}

function _renderWAGroupPreview() {
  const sel          = document.getElementById('waVendorSelect');
  const vendorId     = sel.value;
  const vendorItemsMap = sel._vendorItemsMap || {};
  const assignedItems  = vendorItemsMap[vendorId];
  const itemsUntukVendor = (assignedItems && assignedItems.length > 0) ? assignedItems : _waOrderItems;
  const vendor       = vendors.find(v => v.id === vendorId);
  const kontakList   = vendor?.kontak_list || [];
  const isMulti      = kontakList.length > 1;
  const selectedTelp = document.getElementById('waKontakSelect')?.value || kontakList[0]?.telp || '';
  const o            = allOrders.find(x => x.id === _waOrderId);
  const brand        = brands[o?.brand_id] || '—';
  const salam        = _salamWaktu();

  let itemsUntukPreview;
  if (isMulti && window._waKontakCheckMap?.[selectedTelp]) {
    const checkedSet = window._waKontakCheckMap[selectedTelp];
    itemsUntukPreview = itemsUntukVendor.filter((_, i) => checkedSet.has(i));
  } else {
    itemsUntukPreview = itemsUntukVendor;
  }

  if (!itemsUntukPreview.length) {
    document.getElementById('waMsgPreview').value = isMulti
      ? '(Tidak ada item yang dipilih untuk kontak ini)'
      : '';
    return;
  }

  let msg = `${salam},\n\nKami ingin memesan barang berikut:\n`;
  itemsUntukPreview.forEach((it, i) => {
    const f = it.faktor_konversi || 1;
    const hasFaktor = it.satuan_db && f > 1 && it.satuan !== it.satuan_db;
    const sisa = Math.max(0, hasFaktor
      ? it.qty_order - (it.qty_terpenuhi / f)
      : it.qty_order - (it.qty_terpenuhi || 0));
    const qtyLabel = `${sisa % 1 === 0 ? sisa : sisa.toFixed(2)} ${it.satuan||''}`.trim();
    msg += `${i+1}. *${it.nama_barang}* — ${qtyLabel}\n`;
  });
  msg += `Dikirim ke *${brand}*\nTerima kasih`;
  document.getElementById('waMsgPreview').value = msg;
}

function onWAVendorChange() {
  const vendorId = document.getElementById('waVendorSelect').value;
  const sel      = document.getElementById('waVendorSelect');
  const vendorItemsMap = sel._vendorItemsMap || {};

  if (!vendorId) {
    document.getElementById('waMsgPreview').value = '';
    document.getElementById('waNoHp').style.display = 'none';
    document.getElementById('waItemKontakWrap').style.display = 'none';
    document.getElementById('btnCopyWA').style.display = 'none';
    document.getElementById('btnOpenWA').style.display = 'none';
    document.getElementById('waHint').textContent = 'Pilih vendor untuk generate pesan';
    return;
  }

  const vendor     = vendors.find(v => v.id === vendorId);
  const kontakList = vendor?.kontak_list || [];
  const noHp       = kontakList.length > 0 ? kontakList[0].telp : (vendor?.telp || '');
  const isMulti    = kontakList.length > 1;

  _renderWAKontakUI('waNoHp', 'waNoHpVal', 'waKontakSelect', 'btnOpenWA', kontakList);

  // Reset checklist map untuk vendor baru — default semua item ter-check di tiap kontak
  const assignedItems    = vendorItemsMap[vendorId];
  const itemsUntukVendor = (assignedItems && assignedItems.length > 0) ? assignedItems : _waOrderItems;
  const hasHist          = !!(assignedItems && assignedItems.length > 0);

  // Build default checklist per-kontak dari preferensi localStorage.
  // Item yang sebelumnya di-toggle ke kontak X otomatis masuk ke kontak X saja.
  window._waKontakCheckMap = {};
  if (isMulti) {
    window._waKontakCheckMap = _buildKontakCheckMapFromPref(vendorId, kontakList, itemsUntukVendor);
  }

  // Tampilkan/sembunyikan checklist section
  const wrapEl = document.getElementById('waItemKontakWrap');
  if (isMulti && itemsUntukVendor.length > 0) {
    wrapEl.style.display = 'block';
    _renderWAItemKontakList();
  } else {
    wrapEl.style.display = 'none';
  }

  _renderWAGroupPreview();

  document.getElementById('btnCopyWA').style.display = '';
  document.getElementById('waHint').textContent =
    `${itemsUntukVendor.length} item${hasHist ? ' (berdasarkan histori vendor)' : ' (belum ada histori vendor)'}` +
    (noHp ? ' · Siap kirim via WA' : ' · Tidak ada nomor WA, salin manual');
}

function copyWAMsg() {
  const msg = document.getElementById('waMsgPreview').value;
  if (!msg) return;
  navigator.clipboard.writeText(msg).then(() => showToast('success', '✓ Pesan disalin'));
}

function openWA() {
  const vendorId = document.getElementById('waVendorSelect').value;
  const vendor   = vendors.find(v => v.id === vendorId);
  const noHp     = _getSelectedKontak('waKontakSelect', vendor);
  if (!noHp) { showToast('error', '✕ Nomor telepon vendor tidak ada'); return; }
  const msg = document.getElementById('waMsgPreview').value;
  if (!msg) { showToast('error', '✕ Pilih vendor dan generate pesan dulu'); return; }
  const num = _toWaNum(noHp);
  if (!num) { showToast('error', '✕ Format nomor tidak valid'); return; }
  window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
}

// ═══════════════════════════════════════════════
// WA ORDER — MODE 2: MANUAL ITEM PICKER
// ═══════════════════════════════════════════════
// _waManualVendorItemsMap dikelola via PageState.waManualVendorItemsMap

async function _openWAManualModal() {
  if (!_waOrderId) return;
  const o = allOrders.find(x => x.id === _waOrderId);
  if (!o) return;

  // Reset UI
  document.getElementById('waManualVendorSelect').innerHTML = '<option value="">— Pilih Vendor —</option>';
  document.getElementById('waManualItemsWrap').style.display = 'none';
  document.getElementById('waManualNoHp').style.display = 'none';
  document.getElementById('btnCopyWAManual').style.display = 'none';
  document.getElementById('btnOpenWAManual').style.display = 'none';
  document.getElementById('waManualFooterHint').textContent = '⏳ Memuat data...';
  document.getElementById('waManualMeta').textContent =
    `Order ${_waOrderId.substring(0,8).toUpperCase()} · ${brands[o.brand_id]||'—'}`;
  document.getElementById('modalWAManual').classList.add('show');

  // Fetch items belum terpenuhi (reuse _waOrderItems jika sudah ada, kalau belum fetch)
  if (!_waOrderItems || !_waOrderItems.length) {
    try {
      const { data, error } = await _sb.from('order_items')
        .select('barang_id,nama_barang,qty_order,satuan,satuan_db,faktor_konversi,harga_estimasi,qty_terpenuhi,is_custom')
        .eq('order_id', _waOrderId);
      if (error) throw error;
      _waOrderItems = (data || []).filter(it => {
        if (it.is_custom) return false;
        const f = it.faktor_konversi || 1;
        const hasFaktor = it.satuan_db && f > 1 && it.satuan !== it.satuan_db;
        const sisa = it.qty_order - (hasFaktor ? (it.qty_terpenuhi / f) : (it.qty_terpenuhi || 0));
        return sisa > 0;
      });
    } catch(e) {
      _waOrderItems = [];
    }
  }

  if (!_waOrderItems.length) {
    document.getElementById('waManualFooterHint').textContent = '✓ Semua item sudah terpenuhi';
    return;
  }

  // Fetch histori untuk auto-checklist
  const { vendorItemsMap } = await _fetchWAHistori();
  _waManualVendorItemsMap = vendorItemsMap;

  // Populate vendor dropdown — semua vendor, vendor dgn histori di atas
  const vendorCount = {};
  Object.entries(vendorItemsMap).forEach(([vid, its]) => { vendorCount[vid] = its.length; });

  const withHist  = vendors.filter(v => vendorCount[v.id] > 0)
                           .sort((a,b) => (vendorCount[b.id]||0) - (vendorCount[a.id]||0));
  const otherVend = vendors.filter(v => !vendorCount[v.id]);

  const sel = document.getElementById('waManualVendorSelect');
  let htmlM = '<option value="">— Pilih Vendor —</option>';
  if (withHist.length) {
    htmlM += `<optgroup label="── Ada histori (${withHist.length})">`;
    withHist.forEach(v => {
      htmlM += `<option value="${v.id}">${v.nama} — ${vendorCount[v.id]} item${v.telp?' 📱':''}</option>`;
    });
    htmlM += '</optgroup>';
  }
  if (otherVend.length) {
    htmlM += `<optgroup label="── Vendor lainnya">`;
    otherVend.forEach(v => {
      htmlM += `<option value="${v.id}">${v.nama}${v.telp?' 📱':''}</option>`;
    });
    htmlM += '</optgroup>';
  }
  sel.innerHTML = htmlM;

  document.getElementById('waManualFooterHint').textContent =
    `${_waOrderItems.length} item belum terpenuhi · Pilih vendor untuk melanjutkan`;
}

function onWAManualVendorChange() {
  const vendorId = document.getElementById('waManualVendorSelect').value;
  if (!vendorId) {
    document.getElementById('waManualItemsWrap').style.display = 'none';
    document.getElementById('waManualNoHp').style.display = 'none';
    document.getElementById('btnCopyWAManual').style.display = 'none';
    document.getElementById('btnOpenWAManual').style.display = 'none';
    document.getElementById('waManualFooterHint').textContent = 'Pilih vendor untuk melanjutkan';
    return;
  }

  const vendor = vendors.find(v => v.id === vendorId);
  const kontakList = vendor?.kontak_list || [];
  const noHp   = kontakList.length > 0 ? kontakList[0].telp : (vendor?.telp || '');

  _renderWAKontakUI('waManualNoHp', 'waManualNoHpVal', 'waManualKontakSelect', 'btnOpenWAManual', kontakList);

  // Set checklist items dari histori vendor ini
  const autoChecked = new Set(
    (_waManualVendorItemsMap[vendorId] || []).map(it => it.barang_id)
  );

  // Render item list
  const listEl = document.getElementById('waManualItemList');
  listEl.innerHTML = _waOrderItems.map((it, i) => {
    const checked = autoChecked.has(it.barang_id);
    const f = it.faktor_konversi || 1;
    const hasFaktor = it.satuan_db && f > 1 && it.satuan !== it.satuan_db;
    const sisa = Math.max(0,
      hasFaktor
        ? it.qty_order - (it.qty_terpenuhi / f)
        : it.qty_order - (it.qty_terpenuhi || 0)
    );
    const qtyLabel = `${sisa % 1 === 0 ? sisa : sisa.toFixed(2)} ${it.satuan||''}`.trim();
    const isFromHistori = checked;
    return `<label style="display:flex;align-items:center;gap:12px;padding:10px 14px;cursor:pointer;border-bottom:1px solid rgba(37,40,48,0.35);transition:background .15s;${i===_waOrderItems.length-1?'border-bottom:none':''}" onmouseover="this.style.background='rgba(79,142,247,0.04)'" onmouseout="this.style.background='transparent'">
      <input type="checkbox" data-idx="${i}" ${checked?'checked':''} onchange="onWAManualItemToggle()" style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0"/>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${it.nama_barang}</div>
        <div style="font-size:11px;font-family:var(--mono);color:var(--muted);margin-top:2px">${qtyLabel}</div>
      </div>
      ${isFromHistori ? '<span style="font-size:10px;font-family:var(--mono);background:rgba(79,142,247,0.12);color:var(--accent);border:1px solid rgba(79,142,247,0.2);border-radius:4px;padding:2px 6px;flex-shrink:0">histori</span>' : ''}
    </label>`;
  }).join('');

  document.getElementById('waManualItemsWrap').style.display = 'block';

  // Hint
  const histCount = autoChecked.size;
  const hintEl = document.getElementById('waManualHint');
  if (histCount > 0) {
    hintEl.style.display = 'block';
    hintEl.textContent = `✓ ${histCount} item otomatis terchecklist berdasarkan histori vendor ini. Tambahkan item lain sesuai kebutuhan.`;
  } else {
    hintEl.style.display = 'none';
  }

  _renderWAManualPreview();
}

function onWAManualItemToggle() {
  _renderWAManualPreview();
}

function waManualCheckAll(val) {
  document.querySelectorAll('#waManualItemList input[type=checkbox]').forEach(cb => { cb.checked = val; });
  _renderWAManualPreview();
}

function _renderWAManualPreview() {
  const checkboxes = document.querySelectorAll('#waManualItemList input[type=checkbox]');
  const selectedItems = [];
  checkboxes.forEach((cb, idx) => {
    if (cb.checked && _waOrderItems[idx]) selectedItems.push(_waOrderItems[idx]);
  });

  const vendorId = document.getElementById('waManualVendorSelect').value;
  const vendor = vendors.find(v => v.id === vendorId);
  const noHp   = _getSelectedKontak('waManualKontakSelect', vendor);
  const o      = allOrders.find(x => x.id === _waOrderId);
  const brand  = brands[o?.brand_id] || '—';
  const salam  = _salamWaktu();

  if (!selectedItems.length) {
    document.getElementById('waManualPreview').value = '';
    document.getElementById('btnCopyWAManual').style.display = 'none';
    document.getElementById('btnOpenWAManual').style.display = 'none';
    document.getElementById('waManualFooterHint').textContent = 'Pilih minimal 1 item untuk generate pesan';
    return;
  }

  let msg = `${salam},\n\n`;
  msg += `Kami ingin memesan barang berikut:\n`;
  selectedItems.forEach((it, i) => {
    const f = it.faktor_konversi || 1;
    const hasFaktor = it.satuan_db && f > 1 && it.satuan !== it.satuan_db;
    const sisa = Math.max(0,
      hasFaktor
        ? it.qty_order - (it.qty_terpenuhi / f)
        : it.qty_order - (it.qty_terpenuhi || 0)
    );
    const qtyLabel = `${sisa % 1 === 0 ? sisa : sisa.toFixed(2)} ${it.satuan||''}`.trim();
    msg += `${i+1}. *${it.nama_barang}* — ${qtyLabel}\n`;
  });
  msg += `Dikirim ke *${brand}*\n`;
  msg += `Terima kasih`;

  document.getElementById('waManualPreview').value = msg;
  document.getElementById('btnCopyWAManual').style.display = '';
  if (noHp) document.getElementById('btnOpenWAManual').style.display = '';
  else document.getElementById('btnOpenWAManual').style.display = 'none';

  document.getElementById('waManualFooterHint').textContent =
    `${selectedItems.length} item dipilih` + (noHp ? ' · Siap kirim via WA' : ' · Tidak ada nomor WA, salin manual');
}

function copyWAManualMsg() {
  const msg = document.getElementById('waManualPreview').value;
  if (!msg) return;
  navigator.clipboard.writeText(msg).then(() => showToast('success', '✓ Pesan disalin'));
}

function openWAManual() {
  const vendorId = document.getElementById('waManualVendorSelect').value;
  const vendor   = vendors.find(v => v.id === vendorId);
  const noHp     = _getSelectedKontak('waManualKontakSelect', vendor);
  if (!noHp) { showToast('error', '✕ Nomor telepon vendor tidak ada'); return; }
  const msg = document.getElementById('waManualPreview').value;
  if (!msg) { showToast('error', '✕ Pilih item terlebih dahulu'); return; }
  const num = _toWaNum(noHp);
  if (!num) { showToast('error', '✕ Format nomor tidak valid'); return; }
  window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
}

window.openWAModeSelector      = openWAModeSelector;
window.openWAModal             = openWAModal;
window.onWAVendorChange        = onWAVendorChange;
window.onWAKontakChange        = onWAKontakChange;
window.onWAGroupItemToggle     = onWAGroupItemToggle;
window.waGroupCheckAll         = waGroupCheckAll;
window.onWAManualVendorChange  = onWAManualVendorChange;
window.onWAManualItemToggle    = onWAManualItemToggle;
window.waManualCheckAll        = waManualCheckAll;
window.copyWAMsg               = copyWAMsg;
window.openWA                  = openWA;
window.copyWAManualMsg         = copyWAManualMsg;
window.openWAManual            = openWAManual;
window.openWAForVendor         = openWAForVendor;
