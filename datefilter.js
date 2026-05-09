/**
 * datefilter.js — Reusable Date Filter Module (v2)
 * ─────────────────────────────────────────────────
 * Cara pakai di setiap page:
 *
 *   const df = DateFilter.create({
 *     pickerEl     : 'idElementDatePicker',
 *     triggerBtn   : 'idTombolFilter',
 *     labelEl      : 'idSpanLabel',
 *     inputFrom    : 'idInputHiddenFrom',
 *     inputTo      : 'idInputHiddenTo',
 *     visFrom      : 'idInputVisibleFrom',
 *     visTo        : 'idInputVisibleTo',
 *     quickBtnMap  : {
 *       'idBtnAll'      : 'all',
 *       'idBtnToday'    : 'today',
 *       'idBtn30'       : 30,
 *       'idBtnThisMonth': 'thismonth',
 *       'idBtnLastMonth': 'lastmonth',
 *       'idBtn3Month'   : 90,
 *       'idBtn6Month'   : 180,
 *       'idBtnThisYear' : 'thisyear',
 *       'idBtnLastYear' : 'lastyear',
 *     },
 *     monthPickerEl : 'idMonthPickerContainer', // <div> untuk dropdown bulan+tahun
 *     onChange     : (from, to, label) => { },
 *     default      : 'thismonth',
 *   });
 *
 *   // Ambil nilai saat ini:
 *   const { from, to } = df.getRange();
 *
 *   // Set programatik:
 *   df.setQuick('thisyear');
 *   df.setCustom('2024-01-01', '2024-06-30');
 *   df.applyMonthDropdown();
 *   df.clear();
 *   df.toggle();
 */

