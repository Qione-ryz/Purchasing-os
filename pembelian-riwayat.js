/* ═══════════════════════════════════════════════════════════════════
   pembelian-riwayat.js — Tab Riwayat & Edit/Hapus pembelian.html

   Bergantung pada (harus dimuat lebih dulu di HTML):
     supabase.js · config.js · auth.js · ppn.js · datefilter.js
     xlsx.js (untuk exportRiwayat)

   Mengakses dari scope global (didefinisikan di pembelian.html):
     PageState, window._sb, window._ppnRate, window._userRole
     rPage, R_PER_PAGE, rSortField, rSortDir, rSearchTimer
     rDf (DateFilter instance)
     _buildRiwayatQuery, _buildCountQuery  (di-override multi-brand)
     formatRp, showToast, switchTab, logActivity
     editItems, editPpnMode  (state lokal edit modal)
   ═══════════════════════════════════════════════════════════════════ */

/* ── state lokal edit modal (dideklarasikan di pembelian.html) ── */
/* editItems dan editPpnMode diakses dari global scope pembelian.html */

/* ── Shorthand ke PageState — dibaca/ditulis via window proxy yang
   didefinisikan di pembelian.html sehingga nilai selalu sinkron. ──
   Dengan ini semua kode di file ini bisa pakai rPage, rSortField, dll
   tanpa prefix window. */
Object.defineProperties(window, {
  rPage       : { get: () => PageState.rPage,        set: v => { PageState.rPage        = v; }, configurable: true },
  rSortField  : { get: () => PageState.rSortField,   set: v => { PageState.rSortField   = v; }, configurable: true },
  rSortDir    : { get: () => PageState.rSortDir,     set: v => { PageState.rSortDir     = v; }, configurable: true },
  rSearchTimer: { get: () => PageState.rSearchTimer, set: v => { PageState.rSearchTimer = v; }, configurable: true },
});

/* ── Normalisasi baris dari Supabase ── */
function _normalizeRow(r) {
  const ghostCache = PageState.riwayatGhostCache || {};
  const vid = r.vendor_id;
  let vendor_nama = '—', vendor_deleted = false;
  if (vid) {
    const liveName = window.vendorMap?.[vid];
    if (liveName)             { vendor_nama = liveName; }
    else if (ghostCache[vid]) { vendor_nama = ghostCache[vid]; vendor_deleted = true; }
    else                      { vendor_nama = vid; vendor_deleted = true; }
  }
  /* Resolve nama barang ke nama terkini dari master (Opsi A).
     resolveNamaBarang() dari barang-helper.js — fallback ke snapshot
     jika barang sudah dihapus dari master. */
  const items = (r.riwayat_beli_items || []).map(item => ({
    ...item,
    nama: typeof window.resolveNamaBarang === 'function'
      ? window.resolveNamaBarang(item)
      : (item.nama || '—')
  }));
  const tanggal_js = r.tanggal ? new Date(r.tanggal + 'T00:00:00') : new Date();
  return { ...r, items, vendor_nama, vendor_deleted, tanggal_js };
}


/* ── Build query Supabase berdasarkan filter aktif ── */
function _buildRiwayatQuery() {
  const sel      = PageState.rSelectedBrands || [];
  const status   = document.getElementById('rFilterStatus').value;
  const dateFrom = document.getElementById('rDateFrom').value;
  const dateTo   = document.getElementById('rDateTo').value;
  const vendor   = PageState.rVendorFilter;

  let q = window._sb.from('riwayat_beli').select('*, riwayat_beli_items(*)');
  if (sel.length === 1)    q = q.eq('brand_id', sel[0]);
  else if (sel.length > 1) q = q.in('brand_id', sel);
  if (status)   q = q.eq('status', status);
  if (dateFrom) q = q.gte('tanggal', dateFrom);
  if (dateTo)   q = q.lte('tanggal', dateTo);
  if (vendor)   q = q.eq('vendor_id', vendor);
  return q;
}


/* Query khusus untuk count ── */
function _buildCountQuery() {
  const sel      = PageState.rSelectedBrands || [];
  const status   = document.getElementById('rFilterStatus').value;
  const dateFrom = document.getElementById('rDateFrom').value;
  const dateTo   = document.getElementById('rDateTo').value;
  const vendor   = PageState.rVendorFilter;

  let q = window._sb.from('riwayat_beli').select('id', { count: 'exact', head: true });
  if (sel.length === 1)    q = q.eq('brand_id', sel[0]);
  else if (sel.length > 1) q = q.in('brand_id', sel);
  if (status)   q = q.eq('status', status);
  if (dateFrom) q = q.gte('tanggal', dateFrom);
  if (dateTo)   q = q.lte('tanggal', dateTo);
  if (vendor)   q = q.eq('vendor_id', vendor);
  return q;
}


/* ── Load stats ── */
async function loadRiwayatStats() {
  try {
    const sel      = PageState.rSelectedBrands || [];
    const status   = document.getElementById('rFilterStatus').value;
    const dateFrom = document.getElementById('rDateFrom').value;
    const dateTo   = document.getElementById('rDateTo').value;
    const dateLabel = document.getElementById('dateFilterLabel')?.textContent || 'Filter Ini';

    const { count: totalCount } = await _buildCountQuery();

    let nilaiQ = window._sb.from('riwayat_beli').select('total', { count: 'exact' });
    if (sel.length === 1)    nilaiQ = nilaiQ.eq('brand_id', sel[0]);
    else if (sel.length > 1) nilaiQ = nilaiQ.in('brand_id', sel);
    if (status)   nilaiQ = nilaiQ.eq('status', status);
    if (dateFrom) nilaiQ = nilaiQ.gte('tanggal', dateFrom);
    if (dateTo)   nilaiQ = nilaiQ.lte('tanggal', dateTo);
    const { data: nilaiRows } = await nilaiQ;
    const totalNilai = (nilaiRows || []).reduce((s, r) => s + (r.total || 0), 0);

    document.getElementById('rStatTotal').textContent     = totalCount ?? '—';
    document.getElementById('rStatBulan').textContent     = totalCount ?? '—';
    document.getElementById('rStatNilai').textContent     = formatRp(totalNilai);
    document.getElementById('rStatTotalLabel').textContent = 'Total Transaksi';
    document.getElementById('rStatBulanLabel').textContent = dateFrom || dateTo ? dateLabel : 'Semua';
    document.getElementById('rStatNilaiLabel').textContent = `Total Nilai${dateFrom || dateTo ? ' · ' + dateLabel : ''}`;
  } catch(e) { /* stats gagal tidak halangi tabel */ }
}


