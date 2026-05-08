/* ═══════════════════════════════════════════════════════════════════
   pembelian-carabarang.js — Tab Cari Barang pembelian.html

   Bergantung pada (harus dimuat lebih dulu di HTML):
     supabase.js · config.js · auth.js · ppn.js · datefilter.js
     xlsx.js (untuk cbExport)

   Mengakses dari scope global (didefinisikan di pembelian.html):
     PageState, window._sb, window._ppnRate
     window.allBrands, window.allBarang
     cbDf (DateFilter instance)
     CB_PER_PAGE
     formatRp, showToast
   ═══════════════════════════════════════════════════════════════════ */

/* State Tab Cari Barang disimpan di PageState (cbData, cbFiltered, cbPage,
   cbInited, cbTimer, cbSortField, cbSortDir) — deklarasi di blok script pertama. */
const CB_PER_PAGE = 20;

/* ─── Date picker state ─── */


function cbInit() {
  if (PageState.cbInited) return;
  PageState.cbInited = true;

  // Isi dropdown brand
  const sel = document.getElementById('cbFilterBrand');
  (window.allBrands || []).forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id; opt.textContent = b.nama;
    sel.appendChild(opt);
  });

  // Isi dropdown kategori dari allBarang
  const katSel = document.getElementById('cbFilterKategori');
  const kats = [...new Set((window.allBarang || []).map(b => b.kategori).filter(Boolean))].sort();
  kats.forEach(k => {
    const opt = document.createElement('option');
    opt.value = k; opt.textContent = k;
    katSel.appendChild(opt);
  });

  // Default: Bulan Ini — set state tapi jangan tutup picker (belum dibuka)
  cbDf.setQuick('thismonth'); // default Bulan Ini
  // Langsung fetch data awal
  cbFetch();
}

function cbOnSearch() {
  clearTimeout(PageState.cbTimer);
  PageState.cbTimer = setTimeout(cbApplySearch, 200);
}
function cbToggleClear() {
  const v = document.getElementById('cbSearch').value;
  document.getElementById('cbSearchClear').style.display = v ? '' : 'none';
}
function cbClearSearch() {
  document.getElementById('cbSearch').value = '';
  document.getElementById('cbSearchClear').style.display = 'none';
  cbApplySearch();
}

/* ─── Sort ─── */
function cbSortBy(field) {
  if (PageState.cbSortField === field) {
    PageState.cbSortDir = PageState.cbSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    PageState.cbSortField = field;
    PageState.cbSortDir   = 'desc';
  }
  // Reset sort indicators
  ['nama','sku','brand','kategori','totalQty','totalExc','totalInc','transaksi'].forEach(f => {
    const el = document.getElementById('cbsort-' + f);
    if (el) el.textContent = '↕';
  });
  const el = document.getElementById('cbsort-' + field);
  if (el) el.textContent = PageState.cbSortDir === 'asc' ? '↑' : '↓';
  PageState.cbFiltered.sort(_cbSortFn());
  PageState.cbPage = 1;
  cbRender();
}
function _cbSortFn() {
  return (a, b) => {
    let va, vb;
    if (PageState.cbSortField === 'brand') {
      va = (window.allBrands || []).find(x => x.id === a.brand_id)?.nama || '';
      vb = (window.allBrands || []).find(x => x.id === b.brand_id)?.nama || '';
    } else {
      va = a[PageState.cbSortField] ?? '';
      vb = b[PageState.cbSortField] ?? '';
    }
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return PageState.cbSortDir === 'asc' ? -1 : 1;
    if (va > vb) return PageState.cbSortDir === 'asc' ? 1 : -1;
    return 0;
  };
}

