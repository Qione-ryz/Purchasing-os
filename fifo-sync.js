/**
 * fifo-sync.js
 * Logika distribusi FIFO untuk Order Masuk.
 *
 * Dependensi (harus tersedia di window sebelum file ini dijalankan):
 *   - window._sb   : Supabase client
 *
 * Ekspor ke window:
 *   - window._inBatch(table, selectCols, filterCol, ids) → Promise<row[]>
 *   - window._runFifoSync(barangIds, opts)               → Promise<{ fifoResultMap, beliTotalPerBarang, allCompetingItems }>
 *   - window._invalidateFifoCache(barangIds)             → void   (panggil setelah submitBeli / selesaikan item)
 */

(function (global) {
  "use strict";

const _IN_BATCH_SIZE = 100;

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
// CACHE — mencegah kalkulasi ulang bila data tidak berubah
// ═══════════════════════════════════════════════
// Cache disimpan per-barang_id agar invalidasi bisa surgical.
// Struktur:
//   _fifoCache.beli[barang_id]      = hash string dari semua beli items barang tsb
//   _fifoCache.result[barang_id]    = { [order_item_id]: qty_terpenuhi }
//   _fifoCache.beliTotal[barang_id] = total qty beli
//   _fifoCache.competing[barang_id] = allCompetingItems slice untuk barang tsb
//
// Saat _invalidateFifoCache(ids) dipanggil → hapus cache untuk barang tsb saja.
// Barang lain di request yang sama tetap pakai cache → tidak ada full reset.

const _fifoCache = {
  beli:      {},  // { barang_id: hashString }
  result:    {},  // { barang_id: { item_id: qty } }
  beliTotal: {},  // { barang_id: totalQty }
  competing: {},  // { barang_id: allCompetingItems[] }
};

// Hash ringan: sort beli_id:qty|tanggal → join
function _beliHash(beliItems) {
  return beliItems
    .map(bi => `${bi.beli_id}:${bi.qty}:${bi.riwayat_beli?.tanggal||''}`)
    .sort()
    .join('|');
}

// Panggil setelah data beli berubah (submitBeli, batalkan, dll)
// Jika barangIds tidak diberikan → invalidate semua
function _invalidateFifoCache(barangIds) {
  if (!barangIds || barangIds.length === 0) {
    // Full invalidation
    _fifoCache.beli      = {};
    _fifoCache.result    = {};
    _fifoCache.beliTotal = {};
    _fifoCache.competing = {};
    // FIX #1: clear in-memory selesai set juga agar item yang beli-nya dihapus
    // bisa masuk kembali sebagai competitor di run berikutnya
    if (global._fifoSelesaiSet) global._fifoSelesaiSet.clear();
    return;
  }
  barangIds.forEach(id => {
    delete _fifoCache.beli[id];
    delete _fifoCache.result[id];
    delete _fifoCache.beliTotal[id];
    delete _fifoCache.competing[id];
  });
  // FIX #1: Hapus item dari _fifoSelesaiSet yang barang_id-nya di-invalidate.
  // Perlu map item_id → barang_id. Kita scan dari cache result yang tersisa
  // (sudah terhapus di atas, jadi tidak bisa langsung).
  // Solusi: simpan mapping item_id → barang_id di cache terpisah.
  if (global._fifoSelesaiSet && global._fifoItemBarangMap) {
    for (const [itemId, barangId] of global._fifoItemBarangMap.entries()) {
      if (barangIds.includes(barangId)) {
        global._fifoSelesaiSet.delete(itemId);
        global._fifoItemBarangMap.delete(itemId);
      }
    }
  }
}

// ═══════════════════════════════════════════════
// FIFO SYNC
// opts.force = true  → skip cache untuk semua barangIds (misal setelah loadAll fresh)
// ═══════════════════════════════════════════════
async function _runFifoSync(barangIds, opts) {
  if (!barangIds || barangIds.length === 0) return { fifoResultMap: {}, beliTotalPerBarang: {}, allCompetingItems: [] };
  const forceAll = opts?.force === true;

  // 1. Ambil semua competing order_items
  let _competingRaw = await _inBatch(
    'order_items',
    'id, order_id, barang_id, qty_order, qty_terpenuhi, faktor_konversi, status_item, is_custom',
    'barang_id', barangIds
  );
  if (!_competingRaw.length) {
    _competingRaw = await _inBatch(
      'order_items',
      'id, order_id, barang_id, qty_order, qty_terpenuhi, faktor_konversi',
      'barang_id', barangIds
    );
  }

  const _competingFiltered = (_competingRaw || []).filter(ci =>
    !ci.is_custom && (ci.status_item || 'pending') !== 'cancelled'
  );

  const uniqueOrderIds = [...new Set((_competingFiltered || []).map(ci => ci.order_id).filter(Boolean))];
  let _ordersMap = {};
  if (uniqueOrderIds.length > 0) {
    const _ordersRaw = await _inBatch('orders', 'id, created_at, brand_id, status', 'id', uniqueOrderIds);
    _ordersRaw.filter(o => o.status !== 'archived').forEach(o => { _ordersMap[o.id] = o; });
  }

  const allCompetingItems = (_competingFiltered || []).map(ci => ({
    ...ci,
    orders: _ordersMap[ci.order_id] || null,
  })).filter(ci => ci.orders !== null);

  // 2. Cek item yang sudah diinput manual
  const allItemIds = (allCompetingItems || []).map(ci => ci.id);
  let manuallyLinkedItemIds = new Set();
  if (allItemIds.length > 0) {
    const linkedRows = await _inBatch('riwayat_beli_items', 'order_item_id', 'order_item_id', allItemIds);
    linkedRows.forEach(r => { if (r.order_item_id) manuallyLinkedItemIds.add(r.order_item_id); });
  }

  // 'fifo_selesai' = otomatis di-set FIFO saat item penuh → excluded seperti 'selesai' manual
  const _isDoneStatus = s => s === 'selesai' || s === 'fifo_selesai';

  // FIX #1: Track item yang sudah penuh di in-memory (_fifoSelesaiSet) dari run sebelumnya.
  // Ini mencegah race condition di mana DB update async belum commit tapi FIFO sudah run lagi.
  // Item yang masuk _fifoSelesaiSet diperlakukan seolah status_item = 'fifo_selesai' tanpa
  // harus menunggu DB confirm.
  if (!global._fifoSelesaiSet) global._fifoSelesaiSet = new Set();
  const _fifoSelesaiSet = global._fifoSelesaiSet;

  const fifoCompetitors = (allCompetingItems || []).filter(ci =>
    !manuallyLinkedItemIds.has(ci.id) &&
    !_isDoneStatus(ci.status_item || 'pending') &&
    !_fifoSelesaiSet.has(ci.id)   // FIX #1: exclude item yang sudah penuh di run sebelumnya
  );

  // 3. Ambil total qty pembelian FIFO
  const _beliItemsRawAll = await _inBatch(
    'riwayat_beli_items', 'barang_id, qty, order_item_id, beli_id', 'barang_id', barangIds
  );
  const _beliItemsRaw = _beliItemsRawAll.filter(bi => bi.order_item_id === null || bi.order_item_id === undefined);

  const uniqueBeliIds = [...new Set((_beliItemsRaw || []).map(bi => bi.beli_id).filter(Boolean))];
  let _beliHeaderMap = {};
  if (uniqueBeliIds.length > 0) {
    const _beliHeaders = await _inBatch('riwayat_beli', 'id, tanggal, status, brand_id', 'id', uniqueBeliIds);
    _beliHeaders
      .filter(h => h.status === 'selesai')
      .forEach(h => { _beliHeaderMap[h.id] = h; });
  }

  const allBeliItemsFull = (_beliItemsRaw || [])
    .map(bi => ({ ...bi, riwayat_beli: _beliHeaderMap[bi.beli_id] || null }))
    .filter(bi => bi.riwayat_beli !== null);

  // ── Per-barang: cek cache, skip kalkulasi jika data beli tidak berubah ──
  const fifoResultMap   = {};
  const beliTotalPerBarang = {};

  // Kelompokkan allBeliItemsFull per barang_id untuk hash check
  const beliByBarang = {};
  allBeliItemsFull.forEach(bi => {
    if (!bi.barang_id) return;
    if (!beliByBarang[bi.barang_id]) beliByBarang[bi.barang_id] = [];
    beliByBarang[bi.barang_id].push(bi);
  });

  // beliTotal dari allBeliItemsFull (sebelum cache split)
  allBeliItemsFull.forEach(bi => {
    if (!bi.barang_id || !bi.qty) return;
    beliTotalPerBarang[bi.barang_id] = (beliTotalPerBarang[bi.barang_id] || 0) + bi.qty;
  });

  // Barang yang perlu dihitung ulang (cache miss atau force)
  const barangIdsToCalc = barangIds.filter(id => {
    if (forceAll) return true;
    const currentHash = _beliHash(beliByBarang[id] || []);
    return currentHash !== _fifoCache.beli[id];
  });

  // Barang yang bisa pakai cache
  const barangIdsFromCache = barangIds.filter(id => !barangIdsToCalc.includes(id));

  // Ambil hasil dari cache
  barangIdsFromCache.forEach(id => {
    Object.assign(fifoResultMap, _fifoCache.result[id] || {});
  });

  if (barangIdsToCalc.length === 0) {
    // Semua dari cache
    return {
      fifoResultMap,
      beliTotalPerBarang,
      allCompetingItems: allCompetingItems || [],
    };
  }

  // 4. FIFO distribution — hanya untuk barangIdsToCalc
  const barangBrandKeys = [...new Set(
    fifoCompetitors
      .filter(ci => barangIdsToCalc.includes(ci.barang_id))
      .map(ci => ci.barang_id + '::' + (ci.orders?.brand_id || ''))
  )];

  // Hasil sementara per barang untuk simpan ke cache
  const newResultPerBarang = {}; // { barang_id: { item_id: qty } }

  for (const key of barangBrandKeys) {
    const [barangId, brandId] = key.split('::');

    const beliItems = (beliByBarang[barangId] || [])
      .filter(bi => {
        if (!bi.qty) return false;
        return (bi.riwayat_beli?.brand_id || '') === brandId;
      })
      .sort((a, b) => {
        const tA = a.riwayat_beli?.tanggal || '', tB = b.riwayat_beli?.tanggal || '';
        return tA < tB ? -1 : tA > tB ? 1 : 0;
      });

    const competitors = fifoCompetitors
      .filter(ci => ci.barang_id === barangId && (ci.orders?.brand_id || '') === brandId)
      .sort((a, b) => {
        const tA = a.orders?.created_at || '', tB = b.orders?.created_at || '';
        return tA < tB ? -1 : tA > tB ? 1 : 0;
      });

    if (competitors.length === 0) continue;

    const hasil = {};
    for (const ci of competitors) {
      const kebutuhan = (ci.qty_order || 0) * (ci.faktor_konversi || 1);
      const statusCi  = ci.status_item || 'pending';
      if (_isDoneStatus(statusCi)) {
        hasil[ci.id] = Math.min(ci.qty_terpenuhi || 0, kebutuhan);
      } else {
        // PERBAIKAN: ordered tidak di-reset ke 0 — pertahankan qty yang sudah ada
        // FIFO tetap berjalan dari awal untuk akurasi, tapi ordered items tidak kehilangan
        // nilai mereka di antara run.
        // Alasan: ordered = komitmen sudah dibuat ke vendor, progress nyata.
        hasil[ci.id] = statusCi === 'ordered' ? (ci.qty_terpenuhi || 0) : 0;
      }
    }

    let orderQueueIdx = 0;
    // pending mulai dari 0, ordered sudah ada nilai awal dari DB
    const orderQueue = competitors.filter(ci => !_isDoneStatus(ci.status_item || 'pending'));

    for (const bi of beliItems) {
      const beliTgl = bi.riwayat_beli?.tanggal || '';
      let sisaBeli = bi.qty || 0;

      while (orderQueueIdx < orderQueue.length && sisaBeli > 0) {
        const ci = orderQueue[orderQueueIdx];
        const orderTgl = (ci.orders?.created_at || '').substring(0, 10);

        if (orderTgl > beliTgl) break;

        const kebutuhan  = (ci.qty_order || 0) * (ci.faktor_konversi || 1);
        const sudahDapat = hasil[ci.id] || 0;
        const sisaButuh  = kebutuhan - sudahDapat;

        if (sisaButuh <= 0) {
          orderQueueIdx++;
          continue;
        }

        const dialokasikan = Math.min(sisaButuh, sisaBeli);
        hasil[ci.id] = sudahDapat + dialokasikan;

        if (hasil[ci.id] >= kebutuhan) {
          orderQueueIdx++;
        }
        break;
      }
    }

    // Simpan ke fifoResultMap + newResultPerBarang
    if (!newResultPerBarang[barangId]) newResultPerBarang[barangId] = {};

    for (const ci of competitors) {
      const statusCi = ci.status_item || 'pending';
      let val;
      if (_isDoneStatus(statusCi)) {
        val = hasil[ci.id];
      } else if (statusCi === 'ordered') {
        // Ordered = komitmen ke vendor. Preserve qty_terpenuhi yg sudah ada
        // hanya kalau tidak ada beli relevan (FIFO belum punya data utk recompute).
        const adaBeli = beliItems.some(bi =>
          (bi.riwayat_beli?.tanggal || '') >= (ci.orders?.created_at || '').substring(0, 10)
        );
        val = adaBeli ? hasil[ci.id] : undefined;
      } else {
        // Pending: pakai hasil FIFO, TAPI jangan reset ke 0 jika item sudah pernah penuh di DB.
        // FIX #2: wasAlreadyFull guard — mencegah flip-flop saat pool beli berubah sementara
        // atau ada race condition antara FIFO run dan DB write.
        // Jika FIFO tidak mengalokasikan apapun (hasil = 0) tapi DB qty_terpenuhi sudah >= kebutuhan,
        // pertahankan nilai DB sampai ada sinyal eksplisit (beli dihapus → invalidate cache).
        const kebutuhanCi = (ci.qty_order || 0) * (ci.faktor_konversi || 1);
        const wasAlreadyFull = kebutuhanCi > 0 && (ci.qty_terpenuhi || 0) >= kebutuhanCi;
        const fifoQty = hasil[ci.id];
        if (wasAlreadyFull && (fifoQty === 0 || fifoQty === undefined)) {
          // Pertahankan qty lama — FIFO tidak punya alokasi baru yang valid
          val = ci.qty_terpenuhi;
        } else {
          val = fifoQty;
        }
      }
      fifoResultMap[ci.id] = val;
      if (val !== undefined) newResultPerBarang[barangId][ci.id] = val;
    }
  }

  // Simpan hasil baru ke cache (hanya barang yang baru dihitung)
  barangIdsToCalc.forEach(id => {
    _fifoCache.beli[id]      = _beliHash(beliByBarang[id] || []);
    _fifoCache.result[id]    = newResultPerBarang[id] || {};
    _fifoCache.beliTotal[id] = beliTotalPerBarang[id] || 0;
  });

  // 5. Update DB untuk item FIFO yang qty-nya berubah.
  //    Jika item baru PENUH via FIFO → set status_item='fifo_selesai' untuk lock permanen.
  //    FIX #3: Kumpulkan semua promise DB update dan await sebelum return.
  //    Ini mencegah _refreshDetailBody() membaca DB sebelum fifo_selesai ter-commit.
  //    FIX #1 (lanjutan): item yang nowFull langsung masuk _fifoSelesaiSet in-memory,
  //    sehingga run berikutnya exclude mereka tanpa harus tunggu DB confirm.
  const adaData = Object.keys(beliTotalPerBarang).length > 0;
  if (adaData) {
    const dbUpdatePromises = [];

    fifoCompetitors
      .filter(ci => barangIdsToCalc.includes(ci.barang_id))
      .forEach(ci => {
        if (_isDoneStatus(ci.status_item || 'pending')) return;
        const newQty = fifoResultMap[ci.id];
        if (newQty === undefined) return;
        const kebutuhan = (ci.qty_order || 0) * (ci.faktor_konversi || 1);
        const nowFull   = kebutuhan > 0 && newQty >= kebutuhan;
        const qtyChanged = newQty !== (ci.qty_terpenuhi || 0);

        if (!qtyChanged && !nowFull) return;

        // FIX #1: tandai in-memory segera — sebelum DB commit
        if (nowFull) {
          _fifoSelesaiSet.add(ci.id);
          // Simpan mapping item_id → barang_id agar invalidate bisa cleanup
          if (!global._fifoItemBarangMap) global._fifoItemBarangMap = new Map();
          global._fifoItemBarangMap.set(ci.id, ci.barang_id);
        }

        const updatePayload = { qty_terpenuhi: newQty };
        if (nowFull) updatePayload.status_item = 'fifo_selesai';

        // FIX #3: await semua DB update sebelum return
        dbUpdatePromises.push(
          _sb.from('order_items')
            .update(updatePayload)
            .eq('id', ci.id)
            .then(() => {})
            .catch(e => console.warn('fifo update failed:', ci.id, e))
        );
      });

    if (dbUpdatePromises.length > 0) {
      await Promise.all(dbUpdatePromises);
    }
  }

  return { fifoResultMap, beliTotalPerBarang, allCompetingItems: allCompetingItems || [] };
}

  global._inBatch              = _inBatch;
  global._runFifoSync          = _runFifoSync;
  global._invalidateFifoCache  = _invalidateFifoCache;

})(window);
