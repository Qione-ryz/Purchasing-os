/* ═══════════════════════════════════════════════════════
   harga-export.js — Export Excel untuk halaman Harga
   Depends on: window.brandMap,
               getTFiltered(), toIncPPN(), showToast()
   Requires: xlsx.js (dimuat di harga.html <head>)
   ═══════════════════════════════════════════════════════ */

function exportHarga() {
  const data = getTFiltered();
  if (!data.length) { showToast('Tidak ada data untuk diexport', 'error'); return; }

  const wb = XLSX.utils.book_new();

  /* ── Sheet 1: Semua riwayat harga (filtered) ── */
  const rows = [
    ['Tanggal', 'Nama Barang', 'SKU', 'Vendor', 'Brand', 'Qty', 'Harga (Exc PPN)', 'Harga (Inc PPN)', 'No. Faktur / Catatan', 'Sumber']
  ];
  data.forEach(r => {
    const brandNama = window.brandMap?.[r.brand_id] || r.brand_id || '—';
    const hargaExc  = r.harga     || 0;
    const hargaInc  = r.harga_inc || toIncPPN(hargaExc);
    rows.push([
      r.tanggal      || '',
      r.nama_barang  || '',
      r.sku          || '',
      r.vendor_nama  || '',
      brandNama,
      r.qty !== null ? r.qty : '',
      hargaExc,
      hargaInc,
      r.nomor_faktur || '',
      r.sumber       || ''
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [12, 22, 14, 20, 16, 8, 18, 18, 20, 12].map(w => ({ wch: w }));

  /* Format kolom harga sebagai number agar bisa dipakai formula Excel */
  const hargaCols = [6, 7]; // kolom Harga Exc dan Harga Inc (0-indexed)
  for (let rowIdx = 1; rowIdx <= data.length; rowIdx++) {
    hargaCols.forEach(colIdx => {
      const cell = ws[XLSX.utils.encode_cell({ r: rowIdx, c: colIdx })];
      if (cell && typeof cell.v === 'number') { cell.z = '#,##0'; cell.t = 'n'; }
    });
  }
  XLSX.utils.book_append_sheet(wb, ws, 'Riwayat Harga');

  /* ── Sheet 2: Perbandingan vendor (hanya jika tepat satu barang dipilih) ──
     Menggunakan getTFiltered() agar data sudah sesuai semua filter aktif,
     termasuk filter _selectedBarangs, periode, vendor, dan brand.           */
  const selId = window.PageState?.selectedBarangId || window.selectedBarangId;
  if (selId) {
    /* Ambil dari data yang sudah difilter (Sheet 1) bukan dari filteredData mentah */
    const barangData = data.filter(r => r.barang_id === selId);

    if (barangData.length) {
      const byVendor = {};
      barangData.forEach(r => {
        if (!byVendor[r.vendor_nama]) byVendor[r.vendor_nama] = [];
        byVendor[r.vendor_nama].push(r);
      });

      const bandingRows = [['Vendor', 'Harga Terakhir (Inc)', 'Harga Rata-rata (Inc)', 'Jumlah Catatan']];
      Object.entries(byVendor).forEach(([nama, vRows]) => {
        /* Perbaikan: gunakan nama berbeda (getInc) agar tidak shadow outer variable */
        const getInc = row => row.harga_inc || toIncPPN(row.harga);
        const latest = getInc(vRows[0]);
        const avg    = Math.round(vRows.reduce((s, row) => s + getInc(row), 0) / vRows.length);
        bandingRows.push([nama, latest, avg, vRows.length]);
      });

      const ws2 = XLSX.utils.aoa_to_sheet(bandingRows);
      ws2['!cols'] = [22, 20, 22, 16].map(w => ({ wch: w }));

      /* Format kolom harga di Sheet 2 */
      const hargaCols2 = [1, 2]; // Harga Terakhir & Rata-rata
      for (let rowIdx = 1; rowIdx < bandingRows.length; rowIdx++) {
        hargaCols2.forEach(colIdx => {
          const cell = ws2[XLSX.utils.encode_cell({ r: rowIdx, c: colIdx })];
          if (cell && typeof cell.v === 'number') { cell.z = '#,##0'; cell.t = 'n'; }
        });
      }

      XLSX.utils.book_append_sheet(wb, ws2, 'Perbandingan Vendor');
    }
  }

  const tgl = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `analisis_harga_${tgl}.xlsx`);
  showToast(`✓ Export ${data.length} catatan berhasil`, 'success');
}

/* ── EXPOSE KE WINDOW ── */
window.exportHarga = exportHarga;
