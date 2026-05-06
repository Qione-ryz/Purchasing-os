/* ════════════════════════════════════════════
   barang-export.js
   Export Excel & PDF untuk halaman Barang
   Bergantung pada: window._sb, window._ppnRate,
                    window.allBrands, showToast
   Membutuhkan: xlsx.js (sudah di-load di barang.html)
════════════════════════════════════════════ */

/* ══ EXPORT ══ */
function toggleExportMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('exportMenu');
  const isOpen = menu.classList.contains('open');
  closeExportMenu();
  if (!isOpen) {
    menu.classList.add('open');
    setTimeout(() => document.addEventListener('click', closeExportMenu), 0);
  }
}
function closeExportMenu() {
  document.getElementById('exportMenu')?.classList.remove('open');
  document.removeEventListener('click', closeExportMenu);
}

async function _fetchAllFiltered() {
  const search = document.getElementById('searchInput').value.toLowerCase().trim();
  const brand  = document.getElementById('filterBrand').value;
  const kat    = document.getElementById('filterKategori').value;
  const sat    = document.getElementById('filterSatuan').value;

  let q = window._sb.from('barang').select('*, barang_brands(brand_id)').order('nama');
  if (kat) q = q.eq('kategori', kat);
  if (sat) q = q.eq('satuan', sat);
  const { data: allRaw } = await q;
  let all = (allRaw || []).map(b => ({
    ...b,
    brand_ids: (b.barang_brands||[]).map(x=>x.brand_id),
    brand_id: (b.barang_brands||[])[0]?.brand_id||''
  }));
  if (brand)  all = all.filter(b => (b.brand_ids||[]).includes(brand));
  if (search) all = all.filter(b =>
    (b.nama||'').toLowerCase().includes(search) ||
    (b.sku||'').toLowerCase().includes(search) ||
    (b.deskripsi||'').toLowerCase().includes(search)
  );
  return all;
}

function _getBrandName(id) {
  return (window.allBrands||[]).find(b=>b.id===id)?.nama || id;
}

async function _fetchHargaMap(barangIds) {
  /* Fetch harga terakhir per barang_id → { id: { exc, inc } } */
  const result = {};
  const ppn = window._ppnRate || 11;
  const calcExc = h => {
    if (h.harga_exc_ppn) return h.harga_exc_ppn;
    if (h.harga_inc_ppn) return Math.round(h.harga_inc_ppn / (1 + ppn/100));
    if (h.harga) return h.ppn_included ? Math.round(h.harga / (1 + ppn/100)) : h.harga;
    return 0;
  };
  const CHUNK = 50;
  for (let i = 0; i < barangIds.length; i += CHUNK) {
    const chunk = barangIds.slice(i, i + CHUNK);
    const { data: rows } = await window._sb
      .from('riwayat_harga')
      .select('barang_id, harga, harga_exc_ppn, harga_inc_ppn, ppn_included, tanggal')
      .in('barang_id', chunk)
      .order('tanggal', { ascending: false });
    (rows || []).forEach(h => {
      if (!h.barang_id || result[h.barang_id]) return;
      const exc = calcExc(h);
      const inc = h.harga_inc_ppn || (exc ? Math.round(exc * (1 + ppn/100)) : 0);
      if (exc > 0) result[h.barang_id] = { exc, inc };
    });
  }
  return result;
}