/* ── loadRiwayat ── */
async function loadRiwayat() {
  /* Ghost cache untuk vendor yang sudah dihapus */
  const ghostCache = JSON.parse(localStorage.getItem('vendorGhostCache') || '{}');
  (window.allVendors || []).forEach(v => { ghostCache[v.id] = v.nama; });
  PageState.riwayatGhostCache = ghostCache;

  await loadRiwayatStats();
  await fetchRiwayatPage();
}


/* ── fetchRiwayatPage ── */
async function fetchRiwayatPage() {
  const tbody = document.getElementById('rTableBody');
  tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--muted)"><span class="spinner"></span> Memuat...</td></tr>`;

  /* Update stats ikut filter aktif */
  loadRiwayatStats();

  try {
    const search  = document.getElementById('rSearch').value.toLowerCase().trim();
    const sortCol = rSortField === 'tanggal'    ? 'tanggal'
                  : rSortField === 'total'      ? 'total'
                  : rSortField === 'created_at' ? 'created_at'
                  : 'tanggal';

    let display, totalCount;

    if (search) {
      /* Search mode: fetch semua data lalu filter di client */
      const { data: allRaw, error } = await _buildRiwayatQuery()
        .order(sortCol, { ascending: rSortDir === 'asc' });
      if (error) throw error;

      const allNorm = (allRaw || []).map(_normalizeRow);
      const filtered = allNorm.filter(r =>
        (r.nomor_faktur || '').toLowerCase().includes(search) ||
        (r.vendor_nama  || '').toLowerCase().includes(search) ||
        (r.catatan      || '').toLowerCase().includes(search) ||
        (r.items || []).some(i => (i.nama || '').toLowerCase().includes(search))
      );

      totalCount = filtered.length;
      const pageFrom = (rPage - 1) * R_PER_PAGE;
      display = filtered.slice(pageFrom, pageFrom + R_PER_PAGE);
      PageState.riwayatData = filtered; /* untuk openDetail/openEdit */
    } else {
      /* Normal mode: server-side pagination */
      const pageFrom = (rPage - 1) * R_PER_PAGE;
      const pageTo   = rPage * R_PER_PAGE - 1;

      const { data: riwayatRaw, error } = await _buildRiwayatQuery()
        .order(sortCol, { ascending: rSortDir === 'asc' })
        .range(pageFrom, pageTo);
      if (error) throw error;

      const { count } = await _buildCountQuery();
      totalCount = count || 0;
      display = (riwayatRaw || []).map(_normalizeRow);
      PageState.riwayatData = display;
    }

    PageState.riwayatPageData = display;
    PageState.riwayatTotal   = totalCount;

    _renderRiwayatRows(display);
    renderRPagin(totalCount);
  } catch(e) {
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--danger)">Gagal memuat data.</td></tr>`;
  }
}


/* ── getRFiltered ── */
function getRFiltered() {
  const search = document.getElementById('rSearch').value.toLowerCase().trim();
  const data   = PageState.riwayatPageData || [];
  if (!search) return data;
  return data.filter(r =>
    (r.nomor_faktur || '').toLowerCase().includes(search) ||
    (r.vendor_nama  || '').toLowerCase().includes(search) ||
    (r.catatan      || '').toLowerCase().includes(search) ||
    (r.items || []).some(i => (i.nama || '').toLowerCase().includes(search))
  );
}


/* ── renderRiwayat ── */
function renderRiwayat() {
  rPage = 1;
  fetchRiwayatPage();
}


