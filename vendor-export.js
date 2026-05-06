/* ═══════════════════════════════════════════════════════
   vendor-export.js — Export Excel & PDF untuk halaman Vendor
   Depends on: window._sb, window._ppnRate, window.allBrands,
               getFiltered(), getBrandName(), showToast()
   ═══════════════════════════════════════════════════════ */

/* ── EXPORT MENU TOGGLE ── */
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

/* ── EXPORT EXCEL ── */
async function exportVendorExcel() {
  const data = getFiltered();
  if (!data.length) return showToast('Tidak ada data untuk diexport', 'error');
  showToast('Menyiapkan export...', 'success');

  const ppn       = window._ppnRate || 11;
  const terminMap = { cash:'Tunai', net7:'Net 7 hari', net14:'Net 14 hari', net30:'Net 30 hari', net60:'Net 60 hari' };

  /* Sheet 1: Daftar Vendor */
  const sheet1 = [
    ['Nama Vendor','Kode','Brand','Kategori','PIC / Kontak','Telepon','Email','Website','Kota','Provinsi','Alamat','NPWP','Termin Pembayaran','Catatan','Status']
  ];
  data.forEach(v => {
    const brandNames = (Array.isArray(v.brand_ids) ? v.brand_ids : v.brand_id ? [v.brand_id] : [])
      .map(id => getBrandName(id)).join(', ');
    sheet1.push([
      v.nama||'', v.kode||'', brandNames, v.kategori||'',
      v.pic||'', v.telp||v.telepon||'', v.email||'', v.website||'',
      v.kota||'', v.provinsi||'', v.alamat||'', v.npwp||'',
      terminMap[v.termin]||v.termin||'', v.catatan||'',
      v.aktif!==false ? 'Aktif' : 'Non-Aktif'
    ]);
  });

  /* Sheet 2: Harga Satuan per Vendor per Barang (dari riwayat_harga) */
  const sheet2 = [
    ['Nama Vendor', 'Nama Barang', 'SKU', 'Satuan', `Harga Exc PPN`, `Harga Inc PPN (${ppn}%)`, 'Tanggal Harga Terakhir']
  ];

  try {
    const vendorIds = data.map(v => v.id);
    const calcExc = h => {
      if (h.harga_exc_ppn) return h.harga_exc_ppn;
      if (h.harga_inc_ppn) return Math.round(h.harga_inc_ppn / (1 + ppn/100));
      if (h.harga) return h.ppn_included ? Math.round(h.harga / (1 + ppn/100)) : h.harga;
      return 0;
    };

    const CHUNK = 30;
    const hargaPerVendor = {};
    for (let i = 0; i < vendorIds.length; i += CHUNK) {
      const chunk = vendorIds.slice(i, i + CHUNK);
      const { data: rows } = await window._sb
        .from('riwayat_harga')
        .select('vendor_id, barang_id, harga, harga_exc_ppn, harga_inc_ppn, ppn_included, tanggal')
        .in('vendor_id', chunk)
        .order('tanggal', { ascending: false });
      (rows || []).forEach(h => {
        if (!h.vendor_id || !h.barang_id) return;
        if (!hargaPerVendor[h.vendor_id]) hargaPerVendor[h.vendor_id] = {};
        if (hargaPerVendor[h.vendor_id][h.barang_id]) return; // ambil terbaru saja
        const exc = calcExc(h);
        const inc = h.harga_inc_ppn || (exc ? Math.round(exc * (1 + ppn/100)) : 0);
        if (exc > 0) hargaPerVendor[h.vendor_id][h.barang_id] = { exc, inc, tgl: h.tanggal };
      });
    }

    const barangMap = {};
    (window.allBarang || []).forEach(b => { barangMap[b.id] = b; });

    data.forEach(v => {
      const vHarga = hargaPerVendor[v.id] || {};
      Object.entries(vHarga).forEach(([barangId, h]) => {
        const b = barangMap[barangId];
        sheet2.push([
          v.nama||'',
          b?.nama||barangId,
          b?.sku||'',
          b?.satuan||'',
          h.exc,
          h.inc,
          h.tgl||''
        ]);
      });
    });
  } catch(e) {
    console.warn('Gagal fetch harga vendor:', e);
  }

  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.aoa_to_sheet(sheet1);
  ws1['!cols'] = [22,12,18,16,18,16,24,22,14,16,28,16,14,24,10].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws1, 'Daftar Vendor');

  if (sheet2.length > 1) {
    const ws2 = XLSX.utils.aoa_to_sheet(sheet2);
    ws2['!cols'] = [22,26,14,12,16,16,14].map(w => ({ wch: w }));
    const hargaCols = [4, 5];
    for (let r = 1; r < sheet2.length; r++) {
      hargaCols.forEach(c => {
        const cell = ws2[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === 'number') { cell.z = '#,##0'; cell.t = 'n'; }
      });
    }
    XLSX.utils.book_append_sheet(wb, ws2, 'Harga Satuan per Vendor');
  }

  XLSX.writeFile(wb, `vendor_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast(`✓ Export ${data.length} vendor berhasil`, 'success');
}

/* ── EXPORT PDF ── */
function exportVendorPDF() {
  const data = getFiltered();
  if (!data.length) return showToast('Tidak ada data untuk diexport', 'error');

  const terminMap  = { cash:'Tunai', net7:'Net 7 hari', net14:'Net 14 hari', net30:'Net 30 hari', net60:'Net 60 hari' };
  const filterInfo = [];
  const fBrand  = document.getElementById('filterBrand');
  const fStatus = document.getElementById('filterStatus');
  const fKota   = document.getElementById('filterKota');
  const fSearch = document.getElementById('searchInput');
  if (fBrand.value)  filterInfo.push('Brand: '      + fBrand.options[fBrand.selectedIndex].text);
  if (fStatus.value) filterInfo.push('Status: '     + fStatus.options[fStatus.selectedIndex].text);
  if (fKota.value)   filterInfo.push('Kota: '       + fKota.value);
  if (fSearch.value) filterInfo.push('Pencarian: "' + fSearch.value + '"');

  const rows = data.map((v, i) => {
    const brandNames = (Array.isArray(v.brand_ids) ? v.brand_ids : v.brand_id ? [v.brand_id] : [])
      .map(id => getBrandName(id)).join(', ');
    const aktif = v.aktif !== false;
    return `<tr>
      <td style="text-align:center;color:#888">${i+1}</td>
      <td><strong>${v.nama||'—'}</strong>${v.kategori ? `<br><span style="color:#888;font-size:11px">${v.kategori}</span>` : ''}</td>
      <td style="font-family:monospace;font-size:12px;color:#2563eb">${v.kode||'—'}</td>
      <td>${brandNames||'—'}</td>
      <td>${[v.kota,v.provinsi].filter(Boolean).join(', ')||'—'}</td>
      <td>${v.pic ? v.pic+'<br>' : ''}${v.telp||v.telepon ? `<span style="color:#555;font-size:12px">${v.telp||v.telepon}</span>` : ''}${v.email ? `<br><a href="mailto:${v.email}" style="color:#2563eb;font-size:12px">${v.email}</a>` : ''}</td>
      <td><span style="background:${aktif?'#dcfce7':'#fee2e2'};color:${aktif?'#166534':'#991b1b'};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">${aktif?'Aktif':'Non-Aktif'}</span></td>
      <td style="font-size:12px">${terminMap[v.termin]||v.termin||'—'}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">
  <title>Daftar Vendor — PurchaseOS</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #1a1a1a; padding: 32px; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
    .meta { color: #666; font-size: 12px; margin-bottom: 6px; }
    .filters { font-size: 11px; color: #2563eb; margin-bottom: 18px; font-style: italic; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #1e293b; color: #fff; font-size: 11px; font-weight: 600; padding: 9px 10px; text-align: left; letter-spacing: 0.5px; text-transform: uppercase; }
    td { padding: 9px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fafc; }
    .footer { margin-top: 20px; font-size: 11px; color: #888; text-align: right; }
    @media print { body { padding: 16px; } }
  </style></head><body>
  <h1>Daftar Vendor — PurchaseOS</h1>
  <div class="meta">Dicetak: ${new Date().toLocaleString('id-ID')} &nbsp;·&nbsp; Total: ${data.length} vendor</div>
  ${filterInfo.length ? `<div class="filters">Filter aktif: ${filterInfo.join(' | ')}</div>` : ''}
  <table>
    <thead><tr>
      <th>#</th><th>Nama Vendor</th><th>Kode</th><th>Brand</th>
      <th>Kota</th><th>Kontak</th><th>Status</th><th>Termin</th>
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

/* ── EXPOSE KE WINDOW ── */
window.toggleExportMenu  = toggleExportMenu;
window.closeExportMenu   = closeExportMenu;
window.exportVendorExcel = exportVendorExcel;
window.exportVendorPDF   = exportVendorPDF;