async function exportBarangExcel() {
  showToast('Menyiapkan export...', 'success');
  const data = await _fetchAllFiltered();
  if (!data.length) return showToast('Tidak ada data untuk diexport', 'error');

  const ppn = window._ppnRate || 11;
  const hargaMap = await _fetchHargaMap(data.map(b => b.id));

  const rows = [
    ['Nama Barang', 'SKU', 'Kategori', 'Satuan', 'Brand / Store', `Harga Satuan Exc PPN`, `Harga Satuan Inc PPN (${ppn}%)`, 'Deskripsi']
  ];
  data.forEach(b => {
    const brandNames = (Array.isArray(b.brand_ids)?b.brand_ids:[]).map(_getBrandName).join(', ');
    const h = hargaMap[b.id];
    rows.push([
      b.nama||'', b.sku||'', b.kategori||'', b.satuan||'', brandNames,
      h ? h.exc : '', h ? h.inc : '',
      b.deskripsi||''
    ]);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [28, 14, 16, 12, 22, 18, 18, 36].map(w=>({wch:w}));

  /* Format kolom harga sebagai number (Rp) */
  const hargaCols = [5, 6]; // kolom F dan G (0-indexed)
  for (let r = 1; r <= data.length; r++) {
    hargaCols.forEach(c => {
      const cell = ws[XLSX.utils.encode_cell({r, c})];
      if (cell && typeof cell.v === 'number') {
        cell.z = '#,##0';
        cell.t = 'n';
      }
    });
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Daftar Barang');
  XLSX.writeFile(wb, `barang_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast(`✓ Export ${data.length} barang berhasil`, 'success');
}

async function exportBarangPDF() {
  showToast('Menyiapkan data...', 'success');
  const data = await _fetchAllFiltered();
  if (!data.length) return showToast('Tidak ada data untuk diexport', 'error');

  const ppn = window._ppnRate || 11;
  const hargaMap = await _fetchHargaMap(data.map(b => b.id));

  const filterInfo = [];
  const fBrand  = document.getElementById('filterBrand');
  const fKat    = document.getElementById('filterKategori');
  const fSat    = document.getElementById('filterSatuan');
  const fSearch = document.getElementById('searchInput');
  if (fBrand.value)  filterInfo.push('Brand: ' + fBrand.options[fBrand.selectedIndex].text);
  if (fKat.value)    filterInfo.push('Kategori: ' + fKat.options[fKat.selectedIndex].text);
  if (fSat.value)    filterInfo.push('Satuan: ' + fSat.value);
  if (fSearch.value) filterInfo.push('Pencarian: "' + fSearch.value + '"');

  const fmt = n => n ? 'Rp ' + Math.round(n).toLocaleString('id-ID') : '—';

  const rows = data.map((b,i) => {
    const brandNames = (Array.isArray(b.brand_ids)?b.brand_ids:[]).map(_getBrandName).join(', ');
    const h = hargaMap[b.id];
    return `<tr>
      <td style="text-align:center;color:#888">${i+1}</td>
      <td><strong>${b.nama||'—'}</strong>${b.sku?`<br><span style="color:#888;font-size:11px;font-family:monospace">${b.sku}</span>`:''}</td>
      <td>${b.kategori||'—'}</td>
      <td style="text-align:center">${b.satuan||'—'}</td>
      <td>${brandNames||'—'}</td>
      <td style="text-align:right;font-family:monospace;font-size:12px">${fmt(h?.exc)}</td>
      <td style="text-align:right;font-family:monospace;font-size:12px;color:#166534">${fmt(h?.inc)}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">
  <title>Daftar Barang — PurchaseOS</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #1a1a1a; padding: 28px; }
    h1 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
    .meta { color: #666; font-size: 11px; margin-bottom: 6px; }
    .filters { font-size: 11px; color: #2563eb; margin-bottom: 16px; font-style: italic; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #1e293b; color: #fff; font-size: 10px; font-weight: 600; padding: 8px 9px; text-align: left; letter-spacing: 0.5px; text-transform: uppercase; }
    td { padding: 8px 9px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fafc; }
    .footer { margin-top: 18px; font-size: 10px; color: #888; text-align: right; }
    @media print { body { padding: 14px; } }
  </style></head><body>
  <h1>Daftar Barang — PurchaseOS</h1>
  <div class="meta">Dicetak: ${new Date().toLocaleString('id-ID')} &nbsp;·&nbsp; Total: ${data.length} barang &nbsp;·&nbsp; PPN ${ppn}%</div>
  ${filterInfo.length ? `<div class="filters">Filter aktif: ${filterInfo.join(' | ')}</div>` : ''}
  <table>
    <thead><tr>
      <th>#</th><th>Nama Barang / SKU</th><th>Kategori</th>
      <th style="text-align:center">Satuan</th><th>Brand</th>
      <th style="text-align:right">Harga Exc PPN</th>
      <th style="text-align:right">Harga Inc PPN (${ppn}%)</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">PurchaseOS · ${new Date().toLocaleDateString('id-ID',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
  <script>window.onload=()=>window.print()<\/script>
  </body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

window.toggleExportMenu  = toggleExportMenu;
window.closeExportMenu   = closeExportMenu;
window.exportBarangExcel = exportBarangExcel;
window.exportBarangPDF   = exportBarangPDF;