/* ── _renderRiwayatRows ── */
function _renderRiwayatRows(slice) {
  const tbody = document.getElementById('rTableBody');

  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">
      <div class="empty-icon">🛒</div><div class="empty-text">Tidak ada data pembelian</div>
      <button class="btn btn-primary" onclick="switchTab('form')">＋ Catat Pembelian</button>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = slice.map(r => {
    const tgl    = r.tanggal_js.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    const badgeS = { selesai: 'badge-green', pending: 'badge-orange', batal: 'badge-red' }[r.status] || 'badge-gray';
    const nItems = (r.items || []).length;
    const vendorDisplay = r.vendor_nama;
    const brandNama  = (window.allBrands || []).find(b => b.id === r.brand_id)?.nama || r.brand_id || '—';
    const brandColor = (window.allBrands || []).find(b => b.id === r.brand_id)?.warna || null;
    const brandStyle = brandColor
      ? `background:${brandColor};color:${getBadgeTextColor(brandColor)};padding:3px 10px;font-size:12px;font-weight:500`
      : `background:var(--surface2);color:var(--muted);padding:3px 10px;font-size:12px;font-weight:500`;
    return `<tr>
      <td><button class="expand-btn" id="expbtn-${r.id}" onclick="toggleExpand('${r.id}')">▶</button></td>
      <td><span class="td-date" style="white-space:nowrap">${tgl}</span></td>
      <td style="overflow:hidden"><span style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--mono);font-size:12px;color:var(--accent2)" title="${r.nomor_faktur||''}">${r.nomor_faktur || '—'}</span></td>
      <td style="font-weight:500;overflow:hidden"><span style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${vendorDisplay}">${vendorDisplay}</span></td>
      <td style="overflow:hidden"><span class="badge" style="${brandStyle};display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${brandNama}</span></td>
      <td><span class="td-count" style="white-space:nowrap">${nItems} item</span></td>
      <td style="white-space:nowrap"><span style="font-family:var(--mono);font-weight:600">${formatRp(r.total || 0)}</span></td>
      <td><span class="badge ${badgeS}">${r.status || '—'}</span></td>
      <td>
        <div class="action-group">
          <button class="btn btn-ghost btn-sm" onclick="openDetail('${r.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Detail
          </button>
          ${window._isAdmin?`
          <div class="action-more-wrap">
            <button class="action-more-btn" onclick="toggleActionMenu(event,'rmenu-${r.id}')" title="Aksi lain">⋯</button>
            <div class="action-more-menu" id="rmenu-${r.id}">
              <button class="action-more-item" onclick="closeAllMenus();openEdit('${r.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit</button>
              <button class="action-more-item danger" onclick="closeAllMenus();hapusRiwayatById('${r.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Hapus</button>
            </div>
          </div>
          `:''}
        </div>
      </td>
    </tr>
    <tr class="detail-row" id="detrow-${r.id}">
      <td colspan="9">
        <div class="detail-inner">
          <table class="detail-items-table">
            <thead><tr>
              <th>Barang</th><th>SKU</th><th>Satuan</th>
              <th style="text-align:right">Qty</th>
              <th style="text-align:right">Harga Satuan</th>
              <th style="text-align:right">Subtotal</th>
            </tr></thead>
            <tbody>${(r.items || []).map(item => {
              const isInc = item.ppn_included !== undefined ? item.ppn_included : (r.ppn_included || false);
              const hargaTampil = isInc
                ? (item.harga_inc_ppn || item.harga_satuan || 0)
                : (item.harga_exc_ppn || item.harga_satuan || 0);
              const ppnLabel = isInc
                ? '<span class="ppn-tag inc">inc PPN</span>'
                : '<span class="ppn-tag exc">exc PPN</span>';
              return `<tr>
              <td style="font-weight:500">${item.nama || '—'}</td>
              <td class="td-sku">${item.sku || '—'}</td>
              <td>${item.satuan || '—'}</td>
              <td style="text-align:right;font-family:var(--mono)">${item.qty}</td>
              <td style="text-align:right;font-family:var(--mono)">${formatRp(hargaTampil)}${ppnLabel}</td>
              <td style="text-align:right;font-family:var(--mono);color:var(--accent2)">${formatRp(item.subtotal || 0)}</td>
            </tr>`;}).join('')}</tbody>
          </table>
          ${r.catatan ? `<div style="margin-top:10px;color:var(--muted)">📝 ${r.catatan}</div>` : ''}
          <div style="margin-top:12px;display:flex;justify-content:flex-end">
            <div class="detail-sum-table">
              ${(() => {
                const subtotalInc = r.subtotal || 0;
                const ppnRate = (window._ppnRate || 11) / 100;
                const allInc = (r.items||[]).length > 0 && (r.items||[]).every(i => i.ppn_included !== undefined ? i.ppn_included : (r.ppn_included || false));
                if (allInc) {
                  return `<div style="display:flex;justify-content:space-between;color:var(--muted)"><span>Subtotal (inc PPN ${window._ppnRate||11}%)</span><span style="color:var(--text)">${formatRp(subtotalInc)}</span></div>`;
                }
                const subtotalExc = Math.round(subtotalInc / (1 + ppnRate));
                const ppnAmt = subtotalInc - subtotalExc;
                return `<div style="display:flex;justify-content:space-between;color:var(--muted)"><span>Subtotal (exc PPN)</span><span style="color:var(--text)">${formatRp(subtotalExc)}</span></div>
                <div style="display:flex;justify-content:space-between;color:var(--muted)"><span>+ PPN ${window._ppnRate||11}%</span><span style="color:var(--text)">${formatRp(ppnAmt)}</span></div>`;
              })()}
              ${r.diskon ? `<div style="display:flex;justify-content:space-between;color:var(--muted)"><span>Diskon</span><span>− ${formatRp(r.diskon)}</span></div>` : ''}
              ${r.ongkir ? `<div style="display:flex;justify-content:space-between;color:var(--muted)"><span>Ongkir</span><span>+ ${formatRp(r.ongkir)}</span></div>` : ''}
              <div style="display:flex;justify-content:space-between;margin-top:4px;padding-top:6px;border-top:1px solid var(--border);font-weight:700;color:var(--accent2)">
                <span>Total</span><span>${formatRp(r.total || 0)}</span>
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>`;
  }).join('');
}


/* ── toggleExpand ── */
function toggleExpand(id) {
  const row = document.getElementById('detrow-' + id);
  const btn = document.getElementById('expbtn-' + id);
  const open = row.classList.toggle('open');
  btn.classList.toggle('open', open);
}


/* ── renderRPagin ── */
function renderRPagin(total) {
  const pages = Math.ceil(total / R_PER_PAGE) || 1;
  document.getElementById('rPaginInfo').textContent =
    `Menampilkan ${Math.min((rPage - 1) * R_PER_PAGE + 1, total || 1)}–${Math.min(rPage * R_PER_PAGE, total)} dari ${total} transaksi`;
  const pb = document.getElementById('rPageBtns');
  pb.innerHTML = '';
  const add = (lbl, pg, dis, act) => {
    const b = document.createElement('button');
    b.className = 'page-btn' + (act ? ' active' : ''); b.textContent = lbl; b.disabled = dis;
    b.onclick = () => { rPage = pg; fetchRiwayatPage(); }; pb.appendChild(b);
  };
  add('««', 1, rPage === 1, false);
  add('‹', rPage - 1, rPage === 1, false);
  for (let p = Math.max(1, rPage - 2); p <= Math.min(pages, rPage + 2); p++) add(p, p, false, p === rPage);
  add('›', rPage + 1, rPage === pages, false);
  add('»»', pages, rPage === pages, false);
}


/* ── rSortBy ── */
function rSortBy(field) {
  if (rSortField === field) rSortDir = rSortDir === 'asc' ? 'desc' : 'asc';
  else { rSortField = field; rSortDir = (field === 'tanggal' || field === 'created_at') ? 'desc' : 'asc'; }
  _updateRSortIndicators();
  rPage = 1; fetchRiwayatPage();
}

function _updateRSortIndicators() {
  ['tanggal','nomor_faktur','vendor_nama','brand_id','total','status','created_at'].forEach(f => {
    const span = document.getElementById('rsort-' + f);
    if (span) span.textContent = rSortField === f ? (rSortDir === 'asc' ? '▲' : '▼') : '↕';
  });
  const btn = document.getElementById('btnSortDiinput');
  if (btn) {
    const active = rSortField === 'created_at';
    btn.style.cssText = active
      ? 'white-space:nowrap;border-color:#00d4ff;color:#00d4ff;background:rgba(0,212,255,0.12);font-weight:600'
      : 'white-space:nowrap;color:var(--muted)';
  }
}