const DateFilter = (() => {

  /* ── Utilitas tanggal lokal ─────────────────────────────────────────── */
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

  const MONTH_NAMES = [
    'Januari','Februari','Maret','April','Mei','Juni',
    'Juli','Agustus','September','Oktober','November','Desember'
  ];

  /* ── Hitung range dari preset ───────────────────────────────────────── */
  function _resolvePreset(preset) {
    const today = _today();
    let from, to, label;

    switch (preset) {
      case 'today':
        from = _fmt(today); to = _fmt(today); label = 'Hari Ini'; break;

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
        if (typeof preset === 'number') {
          const d = new Date(today); d.setDate(today.getDate() - preset);
          from  = _fmt(d);
          to    = _fmt(today);
          label = preset === 30  ? '30 Hari'
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
      monthPickerEl,
    } = opts;

    const el = id => (typeof id === 'string' ? document.getElementById(id) : id);
    const _allQuickIds = Object.keys(quickBtnMap);

    /* ── Internal: apply ke DOM ── */
    function _apply(from, to, label) {
      if (el(inputFrom)) el(inputFrom).value = from || '';
      if (el(inputTo))   el(inputTo).value   = to   || '';
      if (el(visFrom))   el(visFrom).value   = from || '';
      if (el(visTo))     el(visTo).value     = to   || '';
      if (el(labelEl))   el(labelEl).textContent = label;

      const btn = el(triggerBtn);
      if (btn) {
        btn.style.borderColor = from ? 'var(--accent)' : '';
        btn.style.color       = from ? 'var(--accent)' : '';
      }
    }

    /* ── Internal: highlight tombol aktif ── */
    function _highlightBtn(activePreset) {
      _allQuickIds.forEach(id => el(id)?.classList.remove('active'));
      if (activePreset !== null) {
        const activeId = Object.keys(quickBtnMap).find(
          id => String(quickBtnMap[id]) === String(activePreset)
        );
        if (activeId) el(activeId)?.classList.add('active');
      }
    }

    /* ── Internal: tutup picker ── */
    function _closePicker() {
      const dp = el(pickerEl);
      if (dp) dp.style.display = 'none';
      document.removeEventListener('mousedown', _outsideHandler);
    }

    function _outsideHandler(e) {
      const dp  = el(pickerEl);
      const btn = el(triggerBtn);
      if (dp && !dp.contains(e.target) && btn && !btn.contains(e.target)) {
        _closePicker();
      }
    }

    /* ── Month Picker Renderer ── */
    function _renderMonthPicker() {
      const container = el(monthPickerEl);
      if (!container) return;

      const today = _today();
      const cy    = today.getFullYear();
      const cm    = today.getMonth() + 1;

      container.innerHTML = `
        <div class="df-mp-row">
          <select class="df-mp-select" id="_dfSelMonth">
            ${MONTH_NAMES.map((name, i) =>
              `<option value="${i + 1}"${i + 1 === cm ? ' selected' : ''}>${name}</option>`
            ).join('')}
          </select>
          <select class="df-mp-select" id="_dfSelYear">
            ${(() => {
              let html = '';
              for (let y = cy - 5; y <= cy + 1; y++) {
                html += `<option value="${y}"${y === cy ? ' selected' : ''}>${y}</option>`;
              }
              return html;
            })()}
          </select>
        </div>
        <button class="df-mp-apply" id="_dfBtnApply">Terapkan</button>
      `;

      container.querySelector('#_dfBtnApply').addEventListener('click', applyMonthDropdown);
    }

    /* ═══════════════════════════════════════════
       PUBLIC API
    ═══════════════════════════════════════════ */

    /**
     * setQuick(preset)
     * Preset: 'today','thismonth','lastmonth','thisyear','lastyear','all',
     * atau angka hari (30, 90, 180).
     */
    function setQuick(preset) {
      const { from, to, label } = _resolvePreset(preset);
      _apply(from, to, label);
      _highlightBtn(preset);
      _closePicker();
      if (typeof onChange === 'function') onChange(from, to, label);
    }

    /**
     * applyMonthDropdown()
     * Baca nilai dari dropdown bulan+tahun lalu terapkan sebagai filter
     * satu bulan penuh. Dipanggil otomatis saat tombol "Terapkan" diklik.
     */
    function applyMonthDropdown() {
      const selMonth = document.getElementById('_dfSelMonth');
      const selYear  = document.getElementById('_dfSelYear');
      if (!selMonth || !selYear) return;

      const m     = parseInt(selMonth.value, 10);
      const y     = parseInt(selYear.value,  10);
      const from  = _fmt(new Date(y, m - 1, 1));
      const to    = _fmt(new Date(y, m, 0));
      const label = `${MONTH_NAMES[m - 1]} ${y}`;

      _apply(from, to, label);
      _highlightBtn(null);
      _closePicker();
      if (typeof onChange === 'function') onChange(from, to, label);
    }

    /**
     * setCustom(from, to)
     * Terapkan rentang kustom. from & to format 'YYYY-MM-DD', boleh kosong.
     */
    function setCustom(from, to) {
      if (!from && !to) return;
      const label = _customLabel(from, to);
      _apply(from, to, label);
      _highlightBtn(null);
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

    /** close() — tutup picker secara programatik */
    function close() { _closePicker(); }

    /** getRange() — kembalikan { from, to } nilai saat ini */
    function getRange() {
      return {
        from: el(inputFrom) ? el(inputFrom).value : '',
        to:   el(inputTo)   ? el(inputTo).value   : '',
      };
    }

    /**
     * onVisibleInputChange()
     * Pasang sebagai: onchange="df.onVisibleInputChange()"
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
    }

    if (monthPickerEl) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _renderMonthPicker);
      } else {
        _renderMonthPicker();
      }
    }

    return { setQuick, applyMonthDropdown, setCustom, clear, toggle, close, getRange, onVisibleInputChange };
  }

  return { create };

})();


/* ═══════════════════════════════════════════════════════════════════════
   CSS YANG DIREKOMENDASIKAN
   ═══════════════════════════════════════════════════════════════════════

  .df-mp-row {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }

  .df-mp-select {
    flex: 1;
    padding: 7px 8px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 13px;
    background: #fff;
    cursor: pointer;
  }

  .df-mp-apply {
    width: 100%;
    padding: 8px;
    border: none;
    border-radius: 6px;
    background: var(--accent, #3b5bfc);
    color: #fff;
    font-size: 13px;
    cursor: pointer;
    transition: opacity .15s;
  }
  .df-mp-apply:hover { opacity: .88; }

   ═══════════════════════════════════════════════════════════════════════

   CONTOH HTML LENGKAP:

   <!-- Tombol trigger -->
   <button id="saleBtnDate" onclick="saleDf.toggle()">
     📅 <span id="saleDateLabel">Semua Tanggal</span>
   </button>

   <!-- Panel picker -->
   <div id="saleDatePicker" style="display:none; position:absolute;">

     <!-- Quick buttons (tanpa Kemarin & 7 Hari) -->
     <button id="saleQAll"       onclick="saleDf.setQuick('all')">Semua</button>
     <button id="saleQToday"     onclick="saleDf.setQuick('today')">Hari Ini</button>
     <button id="saleQ30"        onclick="saleDf.setQuick(30)">30 Hari</button>
     <button id="saleQThisMonth" onclick="saleDf.setQuick('thismonth')">Bulan Ini</button>
     <button id="saleQLastMonth" onclick="saleDf.setQuick('lastmonth')">Bulan Lalu</button>
     <button id="saleQ3Month"    onclick="saleDf.setQuick(90)">3 Bulan</button>
     <button id="saleQ6Month"    onclick="saleDf.setQuick(180)">6 Bulan</button>
     <button id="saleQThisYear"  onclick="saleDf.setQuick('thisyear')">Tahun Ini</button>
     <button id="saleQLastYear"  onclick="saleDf.setQuick('lastyear')">Tahun Lalu</button>

     <!-- Dropdown bulan + tahun (dirender otomatis oleh DateFilter) -->
     <div id="saleDateMonthPicker"></div>

     <!-- Rentang kustom -->
     <input type="date" id="saleDateFromVis" onchange="saleDf.onVisibleInputChange()"/>
     <input type="date" id="saleDateToVis"   onchange="saleDf.onVisibleInputChange()"/>

     <button onclick="saleDf.clear()">✕ Reset</button>
   </div>

   <!-- Hidden state -->
   <input type="hidden" id="saleDateFrom"/>
   <input type="hidden" id="saleDateTo"/>

   INISIALISASI:

   const saleDf = DateFilter.create({
     pickerEl      : 'saleDatePicker',
     triggerBtn    : 'saleBtnDate',
     labelEl       : 'saleDateLabel',
     inputFrom     : 'saleDateFrom',
     inputTo       : 'saleDateTo',
     visFrom       : 'saleDateFromVis',
     visTo         : 'saleDateToVis',
     monthPickerEl : 'saleDateMonthPicker',
     quickBtnMap   : {
       'saleQAll'       : 'all',
       'saleQToday'     : 'today',
       'saleQ30'        : 30,
       'saleQThisMonth' : 'thismonth',
       'saleQLastMonth' : 'lastmonth',
       'saleQ3Month'    : 90,
       'saleQ6Month'    : 180,
       'saleQThisYear'  : 'thisyear',
       'saleQLastYear'  : 'lastyear',
     },
     default       : 'thismonth',
     onChange      : (from, to, label) => {
       console.log('Filter berubah:', from, to, label);
       fetchData();
     },
   });

   DI FUNGSI FETCH:

   const { from, to } = saleDf.getRange();
   if (from) query = query.gte('tanggal', from);
   if (to)   query = query.lte('tanggal', to);

   ═══════════════════════════════════════════════════════════════════════ */
