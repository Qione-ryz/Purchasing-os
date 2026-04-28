/**
 * datefilter.js — Reusable Date Filter Module
 * ─────────────────────────────────────────────
 * Cara pakai di setiap page:
 *
 *   const df = DateFilter.create({
 *     pickerEl     : 'idElementDatePicker',   // <div> panel dropdown
 *     triggerBtn   : 'idTombolFilter',         // <button> pemicu buka/tutup picker
 *     labelEl      : 'idSpanLabel',            // <span> teks label aktif
 *     inputFrom    : 'idInputHiddenFrom',      // <input type="hidden/date"> state from
 *     inputTo      : 'idInputHiddenTo',        // <input type="hidden/date"> state to
 *     visFrom      : 'idInputVisibleFrom',     // <input type="date"> di dalam picker
 *     visTo        : 'idInputVisibleTo',       // <input type="date"> di dalam picker
 *     quickBtnMap  : {                         // id tombol quick → preset key
 *       'idBtnAll'      : 'all',
 *       'idBtnToday'    : 'today',
 *       'idBtnYesterday': 'yesterday',
 *       'idBtn7'        : 7,
 *       'idBtn30'       : 30,
 *       'idBtnThisMonth': 'thismonth',
 *       'idBtnLastMonth': 'lastmonth',
 *       'idBtn3Month'   : 90,
 *       'idBtn6Month'   : 180,
 *       'idBtnThisYear' : 'thisyear',
 *       'idBtnLastYear' : 'lastyear',
 *     },
 *     onChange     : (from, to, label) => { /* callback saat range berubah *\/ },
 *     default      : 'thismonth',             // preset awal (opsional, default 'all')
 *   });
 *
 *   // Ambil nilai saat ini:
 *   const { from, to } = df.getRange();
 *
 *   // Set programatik:
 *   df.setQuick('thisyear');
 *   df.setCustom('2024-01-01', '2024-06-30');
 *   df.clear();
 *   df.toggle();
 */