/* ── onRSearch ── */
function onRSearch() {
  clearTimeout(rSearchTimer);
  rSearchTimer = setTimeout(() => {
    rPage = 1;
    fetchRiwayatPage().then(() => {
      const q    = document.getElementById('rSearch').value.trim();
      const info = document.getElementById('rSearchResultInfo');
      if (!info) return;
      if (q) {
        const total = PageState.riwayatTotal || 0;
        info.style.display = '';
        info.textContent   = total
          ? `Ditemukan ${total} transaksi untuk "${q}"`
          : `Tidak ada hasil untuk "${q}"`;
      } else {
        info.style.display = 'none';
      }
    });
  }, 400);
}


/* ── openDetail ── */
function openDetail(id) {
  const r = (PageState.riwayatData || []).find(x => x.id === id);
  if (!r) return;
  document.getElementById('detailTitle').textContent = r.nomor_faktur || 'Detail Pembelian';
  const tgl    = r.tanggal_js.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const badgeS = { selesai: 'badge-green', pending: 'badge-orange', batal: 'badge-red' }[r.status] || 'badge-gray';
  const _detBrand = (window.allBrands||[]).find(b => b.id === r.brand_id);
  const _detBrandColor = _detBrand?.warna || null;
  const _detBrandStyle = _detBrandColor
    ? `background:${_detBrandColor};color:${getBadgeTextColor(_detBrandColor)};padding:3px 10px;font-size:12px;font-weight:500`
    : `background:var(--surface2);color:var(--muted);padding:3px 10px;font-size:12px;font-weight:500`;

  document.getElementById('detailBody').innerHTML = `
    <div class="detail-kv"><span class="detail-k">Tanggal</span><span class="detail-v">${tgl}</span></div>
    <div class="detail-kv"><span class="detail-k">No. Faktur</span><span class="detail-v" style="font-family:var(--mono)">${r.nomor_faktur || '—'}</span></div>
    <div class="detail-kv"><span class="detail-k">Vendor</span><span class="detail-v">${r.vendor_nama}</span></div>
    <div class="detail-kv"><span class="detail-k">Brand</span><span class="detail-v"><span class="badge" style="${_detBrandStyle}">${_detBrand?.nama || r.brand_id || '—'}</span></span></div>
    <div class="detail-kv"><span class="detail-k">Status</span><span class="detail-v"><span class="badge ${badgeS}">${r.status || '—'}</span></span></div>
    <div class="detail-kv"><span class="detail-k">Catatan</span><span class="detail-v">${r.catatan || '—'}</span></div>
    <div class="detail-sum-header">Daftar Barang</div>
    <table class="detail-sum-table" style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;color:var(--muted);font-family:var(--mono);font-size:var(--fs-mono-sm);border-bottom:1px solid var(--border)">Barang</th>
        <th style="text-align:right;padding:6px 8px;color:var(--muted);font-family:var(--mono);font-size:var(--fs-mono-sm);border-bottom:1px solid var(--border)">Qty</th>
        <th style="text-align:right;padding:6px 8px;color:var(--muted);font-family:var(--mono);font-size:var(--fs-mono-sm);border-bottom:1px solid var(--border)">Harga</th>
        <th style="text-align:right;padding:6px 8px;color:var(--muted);font-family:var(--mono);font-size:var(--fs-mono-sm);border-bottom:1px solid var(--border)">Subtotal</th>
      </tr></thead>
      <tbody>${(r.items || []).map(i => {
        /* Baca ppn_included dari item, fallback ke parent record */
        const isInc = i.ppn_included !== undefined ? i.ppn_included : (r.ppn_included || false);
        const hargaTampil = isInc
          ? (i.harga_inc_ppn || i.harga_satuan || 0)
          : (i.harga_exc_ppn || i.harga_satuan || 0);
        const ppnLabel = isInc
          ? '<span class="ppn-tag inc">inc PPN</span>'
          : '<span class="ppn-tag exc">exc PPN</span>';
        return `<tr>
        <td style="padding:8px;border-bottom:1px solid rgba(37,40,48,0.4)">${i.nama}</td>
        <td style="padding:8px;text-align:right;font-family:var(--mono);border-bottom:1px solid rgba(37,40,48,0.4)">${i.qty} <span style="color:var(--muted);font-size:var(--fs-mono-sm)">${i.satuan}</span></td>
        <td style="padding:8px;text-align:right;font-family:var(--mono);border-bottom:1px solid rgba(37,40,48,0.4)">${formatRp(hargaTampil)}${ppnLabel}</td>
        <td style="padding:8px;text-align:right;font-family:var(--mono);border-bottom:1px solid rgba(37,40,48,0.4)">${formatRp(i.subtotal || 0)}</td>
      </tr>`;}).join('')}</tbody>
    </table>
    <div style="margin-top:14px;display:flex;justify-content:flex-end">
      <div class="detail-sum-table">
        ${(() => {
          const subtotalInc = r.subtotal || 0;
          const ppnRate = (window._ppnRate || 11) / 100;
          const allInc = (r.items||[]).length > 0 && (r.items||[]).every(i => i.ppn_included !== undefined ? i.ppn_included : (r.ppn_included || false));
          if (allInc) {
            return `<div style="display:flex;justify-content:space-between;color:var(--muted)"><span>Subtotal (inc PPN ${window._ppnRate||11}%)</span><span style="color:var(--text)">${formatRp(subtotalInc)}</span></div>`;
          }
          const subtotalExc = Math.round(subtotalInc / (1 + ppnRate));
          const ppnAmt = subtotalInc - subtotalExc;
          return `<div style="display:flex;justify-content:space-between;color:var(--muted)"><span>Subtotal (exc PPN)</span><span style="color:var(--text)">${formatRp(subtotalExc)}</span></div>
          <div style="display:flex;justify-content:space-between;color:var(--muted)"><span>+ PPN ${window._ppnRate||11}%</span><span style="color:var(--text)">${formatRp(ppnAmt)}</span></div>`;
        })()}
        ${r.diskon ? `<div style="display:flex;justify-content:space-between;color:var(--muted)"><span>Diskon</span><span>− ${formatRp(r.diskon)}</span></div>` : ''}
        ${r.ongkir ? `<div style="display:flex;justify-content:space-between;color:var(--muted)"><span>Ongkos Kirim</span><span>+ ${formatRp(r.ongkir)}</span></div>` : ''}
        <div class="detail-sum-total" style="display:flex;justify-content:space-between;margin-top:6px;padding-top:8px;border-top:1px solid var(--border)">
          <span>Total</span><span>${formatRp(r.total || 0)}</span>
        </div>
      </div>
    </div>`;

  document.getElementById('btnDetailDel').onclick = () => {
    closeDetail();
    hapusRiwayat(r.id, r.nomor_faktur || 'transaksi ini');
  };
  document.getElementById('btnDetailEdit').onclick = () => {
    closeDetail();
    openEdit(r.id);
  };
  document.getElementById('detailOverlay').classList.add('show');
  if (window._userRole) applyRoleUI(window._userRole);
}