async function cbFetch() {
  const tbody = document.getElementById('cbTableBody');
  tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--muted)"><span class="spinner"></span> Memuat...</td></tr>`;
  document.getElementById('cbInfo').style.display = 'none';
  document.getElementById('cbPagin').style.display = 'none';

  try {
    const brand    = document.getElementById('cbFilterBrand').value;
    const dateFrom = document.getElementById('cbDateFrom').value;
    const dateTo   = document.getElementById('cbDateTo').value;

    let q = window._sb
      .from('riwayat_beli_items')
      .select('nama, sku, satuan, brand_id, qty, harga_exc_ppn, harga_inc_ppn, harga_satuan, riwayat_beli!inner(tanggal, status, brand_id)');

    if (brand)    q = q.eq('brand_id', brand);
    if (dateFrom) q = q.gte('riwayat_beli.tanggal', dateFrom);
    if (dateTo)   q = q.lte('riwayat_beli.tanggal', dateTo);

    const { data: rows, error } = await q;
    if (error) throw error;

    const valid = (rows || []).filter(r => r.riwayat_beli?.status !== 'batal');

    // Join kategori dari allBarang (match by sku or nama)
    const barangMap = {};
    (window.allBarang || []).forEach(b => {
      if (b.sku)  barangMap['sku:' + b.sku.toLowerCase()]   = b.kategori || '';
      barangMap['nama:' + (b.nama || '').toLowerCase()] = b.kategori || '';
    });

    const map = {};
    valid.forEach(r => {
      const key = `${(r.nama||'').toLowerCase()}|${r.sku||''}|${r.satuan||''}|${r.brand_id||''}`;
      if (!map[key]) {
        const kat = barangMap['sku:' + (r.sku||'').toLowerCase()]
                 || barangMap['nama:' + (r.nama||'').toLowerCase()]
                 || '';
        map[key] = {
          nama:      r.nama || '—',
          sku:       r.sku  || '',
          satuan:    r.satuan || '',
          brand_id:  r.brand_id || '',
          kategori:  kat,
          totalQty:  0,
          totalExc:  0,
          totalInc:  0,
          transaksi: 0,
        };
      }
      const qty = r.qty || 0;
      const exc = r.harga_exc_ppn || r.harga_satuan || 0;
      const inc = r.harga_inc_ppn || Math.round(exc * (1 + (window._ppnRate || 11) / 100));
      map[key].totalQty  += qty;
      map[key].totalExc  += qty * exc;
      map[key].totalInc  += qty * inc;
      map[key].transaksi += 1;
    });

    PageState.cbData = Object.values(map).sort((a, b) => b.totalExc - a.totalExc);
    cbApplySearch();

  } catch(e) {
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--danger)">Gagal memuat: ${e.message}</td></tr>`;
  }
}

function cbApplySearch() {
  const q    = (document.getElementById('cbSearch').value || '').toLowerCase().trim();
  const kat  = document.getElementById('cbFilterKategori').value;

  PageState.cbFiltered = PageState.cbData.filter(r => {
    const matchQ   = !q   || (r.nama||'').toLowerCase().includes(q) || (r.sku||'').toLowerCase().includes(q);
    const matchKat = !kat || r.kategori === kat;
    return matchQ && matchKat;
  });

  PageState.cbFiltered.sort(_cbSortFn());
  PageState.cbPage = 1;
  cbRender();
}

