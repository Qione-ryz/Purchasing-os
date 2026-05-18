/**
 * fifo-sync.js
 * Logika distribusi FIFO untuk Order Masuk.
 *
 * Dependensi (harus tersedia di window sebelum file ini dijalankan):
 *   - window._sb   : Supabase client
 *
 * Ekspor ke window:
 *   - window._inBatch(table, selectCols, filterCol, ids) → Promise<row[]>
 *   - window._runFifoSync(barangIds)                     → Promise<{ fifoResultMap, beliTotalPerBarang, allCompetingItems }>
 */

(function (global) {
  "use strict";

const _IN_BATCH_SIZE = 100; // max IDs per request agar URL tetap pendek

async function _inBatch(table, selectCols, filterCol, ids) {
  if (!ids || ids.length === 0) return [];
  const results = [];
  for (let i = 0; i < ids.length; i += _IN_BATCH_SIZE) {
    const batch = ids.slice(i, i + _IN_BATCH_SIZE);
    const { data, error } = await _sb.from(table).select(selectCols).in(filterCol, batch);
    if (error) console.warn(`[_inBatch] ${table} error:`, error.code, error.message);
    if (data) results.push(...data);
  }
  return results;
}

// ═══════════════════════════════════════════════
// FIFO SYNC — bisa dipanggil dari loadAll maupun openDetail
// ═══════════════════════════════════════════════
// Menerima daftar barangIds yang perlu disync.
// Mengembalikan fifoResultMap {order_item_id: qty_terpenuhi}
// Mengupdate DB di background untuk item yang berubah.
async function _runFifoSync(barangIds) {
  if (!barangIds || barangIds.length === 0) return {};

  // 1. Ambil semua competing order_items — pakai batch agar URL tidak terlalu panjang
  let _competingRaw = await _inBatch(
    'order_items',
    'id, order_id, barang_id, qty_order, qty_terpenuhi, faktor_konversi, status_item, is_custom',
    'barang_id', barangIds
  );
  // Fallback jika kolom opsional belum ada (error akan di-warn oleh _inBatch)
  if (!_competingRaw.length) {
    _competingRaw = await _inBatch(
      'order_items',
      'id, order_id, barang_id, qty_order, qty_terpenuhi, faktor_konversi',
      'barang_id', barangIds
    );
  }

  // Filter di JS — agar tidak bergantung kolom status_item/is_custom ada di DB sebagai filter
  const _competingFiltered = (_competingRaw || []).filter(ci =>
    !ci.is_custom && (ci.status_item || 'pending') !== 'cancelled'
  );

  // Fetch data orders (created_at, brand_id) untuk setiap order_id unik — pakai batch
  const uniqueOrderIds = [...new Set((_competingFiltered || []).map(ci => ci.order_id).filter(Boolean))];
  let _ordersMap = {};
  if (uniqueOrderIds.length > 0) {
    const _ordersRaw = await _inBatch('orders', 'id, created_at, brand_id, status', 'id', uniqueOrderIds);
    // Exclude archived — order arsip qty_terpenuhi-nya tidak di-load, jangan ikut kompetisi FIFO
    _ordersRaw.filter(o => o.status !== 'archived').forEach(o => { _ordersMap[o.id] = o; });
  }

  // Gabungkan: simulasi orders!inner
  const allCompetingItems = (_competingFiltered || []).map(ci => ({
    ...ci,
    orders: _ordersMap[ci.order_id] || null,
  })).filter(ci => ci.orders !== null);

  // 2. Cek item mana yang sudah punya record riwayat_beli_items dengan order_item_id — pakai batch
  const allItemIds = (allCompetingItems || []).map(ci => ci.id);
  let manuallyLinkedItemIds = new Set();
  if (allItemIds.length > 0) {
    const linkedRows = await _inBatch('riwayat_beli_items', 'order_item_id', 'order_item_id', allItemIds);
    linkedRows.forEach(r => { if (r.order_item_id) manuallyLinkedItemIds.add(r.order_item_id); });
  }

  // Item yang sudah diinput manual ATAU sudah selesai manual dikeluarkan dari kompetisi FIFO
  // Jika diselesaikan manual tanpa riwayat beli terkunci pun, tetap tidak boleh rebut slot antrian
  const fifoCompetitors = (allCompetingItems || []).filter(ci =>
    !manuallyLinkedItemIds.has(ci.id) && (ci.status_item || 'pending') !== 'selesai'
  );

  // 3. Ambil total qty pembelian FIFO — pakai batch
  const _beliItemsRawAll = await _inBatch(
    'riwayat_beli_items', 'barang_id, qty, order_item_id, beli_id', 'barang_id', barangIds
  );
  // Filter order_item_id null di JS
  const _beliItemsRaw = _beliItemsRawAll.filter(bi => bi.order_item_id === null || bi.order_item_id === undefined);

  // Fetch header riwayat_beli — pakai batch
  const uniqueBeliIds = [...new Set((_beliItemsRaw || []).map(bi => bi.beli_id).filter(Boolean))];
  let _beliHeaderMap = {};
  if (uniqueBeliIds.length > 0) {
    const _beliHeaders = await _inBatch('riwayat_beli', 'id, tanggal, status, brand_id', 'id', uniqueBeliIds);
    // Filter status selesai di JS
    _beliHeaders
      .filter(h => h.status === 'selesai')
      .forEach(h => { _beliHeaderMap[h.id] = h; });
  }

  // Gabungkan: simulasi riwayat_beli!inner, filter hanya status selesai
  const allBeliItems = (_beliItemsRaw || [])
    .map(bi => ({ ...bi, riwayat_beli: _beliHeaderMap[bi.beli_id] || null }))
    .filter(bi => bi.riwayat_beli !== null);

  // beliTotalPerBarang dipakai UI untuk tahu apakah ada data beli sama sekali
  // (menentukan apakah progress bar dirender atau tidak)
  const beliTotalPerBarang = {};
  (allBeliItems || []).forEach(bi => {
    if (!bi.barang_id || !bi.qty) return;
    beliTotalPerBarang[bi.barang_id] = (beliTotalPerBarang[bi.barang_id] || 0) + bi.qty;
  });

  // 4. FIFO distribution — satu pembelian untuk satu order (antrian)
  //
  // Aturan baru:
  // - Pembelian hanya bisa memenuhi order yang created_at-nya <= tanggal pembelian
  // - Satu record pembelian dikunci ke SATU order (tidak dibagi ke banyak order)
  // - Urutan: order terlama yang belum terpenuhi mendapat pembelian pertama,
  //   order berikutnya mendapat pembelian berikutnya, dst.
  // - Jika qty pembelian > kebutuhan order, sisa qty TIDAK mengalir ke order lain —
  //   order lain harus menunggu pembelian berikutnya.
  // - Jika qty pembelian < kebutuhan order, order tersebut hanya terpenuhi sebagian
  //   dan sisanya menunggu pembelian berikutnya.
  const fifoResultMap = {};

  const barangBrandKeys = [...new Set(
    fifoCompetitors.map(ci => ci.barang_id + '::' + (ci.orders?.brand_id || ''))
  )];

  for (const key of barangBrandKeys) {
    const [barangId, brandId] = key.split('::');

    // Semua pembelian untuk barang+brand ini, urut dari terlama ke terbaru
    const beliItems = (allBeliItems || [])
      .filter(bi => {
        if (!bi.barang_id || !bi.qty) return false;
        return bi.barang_id === barangId && (bi.riwayat_beli?.brand_id || '') === brandId;
      })
      .sort((a, b) => {
        const tA = a.riwayat_beli?.tanggal || '', tB = b.riwayat_beli?.tanggal || '';
        return tA < tB ? -1 : tA > tB ? 1 : 0;
      });

    // Order yang bersaing, urut dari terlama ke terbaru
    const competitors = fifoCompetitors
      .filter(ci => ci.barang_id === barangId && (ci.orders?.brand_id || '') === brandId)
      .sort((a, b) => {
        const tA = a.orders?.created_at || '', tB = b.orders?.created_at || '';
        return tA < tB ? -1 : tA > tB ? 1 : 0;
      });

    if (competitors.length === 0) continue;

    // Inisialisasi hasil: selesai → kunci di qty_terpenuhi; ordered → pakai qty_terpenuhi
    // yang sudah ada (dari pembelian sebelumnya) agar tidak dialokasikan ulang oleh FIFO;
    // pending/lainnya → mulai dari 0.
    const hasil = {}; // { ci.id: qty_terpenuhi }
    for (const ci of competitors) {
      const kebutuhan = (ci.qty_order || 0) * (ci.faktor_konversi || 1);
      if ((ci.status_item || 'pending') === 'selesai') {
        hasil[ci.id] = Math.min(ci.qty_terpenuhi || 0, kebutuhan);
      } else {
        // pending & ordered: keduanya mulai dari 0, antrian FIFO yang menentukan
        hasil[ci.id] = 0;
      }
    }

    // Antrian order yang masih butuh stok (belum selesai, urut terlama ke terbaru)
    // Gunakan pointer index agar bisa lanjut dari posisi terakhir
    let orderQueueIdx = 0;
    const orderQueue = competitors.filter(ci => (ci.status_item || 'pending') !== 'selesai');

    // Distribusi: setiap pembelian → dialokasikan ke order terdepan dalam antrian
    // yang tanggal order-nya <= tanggal pembelian
    for (const bi of beliItems) {
      const beliTgl = bi.riwayat_beli?.tanggal || '';
      let sisaBeli = bi.qty || 0;

      // Cari order terdepan di antrian yang eligible (created_at <= beliTgl)
      // dan masih punya kebutuhan yang belum terpenuhi
      while (orderQueueIdx < orderQueue.length && sisaBeli > 0) {
        const ci = orderQueue[orderQueueIdx];
        const orderTgl = (ci.orders?.created_at || '').substring(0, 10);

        // Order eligible jika created_at-nya <= tanggal pembelian (same-day boleh)
        // Urutan same-day ditentukan oleh created_at timestamp penuh (competitors sudah di-sort)
        if (orderTgl > beliTgl) break;

        const kebutuhan = (ci.qty_order || 0) * (ci.faktor_konversi || 1);
        const sudahDapat = hasil[ci.id] || 0;
        const sisaButuh = kebutuhan - sudahDapat;

        if (sisaButuh <= 0) {
          // Order ini sudah penuh → lanjut ke order berikutnya
          orderQueueIdx++;
          continue;
        }

        // Satu pembelian = satu order. Alokasikan ke order ini, sisa qty TIDAK nyebrang ke order lain.
        const dialokasikan = Math.min(sisaButuh, sisaBeli);
        hasil[ci.id] = sudahDapat + dialokasikan;

        // Jika order sudah penuh, maju pointer ke order berikutnya
        // (pembelian BERIKUTNYA yang akan mulai dari order berikutnya)
        if (hasil[ci.id] >= kebutuhan) {
          orderQueueIdx++;
        }
        // Selalu break setelah alokasi — sisa qty dibuang, order berikutnya tunggu pembelian baru
        break;
      }
      // Sisa qty pembelian yang tidak terserap (tidak ada order eligible) → diabaikan
    }

    // Tulis hasil ke fifoResultMap
    for (const ci of competitors) {
      const statusCi = ci.status_item || 'pending';
      if (statusCi === 'selesai') {
        fifoResultMap[ci.id] = hasil[ci.id];
      } else {
        // pending & ordered: undefined jika belum ada pembelian eligible (progress bar tidak dirender)
        const adaBeli = beliItems.some(bi =>
          (bi.riwayat_beli?.tanggal || '') >= (ci.orders?.created_at || '').substring(0, 10)
        );
        fifoResultMap[ci.id] = adaBeli ? hasil[ci.id] : undefined;
      }
    }
  }

  // 5. Update DB di background untuk item FIFO yang qty-nya berubah
  const adaData = Object.keys(beliTotalPerBarang).length > 0;
  if (adaData) {
    fifoCompetitors.forEach(ci => {
      if ((ci.status_item || 'pending') === 'selesai') return;
      const newQty = fifoResultMap[ci.id];
      if (newQty === undefined) return;
      if (newQty === (ci.qty_terpenuhi || 0)) return; // tidak ada perubahan
      _sb.from('order_items')
        .update({ qty_terpenuhi: newQty })
        .eq('id', ci.id)
        .then(() => {})
        .catch(e => console.warn('fifo update failed:', ci.id, e));
    });
  }

  return { fifoResultMap, beliTotalPerBarang, allCompetingItems: allCompetingItems || [] };
}

  // Expose ke global agar ordermasuk.html bisa memanggil langsung
  global._inBatch     = _inBatch;
  global._runFifoSync = _runFifoSync;

})(window);