/* ── closeDetail ── */
function closeDetail() { document.getElementById('detailOverlay').classList.remove('show'); }


/* ── hapusRiwayatById ── */
function hapusRiwayatById(id) {
  const r = (PageState.riwayatData || []).find(x => x.id === id);
  const label = r?.nomor_faktur || 'transaksi ini';
  hapusRiwayat(id, label);
}

/* ── CONFIRM MODAL ── */
function showConfirmModal({ title, body, onConfirm, confirmLabel = 'Hapus' }) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmBody').innerHTML = body;
  const btn = document.getElementById('btnConfirmDel');
  btn.innerHTML = confirmLabel;
  btn.disabled  = false;
  btn.onclick   = () => { closeConfirm(); onConfirm(); };
  document.getElementById('confirmOverlay').classList.add('show');
}
function closeConfirm() { document.getElementById('confirmOverlay').classList.remove('show'); }


/* ── hapusRiwayat ── */
async function hapusRiwayat(id, label) {
  showConfirmModal({
    title: 'Hapus Pembelian',
    body: `Yakin ingin menghapus <strong>${label}</strong>?<br><br>Riwayat harga dari transaksi ini juga akan ikut dihapus. Data tidak bisa dikembalikan.`,
    confirmLabel: 'Hapus',
    onConfirm: async () => {
      try {
        // 1. Ambil order_item_id yang ter-link ke beli ini sebelum cascade delete
        //    agar bisa reset qty_terpenuhi-nya — kalau tidak, stale FIFO bisa
        //    bikin order_item tampil 'Selesai' meski pembelian sudah hilang.
        const { data: linkedRows } = await window._sb
          .from('riwayat_beli_items')
          .select('order_item_id, barang_id')
          .eq('beli_id', id);

        const linkedItemIds = [...new Set(
          (linkedRows || []).map(r => r.order_item_id).filter(Boolean)
        )];
        const affectedBarangIds = [...new Set(
          (linkedRows || []).map(r => r.barang_id).filter(Boolean)
        )];

        // 2. Hapus child rows dulu (FK riwayat_beli_items_beli_id_fkey tanpa CASCADE),
        //    lalu riwayat_harga + riwayat_beli header.
        await window._sb.from('riwayat_beli_items').delete().eq('beli_id', id);
        await window._sb.from('riwayat_harga').delete().eq('beli_id', id);
        // Kembalikan invoice_drafts terkait ke "belum dicek" (lepas purchased_at + riwayat_beli_id)
        await window._sb.from('invoice_drafts')
          .update({ riwayat_beli_id: null, purchased_at: null })
          .eq('riwayat_beli_id', id);
        const { error } = await window._sb.from('riwayat_beli').delete().eq('id', id);
        if (error) throw error;

        // 3. Reset qty_terpenuhi pada order_items terdampak agar FIFO recompute dari nol:
        //    a) item yang MANUALLY linked → linkedItemIds (langsung)
        //    b) item yang FIFO-auto-filled untuk barang yang sama (order_item_id=null)
        //       → reset semua order_items.barang_id IN affectedBarangIds yang BUKAN status selesai.
        //    Biarkan status_item='selesai' utuh (manual selesai user, jangan diganggu).
        if (affectedBarangIds.length > 0) {
          await window._sb
            .from('order_items')
            .update({ qty_terpenuhi: 0, status_item: 'pending' })
            .in('barang_id', affectedBarangIds)
            .neq('status_item', 'selesai');
        }
        if (linkedItemIds.length > 0) {
          // Item custom (barang_id null) yang manual-linked — tetap di-reset.
          await window._sb
            .from('order_items')
            .update({ qty_terpenuhi: 0, status_item: 'pending' })
            .in('id', linkedItemIds)
            .neq('status_item', 'selesai');
        }

        // 4. Invalidate FIFO cache agar item lain (yang FIFO-allocated) dihitung ulang
        if (typeof window._invalidateFifoCache === 'function') {
          window._invalidateFifoCache(affectedBarangIds.length ? affectedBarangIds : undefined);
        }

        showToast('Transaksi dihapus · riwayat harga ikut dihapus', 'success');
        logActivity('hapus', 'pembelian', label);
        await window.loadRiwayat();
      } catch(e) {
        showToast('Gagal menghapus: ' + e.message, 'error');
      }
    }
  });
}


/* ══ EDIT RIWAYAT ══ */
function setEditPPN(mode) {
  editPpnMode = mode;
  const btnExc = document.getElementById('ePpnBtnExc');
  const btnInc = document.getElementById('ePpnBtnInc');
  if (btnExc && btnInc) {
    btnExc.classList.toggle('active', mode === 'exc');
    btnInc.classList.toggle('active', mode === 'inc');
  }
  renderEditItems();
  updateEditSummary();
}

