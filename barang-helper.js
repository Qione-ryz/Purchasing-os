/* ═══════════════════════════════════════════════════════════════════
   barang-helper.js — Helper resolve nama barang (Opsi A)

   Memastikan nama barang yang ditampilkan selalu menggunakan nama
   terkini dari master data (barang.nama), dengan fallback ke snapshot
   jika barang sudah dihapus dari master.

   Depends on: window._sb
   Exposes:
     window.buildBarangNameMap()       → Promise<void>  — fetch & cache
     window.resolveNamaBarang(item)    → string          — gunakan di render
     window.getBarangNameMap()         → object          — { [barang_id]: nama }
   ═══════════════════════════════════════════════════════════════════ */

(function (global) {

  /* Cache in-memory: { [barang_id]: nama_terkini } */
  let _barangNameMap = {};
  let _built = false;

  /**
   * Fetch semua barang dari master dan build map { id → nama }.
   * Dipanggil sekali saat halaman load, setelah allBarang tersedia.
   * Jika allBarang sudah ada di window, pakai itu (tidak fetch ulang).
   */
  async function buildBarangNameMap() {
    /* Prioritas 1: pakai allBarang yang sudah di-load halaman */
    if (window.allBarang && window.allBarang.length > 0) {
      window.allBarang.forEach(b => {
        if (b.id && b.nama) _barangNameMap[b.id] = b.nama;
      });
      _built = true;
      return;
    }

    /* Prioritas 2: fetch langsung dari Supabase */
    try {
      const { data } = await window._sb
        .from('barang')
        .select('id, nama');
      (data || []).forEach(b => {
        if (b.id && b.nama) _barangNameMap[b.id] = b.nama;
      });
      _built = true;
    } catch (e) {
      console.warn('[barang-helper] Gagal fetch barang:', e.message);
    }
  }

  /**
   * Resolve nama terkini untuk satu item transaksi.
   *
   * @param {object} item  — baris dari riwayat_beli_items / order_items
   *                         harus punya: barang_id, nama (snapshot)
   * @returns {string}     — nama terkini jika ada di master, fallback ke snapshot
   */
  function resolveNamaBarang(item) {
    if (!item) return '—';
    const namamaster = item.barang_id ? _barangNameMap[item.barang_id] : null;
    return namamaster || item.nama || '—';
  }

  /**
   * Expose map mentah — berguna untuk loop massal (export, dll)
   * tanpa panggil resolveNamaBarang satu per satu.
   */
  function getBarangNameMap() {
    return _barangNameMap;
  }

  /**
   * Invalidate cache — panggil setelah nama barang di-update di barang.html
   * agar halaman lain yang masih terbuka pakai nama terbaru.
   */
  function invalidateBarangNameMap() {
    _barangNameMap = {};
    _built = false;
  }

  global.buildBarangNameMap    = buildBarangNameMap;
  global.resolveNamaBarang     = resolveNamaBarang;
  global.getBarangNameMap      = getBarangNameMap;
  global.invalidateBarangNameMap = invalidateBarangNameMap;

})(window);