function cbRender() {
  const tbody = document.getElementById('cbTableBody');
  const total = PageState.cbFiltered.length;

  const info = document.getElementById('cbInfo');
  if (total > 0) {
    info.style.display = '';
    const q = (document.getElementById('cbSearch').value || '').trim();
    info.textContent = q
      ? `Ditemukan ${total} barang untuk "${q}"`
      : `Menampilkan ${total} barang`;
  } else {
    info.style.display = 'none';
  }

  if (!total) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state">
      <div class="empty-icon">🔍</div>
      <div class="empty-text">Tidak ada barang ditemukan</div>
    </div></td></tr>`;
    document.getElementById('cbPagin').style.display = 'none';
    return;
  }

  cbRenderFlat(tbody, total);
}

const _cbFmt    = v => 'Rp ' + Math.round(v).toLocaleString('id-ID');
const _cbFmtQty = v => v % 1 === 0 ? v : v.toFixed(2);

function cbRenderFlat(tbody, total) {
  const start = (PageState.cbPage - 1) * CB_PER_PAGE;
  const slice = PageState.cbFiltered.slice(start, start + CB_PER_PAGE);

  tbody.innerHTML = slice.map(r => {
    const brandNama = (window.allBrands || []).find(b => b.id === r.brand_id)?.nama || '—';
    return `<tr>
      <td style="font-weight:500">${r.nama}</td>
      <td class="td-cb-sku">${r.sku || '—'}</td>
      <td class="td-cb-satuan">${r.satuan || '—'}</td>
      <td><span class="badge badge-blue" >${brandNama}</span></td>
      <td class="td-cb-kat">${r.kategori || '—'}</td>
      <td style="text-align:right;font-family:var(--mono);font-weight:600">${_cbFmtQty(r.totalQty)}</td>
      <td style="text-align:right;font-family:var(--mono)">${_cbFmt(r.totalExc)}</td>
      <td style="text-align:right;font-family:var(--mono);color:var(--accent3)">${_cbFmt(r.totalInc)}</td>
      <td style="text-align:right;font-family:var(--mono);color:var(--muted)">${r.transaksi}x</td>
    </tr>`;
  }).join('');

  cbRenderPagin(total);
}

function cbRenderPagin(total) {
  const wrap  = document.getElementById('cbPagin');
  const info  = document.getElementById('cbPaginInfo');
  const pb    = document.getElementById('cbPaginBtns');
  const pages = Math.ceil(total / CB_PER_PAGE) || 1;

  wrap.style.display = pages <= 1 ? 'none' : '';
  info.textContent = `Menampilkan ${Math.min((PageState.cbPage-1)*CB_PER_PAGE+1,total||1)}–${Math.min(PageState.cbPage*CB_PER_PAGE,total)} dari ${total} barang`;
  pb.innerHTML = '';

  const add = (lbl, pg, dis, act) => {
    const b = document.createElement('button');
    b.className = 'page-btn' + (act ? ' active' : '');
    b.textContent = lbl; b.disabled = dis;
    b.onclick = () => cbGoPage(pg);
    pb.appendChild(b);
  };
  add('««', 1,     PageState.cbPage === 1,     false);
  add('‹',  PageState.cbPage - 1, PageState.cbPage === 1,     false);
  for (let p = Math.max(1, PageState.cbPage - 2); p <= Math.min(pages, PageState.cbPage + 2); p++)
    add(p, p, false, p === PageState.cbPage);
  add('›',  PageState.cbPage + 1, PageState.cbPage === pages, false);
  add('»»', pages, PageState.cbPage === pages, false);
}

function cbGoPage(p) {
  const pages = Math.ceil(PageState.cbFiltered.length / CB_PER_PAGE);
  if (p < 1 || p > pages) return;
  PageState.cbPage = p;
  cbRender();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function cbExport() {
  if (!PageState.cbFiltered.length) { showToast('Tidak ada data untuk diexport', 'error'); return; }
  showToast('Menyiapkan export...', 'success');
  try {
    const wb = XLSX.utils.book_new();
    const dateFrom = document.getElementById('cbDateFrom').value || 'semua';
    const dateTo   = document.getElementById('cbDateTo').value   || 'semua';

    const rows = [
      ['Nama Barang','SKU','Satuan','Brand','Kategori','Total Qty','Total Nilai (Exc PPN)','Total Nilai (Inc PPN)','Jumlah Transaksi']
    ];
    PageState.cbFiltered.forEach(r => {
      const brandNama = (window.allBrands || []).find(b => b.id === r.brand_id)?.nama || '—';
      rows.push([r.nama, r.sku||'', r.satuan||'', brandNama, r.kategori||'', r.totalQty, r.totalExc, r.totalInc, r.transaksi]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [28,14,10,16,14,10,20,20,16].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, 'Rekap Barang');
    const tgl = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `rekap_barang_${dateFrom}_sd_${dateTo}_${tgl}.xlsx`);
    showToast(`✓ Export ${PageState.cbFiltered.length} barang berhasil`, 'success');
  } catch(e) {
    showToast('Gagal export: ' + e.message, 'error');
  }
}


/* ── Expose ke window (dipanggil dari atribut HTML) ── */
window.cbInit         = cbInit;
window.cbFetch        = cbFetch;
window.cbOnSearch     = cbOnSearch;
window.cbToggleClear  = cbToggleClear;
window.cbClearSearch  = cbClearSearch;
window.cbApplySearch  = cbApplySearch;
window.cbSortBy       = cbSortBy;
window.cbGoPage       = cbGoPage;
window.cbExport       = cbExport;