function openEdit(id) {
  const r = (PageState.riwayatData || []).find(x => x.id === id);
  if (!r) return;

  document.getElementById('eRiwayatId').value = id;
  document.getElementById('eFaktur').value    = r.nomor_faktur || '';
  document.getElementById('eCatatan').value   = r.catatan || '';
  document.getElementById('eStatus').value    = r.status || 'selesai';
  const _fmt = (n) => n ? 'Rp ' + Number(n).toLocaleString('id-ID', {minimumFractionDigits:0,maximumFractionDigits:2}) : '';
  document.getElementById('eDiskon').value    = _fmt(r.diskon);
  document.getElementById('eOngkir').value    = _fmt(r.ongkir);
  document.getElementById('editError').classList.remove('show');

  /* Brand select — populate + set current value */
  const eFBrand = document.getElementById('eFBrand');
  if (eFBrand) {
    eFBrand.innerHTML = '<option value="">— Pilih Brand —</option>' +
      (window.allBrands || []).map(b =>
        `<option value="${b.id}" ${b.id === r.brand_id ? 'selected' : ''}>${b.nama}</option>`
      ).join('');
  }

  /* Tanggal — r.tanggal is already 'YYYY-MM-DD' */
  document.getElementById('eFTanggal').value = r.tanggal || '';

  /* Vendor combo — set hidden input value + update combo label */
  const vendorObj = (window.allVendors || []).find(v => v.id === r.vendor_id);
  document.getElementById('eFVendor').value = r.vendor_id || '';
  const eLbl = document.getElementById('eVendorComboLabel');
  if (eLbl) {
    if (vendorObj) {
      eLbl.textContent = vendorObj.nama;
      eLbl.style.color = 'var(--text)';
    } else {
      eLbl.textContent = 'Pilih vendor...';
      eLbl.style.color = 'var(--muted)';
    }
  }
  /* Pastikan dropdown panel tertutup saat modal dibuka */
  if (typeof closeEditVendorPanel === 'function') closeEditVendorPanel();

  /* Detect PPN mode dari transaksi — items simpan harga_satuan sebagai exc PPN */
  const itemPpnIncluded = (r.items || [])[0]?.ppn_included ?? r.ppn_included ?? false;
  editPpnMode = itemPpnIncluded ? 'inc' : 'exc';
  /* Jika mode inc, konversi harga yang ditampilkan ke inc */
  const ppnRate = (window._ppnRate || 11) / 100;
  editItems = (r.items || []).map(i => {
    const excHarga = i.harga_exc_ppn || i.harga_satuan || 0;
    const incHarga = i.harga_inc_ppn || Math.round(excHarga * (1 + ppnRate));
    return {
      ...i,
      _harga_exc: excHarga,
      _harga_inc: incHarga,
      harga_satuan: itemPpnIncluded ? incHarga : excHarga,
    };
  });
  /* Sync toggle button UI */
  setEditPPN(editPpnMode);
  document.getElementById('editOverlay').classList.add('show');
}

function closeEdit() {
  document.getElementById('editOverlay').classList.remove('show');
  if (typeof closeEditVendorPanel === 'function') closeEditVendorPanel();
  /* Reset combo label */
  const eLbl = document.getElementById('eVendorComboLabel');
  if (eLbl) { eLbl.textContent = 'Pilih vendor...'; eLbl.style.color = 'var(--muted)'; }
  document.getElementById('eFVendor').value = '';
  editItems   = [];
  editPpnMode = 'exc';
}

function renderEditItems() {
  const list    = document.getElementById('eItemList');
  const ppnRate = (window._ppnRate || 11) / 100;
  const isInc   = editPpnMode === 'inc';
  const ppnBadge = isInc
    ? '<span class="harga-src vendor" style="margin-left:0">inc PPN</span>'
    : '<span class="harga-src" style="margin-left:0;background:rgba(107,114,128,0.12);color:var(--muted)">exc PPN</span>';

  list.innerHTML = editItems.map((item, i) => {
    const displayHarga = item.harga_satuan;
    const subtotal     = item.qty * displayHarga;
    const brandNama    = (window.allBrands||[]).find(b=>b.id===item.brand_id)?.nama || '';
    return `
    <div class="item-row">
      <div>
        <div class="item-label">${item.nama} ${ppnBadge}</div>
        <div class="item-sub">${[item.sku, item.satuan, brandNama].filter(Boolean).join(' · ')}</div>
      </div>
      <div style="display:flex;align-items:center;gap:5px;justify-content:flex-end">
        <input class="item-input" type="text" inputmode="decimal"
          value="${item.qty}"
          oninput="this.value=this.value.replace(',','.');editItems[${i}].qty=parseFloat(this.value)||0;updateEditSummary()"
          onblur="this.value=parseFloat(this.value)||''"
          style="width:60px" title="Qty"/>
        <span class="td-satuan" style="white-space:nowrap">${item.satuan||''}</span>
      </div>
      <input class="item-input" type="text" inputmode="decimal"
        value="${displayHarga ? 'Rp ' + displayHarga.toLocaleString('id-ID', {minimumFractionDigits:0,maximumFractionDigits:2}) : ''}"
        onfocus="_rpFocus(this)"
        oninput="_onRpInput(this);onEditHargaInput(${i}, window._parseRpRaw(this.value))"
        onblur="_fmtRpBlur(this);onEditHargaInput(${i}, window._parseRpRaw(this.value))"
        title="Harga satuan (Rp)"/>
      <div class="item-subtotal">${formatRpShort(subtotal)}</div>
      <button class="item-del" onclick="editItems.splice(${i},1);renderEditItems();updateEditSummary()" title="Hapus">✕</button>
    </div>`;
  }).join('');
}

function eItemSearchUpdate(q) {
  const drop = document.getElementById('eItemSearchDrop');
  if (!drop) return;
  const query = (q || '').toLowerCase().trim();
  const all   = window.allBarang || [];
  const results = query
    ? all.filter(b => b.nama?.toLowerCase().includes(query) || b.sku?.toLowerCase().includes(query)).slice(0, 30)
    : all.slice(0, 30);
  if (!results.length) { drop.style.display = 'none'; return; }
  drop.innerHTML = results.map(b => `
    <div onmousedown="eAddItem('${b.id}')"
      style="padding:9px 13px;cursor:pointer;font-size:13px;border-bottom:1px solid rgba(255,255,255,0.05);transition:background .12s"
      onmouseover="this.style.background='rgba(0,212,255,0.08)'" onmouseout="this.style.background=''">
      <div style="font-weight:500">${b.nama}</div>
      <div style="font-size:11px;color:var(--muted);font-family:var(--mono)">${[b.sku, b.satuan].filter(Boolean).join(' · ')}</div>
    </div>`).join('');
  drop.style.display = 'block';
}

function eAddItem(barangId) {
  const b = (window.allBarang || []).find(x => x.id === barangId);
  if (!b) return;
  const ppnRate  = (window._ppnRate || 11) / 100;
  const isInc    = editPpnMode === 'inc';
  const hargaRaw = window._getHarga ? window._getHarga(b.id, eFVendorValue()) : null;
  const harga    = hargaRaw?.harga || 0;
  editItems.push({
    barang_id:     b.id,
    nama:          b.nama,
    sku:           b.sku || '',
    satuan:        b.satuan || '',
    brand_id:      b.brand_id || null,
    qty:           1,
    harga_satuan:  harga,
    _harga_exc:    isInc ? Math.round(harga / (1 + ppnRate)) : harga,
    _harga_inc:    isInc ? harga : Math.round(harga * (1 + ppnRate)),
  });
  renderEditItems();
  updateEditSummary();
  const inp = document.getElementById('eItemSearchInput');
  const drop = document.getElementById('eItemSearchDrop');
  if (inp)  { inp.value = ''; inp.focus(); }
  if (drop) drop.style.display = 'none';
}