const DateFilter = (() => {

  /* ── Utilitas tanggal lokal (hindari geser UTC) ─────────────────────── */
  function _fmt(d) {
    const y  = d.getFullYear();
    const m  = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function _today() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  /* ── Hitung range dari preset ───────────────────────────────────────── */
  function _resolvePreset(preset) {
    const today = _today();
    let from, to, label;

    switch (preset) {
      case 'today':
        from = _fmt(today); to = _fmt(today); label = 'Hari Ini'; break;

      case 'yesterday': {
        const y = new Date(today); y.setDate(today.getDate() - 1);
        from = _fmt(y); to = _fmt(y); label = 'Kemarin'; break;
      }

      case 'thismonth':
        from  = _fmt(new Date(today.getFullYear(), today.getMonth(), 1));
        to    = _fmt(new Date(today.getFullYear(), today.getMonth() + 1, 0));
        label = 'Bulan Ini'; break;

      case 'lastmonth':
        from  = _fmt(new Date(today.getFullYear(), today.getMonth() - 1, 1));
        to    = _fmt(new Date(today.getFullYear(), today.getMonth(), 0));
        label = 'Bulan Lalu'; break;

      case 'thisyear':
        from  = _fmt(new Date(today.getFullYear(), 0, 1));
        to    = _fmt(new Date(today.getFullYear(), 11, 31));
        label = 'Tahun Ini'; break;

      case 'lastyear':
        from  = _fmt(new Date(today.getFullYear() - 1, 0, 1));
        to    = _fmt(new Date(today.getFullYear() - 1, 11, 31));
        label = 'Tahun Lalu'; break;

      case 'all':
      case '':
      case undefined:
        from = ''; to = ''; label = 'Semua Waktu'; break;

      default:
        /* angka = N hari terakhir */
        if (typeof preset === 'number') {
          const d = new Date(today); d.setDate(today.getDate() - preset);
          from  = _fmt(d);
          to    = _fmt(today);
          label = preset === 7   ? '7 Hari'
                : preset === 30  ? '30 Hari'
                : preset === 90  ? '3 Bulan'
                : preset === 180 ? '6 Bulan'
                : `${preset} Hari`;
        } else {
          from = ''; to = ''; label = 'Semua Waktu';
        }
    }

    return { from, to, label };
  }

  /* ── Bangun label custom ────────────────────────────────────────────── */
  function _customLabel(from, to) {
    if (from && to)   return `${from.slice(5)} – ${to.slice(5)}`;
    if (from)         return `≥ ${from.slice(5)}`;
    if (to)           return `≤ ${to.slice(5)}`;
    return 'Semua Tanggal';
  }

  /* ── Factory utama ──────────────────────────────────────────────────── */
  function create(opts = {}) {
    const {
      pickerEl,
      triggerBtn,
      labelEl,
      inputFrom,
      inputTo,
      visFrom,
      visTo,
      quickBtnMap = {},
      onChange,
      default: defaultPreset = 'all',
    } = opts;

    /* Helper ambil elemen — toleran jika string atau element */
    const el = id => (typeof id === 'string' ? document.getElementById(id) : id);

    /* Daftar semua id tombol quick untuk reset highlight */
    const _allQuickIds = Object.keys(quickBtnMap);

    /* ── Internal: apply ke DOM ── */
    function _apply(from, to, label) {
      const inpFrom = el(inputFrom);
      const inpTo   = el(inputTo);
      const vFrom   = el(visFrom);
      const vTo     = el(visTo);
      const lbl     = el(labelEl);
      const btn     = el(triggerBtn);

      if (inpFrom) inpFrom.value = from || '';
      if (inpTo)   inpTo.value   = to   || '';
      if (vFrom)   vFrom.value   = from || '';
      if (vTo)     vTo.value     = to   || '';
      if (lbl)     lbl.textContent = label;

      /* Highlight tombol trigger saat filter aktif */
      if (btn) {
        btn.style.borderColor = from ? 'var(--accent)' : '';
        btn.style.color       = from ? 'var(--accent)' : '';
      }
    }

    /* ── Internal: highlight tombol aktif ── */
    function _highlightBtn(activePreset) {
      _allQuickIds.forEach(id => {
        const b = el(id);
        if (b) b.classList.remove('active');
      });
      /* Cari id yang bersesuaian dengan preset */
      const activeId = Object.keys(quickBtnMap).find(
        id => String(quickBtnMap[id]) === String(activePreset)
      );
      if (activeId) {
        const b = el(activeId);
        if (b) b.classList.add('active');
      }
    }

    /* ── Internal: tutup picker ── */
    function _closePicker() {
      const dp = el(pickerEl);
      if (dp) dp.style.display = 'none';
      document.removeEventListener('mousedown', _outsideHandler);
    }

    /* ── Internal: handler klik luar picker ── */
    function _outsideHandler(e) {
      const dp  = el(pickerEl);
      const btn = el(triggerBtn);
      if (dp && !dp.contains(e.target) && btn && !btn.contains(e.target)) {
        _closePicker();
      }
    }

    /* ═══════════════════════════════════════════
       PUBLIC API
    ═══════════════════════════════════════════ */

    /**
     * setQuick(preset)
     * Terapkan preset cepat: 'today','yesterday','thismonth','lastmonth',
     * 'thisyear','lastyear','all', atau angka (jumlah hari).
     * Menutup picker & memanggil onChange.
     */
    function setQuick(preset) {
      const { from, to, label } = _resolvePreset(preset);
      _apply(from, to, label);
      _highlightBtn(preset);
      _closePicker();
      if (typeof onChange === 'function') onChange(from, to, label);
    }

    /**
     * setCustom(from, to)
     * Terapkan rentang kustom. Tidak menutup picker (biarkan user isi tanggal kedua).
     * from & to dalam format 'YYYY-MM-DD', boleh kosong.
     */
    function setCustom(from, to) {
      if (!from && !to) return;
      const label = _customLabel(from, to);
      _apply(from, to, label);
      _highlightBtn(null); /* hapus highlight semua quick btn */
      if (typeof onChange === 'function') onChange(from, to, label);
    }

    /**
     * clear()
     * Reset filter ke 'Semua Tanggal'.
     */
    function clear() {
      _apply('', '', 'Semua Tanggal');
      _highlightBtn(null);
      _closePicker();
      if (typeof onChange === 'function') onChange('', '', 'Semua Tanggal');
    }

    /**
     * toggle()
     * Buka/tutup dropdown picker.
     */
    function toggle() {
      const dp = el(pickerEl);
      if (!dp) return;
      const isOpen = dp.style.display !== 'none' && dp.style.display !== '';
      if (isOpen) {
        _closePicker();
      } else {
        dp.style.display = '';
        setTimeout(() => document.addEventListener('mousedown', _outsideHandler), 0);
      }
    }

    /**
     * close()
     * Tutup picker secara programatik.
     */
    function close() {
      _closePicker();
    }

    /**
     * getRange()
     * Kembalikan { from, to } nilai saat ini.
     */
    function getRange() {
      const inpFrom = el(inputFrom);
      const inpTo   = el(inputTo);
      return {
        from: inpFrom ? inpFrom.value : '',
        to:   inpTo   ? inpTo.value   : '',
      };
    }

    /**
     * onVisibleInputChange()
     * Panggil saat input tanggal kustom (visible) berubah (onchange).
     * Biasanya dipasang sebagai: onchange="df.onVisibleInputChange()"
     */
    function onVisibleInputChange() {
      const from = el(visFrom)?.value || '';
      const to   = el(visTo)?.value   || '';
      setCustom(from, to);
    }

    /* ── Inisialisasi default ── */
    if (defaultPreset && defaultPreset !== 'none') {
      const { from, to, label } = _resolvePreset(defaultPreset);
      _apply(from, to, label);
      _highlightBtn(defaultPreset);
      /* Tidak panggil onChange saat init */
    }

    return { setQuick, setCustom, clear, toggle, close, getRange, onVisibleInputChange };
  }

  return { create };

})();


/* ═══════════════════════════════════════════════════════════════════════
   CONTOH PEMAKAIAN DI HALAMAN LAIN
   ═══════════════════════════════════════════════════════════════════════

   1. Sisipkan di <head> atau sebelum </body>:
      <script src="datefilter.js"></script>

   2. Siapkan elemen HTML (contoh untuk halaman penjualan):

      <!-- Hidden state -->
      <input type="date" id="saleDateFrom" style="display:none"/>
      <input type="date" id="saleDateTo"   style="display:none"/>

      <!-- Tombol trigger -->
      <button id="saleBtnDate" onclick="saleDf.toggle()">
        📅 <span id="saleDateLabel">Semua Tanggal</span>
      </button>

      <!-- Panel picker -->
      <div id="saleDatePicker" style="display:none; position:absolute; ...">
        <button id="saleQAll"       onclick="saleDf.setQuick('all')">Semua</button>
        <button id="saleQToday"     onclick="saleDf.setQuick('today')">Hari Ini</button>
        <button id="saleQThisMonth" onclick="saleDf.setQuick('thismonth')">Bulan Ini</button>
        ...
        <input type="date" id="saleDateFromVis" onchange="saleDf.onVisibleInputChange()"/>
        <input type="date" id="saleDateToVis"   onchange="saleDf.onVisibleInputChange()"/>
        <button onclick="saleDf.clear()">✕ Reset</button>
      </div>

   3. Inisialisasi di script:

      const saleDf = DateFilter.create({
        pickerEl   : 'saleDatePicker',
        triggerBtn : 'saleBtnDate',
        labelEl    : 'saleDateLabel',
        inputFrom  : 'saleDateFrom',
        inputTo    : 'saleDateTo',
        visFrom    : 'saleDateFromVis',
        visTo      : 'saleDateToVis',
        quickBtnMap: {
          'saleQAll'       : 'all',
          'saleQToday'     : 'today',
          'saleQThisMonth' : 'thismonth',
          // ...
        },
        default    : 'thismonth',
        onChange   : (from, to, label) => {
          console.log('Filter berubah:', from, to, label);
          fetchData(); // panggil ulang fetch data halaman Anda
        },
      });

   4. Di fungsi fetch:

      const { from, to } = saleDf.getRange();
      if (from) query = query.gte('tanggal', from);
      if (to)   query = query.lte('tanggal', to);

   ═══════════════════════════════════════════════════════════════════════ */