function eFVendorValue() {
  return document.getElementById('eFVendor')?.value || '';
}

function onEditHargaInput(i, val) {
  const ppnRate = (window._ppnRate || 11) / 100;
  const isInc   = editPpnMode === 'inc';
  editItems[i].harga_satuan = val;
  /* Selalu simpan _harga_exc dan _harga_inc untuk saveEdit */
  editItems[i]._harga_exc = isInc ? Math.round(val / (1 + ppnRate)) : val;
  editItems[i]._harga_inc = isInc ? val : Math.round(val * (1 + ppnRate));
  updateEditSummary();
}

function updateEditSummary() {
  const ppnRate  = (window._ppnRate || 11) / 100;
  const isInc    = editPpnMode === 'inc';
  /* subtotalDisplay = jumlah sesuai mode tampilan */
  const subtotalDisplay = editItems.reduce((s, i) => s + (i.qty * i.harga_satuan), 0);
  /* subtotalExc = selalu exc untuk kalkulasi PPN */
  const subtotalExc = isInc
    ? Math.round(subtotalDisplay / (1 + ppnRate))
    : subtotalDisplay;
  const subtotalInc = isInc
    ? subtotalDisplay
    : Math.round(subtotalDisplay * (1 + ppnRate));
  const diskon  = window._parseRpRaw ? window._parseRpRaw(document.getElementById('eDiskon').value) : (parseFloat(document.getElementById('eDiskon').value) || 0);
  const ongkir  = window._parseRpRaw ? window._parseRpRaw(document.getElementById('eOngkir').value) : (parseFloat(document.getElementById('eOngkir').value) || 0);
  const total   = Math.max(0, subtotalInc - diskon + ongkir);
  document.getElementById('eTotalDisplay').textContent = formatRp(total);
  return { subtotalDisplay, subtotalExc, subtotalInc, diskon, ongkir, total };
}

async function saveEdit() {
  const id      = document.getElementById('eRiwayatId').value;
  const vendor  = document.getElementById('eFVendor').value;
  const tanggal = document.getElementById('eFTanggal').value;
  const faktur  = document.getElementById('eFaktur').value.trim();
  const catatan = document.getElementById('eCatatan').value.trim();
  const status  = document.getElementById('eStatus').value;
  const errEl   = document.getElementById('editError');
  errEl.classList.remove('show');

  if (!vendor)      { errEl.textContent = 'Pilih vendor.'; errEl.classList.add('show'); return; }
  if (!tanggal)     { errEl.textContent = 'Pilih tanggal.'; errEl.classList.add('show'); return; }
  if (!editItems.length) { errEl.textContent = 'Daftar barang tidak boleh kosong.'; errEl.classList.add('show'); return; }

  const btn = document.getElementById('btnSaveEdit');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Menyimpan...';

  const { subtotalExc, subtotalInc, diskon, ongkir, total } = updateEditSummary();
  const subtotal = subtotalInc; /* total yang disimpan = inc PPN */

  try {
    /* Update main purchase */
    const eFBrandEl = document.getElementById('eFBrand');
  const editBrandId = eFBrandEl ? (eFBrandEl.value || null) : null;

  const { error: updateErr } = await window._sb.from('riwayat_beli').update({
      tanggal,
      nomor_faktur: faktur,
      vendor_id:    vendor,
      brand_id:     editBrandId,
      catatan,
      status,
      diskon,
      ongkir,
      subtotal:     subtotalInc,
      total,
      ppn_included: editPpnMode === 'inc',
      updated_at:   new Date().toISOString()
    }).eq('id', id);
    if (updateErr) throw updateErr;

    /* Replace items: delete old, insert new */
    const { error: delItemErr } = await window._sb.from('riwayat_beli_items').delete().eq('beli_id', id);
    if (delItemErr) throw delItemErr;

    const ppnRate = (window._ppnRate || 11) / 100;
    const isIncMode = editPpnMode === 'inc';
    const newItems = editItems.map(i => {
      const excHarga = i._harga_exc ?? (isIncMode ? Math.round(i.harga_satuan / (1 + ppnRate)) : i.harga_satuan);
      const incHarga = i._harga_inc ?? (isIncMode ? i.harga_satuan : Math.round(i.harga_satuan * (1 + ppnRate)));
      return {
        beli_id:       id,
        barang_id:     i.barang_id || '',
        nama:          i.nama || '',
        sku:           i.sku || '',
        satuan:        i.satuan || '',
        brand_id:      i.brand_id || null,
        qty:           i.qty,
        harga_satuan:  excHarga,        /* selalu simpan exc */
        harga_exc_ppn: excHarga,
        harga_inc_ppn: incHarga,
        ppn_included:  isIncMode,
        subtotal:      i.qty * incHarga /* subtotal selalu inc */
      };
    });
    const { error: insItemErr } = await window._sb.from('riwayat_beli_items').insert(newItems);
    if (insItemErr) throw insItemErr;

    /* Add new riwayat_harga entries for edit — delete old ones first */
    await window._sb.from('riwayat_harga').delete().eq('beli_id', id).eq('sumber', 'pembelian');
    const origBrandId = PageState.riwayatData?.find(x => x.id === id)?.brand_id || '';
    const hargaPayloads = newItems.map(item => ({
      barang_id:     item.barang_id || '',
      barang_nama:   item.nama || '',
      barang_sku:    item.sku || '',
      vendor_id:     vendor,
      brand_id:      item.brand_id || origBrandId || null,
      harga:         item.harga_exc_ppn,
      harga_exc_ppn: item.harga_exc_ppn,
      harga_inc_ppn: item.harga_inc_ppn,
      ppn_included:  item.ppn_included,
      qty:           item.qty,
      tanggal,
      sumber:        'edit',
      beli_id:       id
    }));
    const { error: hargaErr } = await window._sb.from('riwayat_harga').insert(hargaPayloads);
    if (hargaErr) throw hargaErr;

    showToast('✓ Pembelian berhasil diperbarui', 'success');
    logActivity('edit', 'pembelian', faktur || id, `${editItems.length} item`);
    closeEdit();
    await window.loadRiwayat();
  } catch(e) {
    errEl.textContent = 'Gagal menyimpan: ' + e.message; errEl.classList.add('show');
    console.error(e);
  } finally {
    btn.disabled = false; btn.innerHTML = '💾 Simpan Perubahan';
  }
}


/* ── exportRiwayat ── */
async function exportRiwayat() {
  showToast('Menyiapkan export...', 'success');
  try {
    let data;
    const search = document.getElementById('rSearch').value.toLowerCase().trim();

    if (search && PageState.riwayatData && PageState.riwayatData.length > 0) {
      /* Search aktif: pakai data hasil filter yang sudah ada di memory */
      data = PageState.riwayatData;
    } else {
      /* Tidak ada search: fetch semua data dengan filter tanggal/brand/status */
      const { data: allData, error } = await _buildRiwayatQuery()
        .order('tanggal', { ascending: false });
      if (error) throw error;
      data = (allData || []).map(_normalizeRow);
    }

    if (!data.length) { showToast('Tidak ada data untuk diexport', 'error'); return; }

  const wb = XLSX.utils.book_new();

  /* Sheet 1: Ringkasan transaksi */
  const ringkasanRows = [
    ['Tanggal', 'No. Faktur', 'Vendor', 'Brand', 'Jml Item', 'Subtotal', 'Diskon', 'Ongkir', 'Total', 'Status', 'Catatan']
  ];
  data.forEach(r => {
    const brandNama = (window.allBrands||[]).find(b=>b.id===r.brand_id)?.nama || r.brand_id || '—';
    ringkasanRows.push([
      r.tanggal        || '',
      r.nomor_faktur   || '',
      r.vendor_nama    || '',
      brandNama,
      (r.items||[]).length,
      r.subtotal       || 0,
      r.diskon         || 0,
      r.ongkir         || 0,
      r.total          || 0,
      r.status         || '',
      r.catatan        || ''
    ]);
  });
  const ws1 = XLSX.utils.aoa_to_sheet(ringkasanRows);
  ws1['!cols'] = [12,18,20,16,10,14,12,12,14,10,24].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws1, 'Ringkasan');

  /* Sheet 2: Detail per item */
  const detailRows = [
    ['Tanggal', 'No. Faktur', 'Vendor', 'Brand', 'Nama Barang', 'SKU', 'Satuan', 'Qty', 'Harga Satuan (Exc)', 'Harga Satuan (Inc)', 'Subtotal', 'Status']
  ];
  /* Gunakan barangNameMap untuk resolve nama terkini di export
     (data di-fetch fresh, belum melalui _normalizeRow) */
  const _nameMap = typeof window.getBarangNameMap === 'function'
    ? window.getBarangNameMap()
    : {};
  data.forEach(r => {
    const brandNama = (window.allBrands||[]).find(b=>b.id===r.brand_id)?.nama || r.brand_id || '—';
    (r.items||[]).forEach(item => {
      const namaTampil = _nameMap[item.barang_id] || item.nama || '';
      detailRows.push([
        r.tanggal        || '',
        r.nomor_faktur   || '',
        r.vendor_nama    || '',
        brandNama,
        namaTampil,
        item.sku         || '',
        item.satuan      || '',
        item.qty         || 0,
        item.harga_exc_ppn || item.harga_satuan || 0,
        item.harga_inc_ppn || Math.round((item.harga_satuan||0)*(1+(window._ppnRate||11)/100)),
        item.subtotal    || 0,
        r.status         || ''
      ]);
    });
  });
  const ws2 = XLSX.utils.aoa_to_sheet(detailRows);
  ws2['!cols'] = [12,18,20,16,22,14,10,8,18,18,14,10].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws2, 'Detail Item');

  const tgl = new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, `riwayat_pembelian_${tgl}.xlsx`);
  showToast(`✓ Export ${data.length} transaksi berhasil`, 'success');
  } catch(e) {
    showToast('Gagal export: ' + e.message, 'error');
  }
}


/* ── Buka detail riwayat berdasarkan ID (dari tab Automation Discord) ── */
async function openRiwayatById(id) {
  if (!id) return;
  /* Cek apakah sudah ada di PageState.riwayatData */
  let r = (PageState.riwayatData || []).find(x => x.id === id);
  if (!r) {
    /* Fetch langsung dari DB */
    const { data, error } = await window._sb
      .from('riwayat_beli')
      .select('*, riwayat_beli_items(*)')
      .eq('id', id)
      .single();
    if (error || !data) {
      showToast('Pembelian tidak ditemukan.', 'error');
      return;
    }
    r = _normalizeRow(data);
    if (!PageState.riwayatData) PageState.riwayatData = [];
    PageState.riwayatData.unshift(r);
  }
  /* Pindah ke tab Riwayat lalu buka detail */
  if (typeof switchTab === 'function') switchTab('riwayat');
  setTimeout(() => openDetail(id), 80);
}


/* ── Expose ke window (dipanggil dari atribut HTML & inline script) ── */
window.loadRiwayat        = loadRiwayat;
window.renderRiwayat      = renderRiwayat;
window.fetchRiwayatPage   = fetchRiwayatPage;
window.rSortBy                  = rSortBy;
window._updateRSortIndicators   = _updateRSortIndicators;
window.onRSearch          = onRSearch;
window.toggleExpand       = toggleExpand;
window.openDetail         = openDetail;
window.closeDetail        = closeDetail;
window.onEditBrandChange = function() { /* brand change — vendor list stays as-is for now */ };
window.openEdit           = openEdit;
window.closeEdit          = closeEdit;
window.setEditPPN         = setEditPPN;
window.onEditHargaInput   = onEditHargaInput;
window.renderEditItems    = renderEditItems;
window.updateEditSummary  = updateEditSummary;
window.saveEdit           = saveEdit;
window.hapusRiwayat       = hapusRiwayat;
window.hapusRiwayatById   = hapusRiwayatById;
window.openRiwayatById    = openRiwayatById;
window.eItemSearchUpdate  = eItemSearchUpdate;
window.eAddItem           = eAddItem;
window.showConfirmModal   = showConfirmModal;
window.closeConfirm       = closeConfirm;
window.exportRiwayat      = exportRiwayat;
