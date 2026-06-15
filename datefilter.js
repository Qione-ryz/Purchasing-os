/**
 * datefilter.js — Reusable Date Filter Module (v4)
 * ─────────────────────────────────────────────────
 * Perubahan dari v3:
 *  1. Auto-render HTML picker — tidak perlu tulis tombol manual di HTML
 *  2. Layout 2 kolom: kiri = quick presets, kanan = lompat bulan + kustom + reset
 *  3. Config via `quickPresets` (array) — tiap page tentukan opsi sendiri
 *  4. `quickBtnMap`, `monthPickerEl`, `visFrom`, `visTo` tidak perlu di HTML
 *
 * Cara pakai (v4):
 *
 *   const df = DateFilter.create({
 *     pickerEl   : 'idDatePicker',      // container kosong <div id="..." style="display:none">
 *     triggerBtn : 'idTombolFilter',    // auto-attach onclick
 *     labelEl    : 'idSpanLabel',
 *     inputFrom  : 'idInputHiddenFrom',
 *     inputTo    : 'idInputHiddenTo',
 *     quickPresets: [
 *       { preset: 'all',       label: 'Semua Waktu' },
 *       { preset: 'today',     label: 'Hari Ini'    },
 *       { preset: 'thismonth', label: 'Bulan Ini'   },
 *       { preset: 'lastmonth', label: 'Bulan Lalu'  },
 *       { preset: 'thisyear',  label: 'Tahun Ini'   },
 *     ],
 *     default      : 'thismonth',
 *     triggerOnInit: false,
 *     onChange     : (from, to, label) => { fetchData(); },
 *   });
 *
 *   // API publik (sama seperti v3):
 *   df.setQuick('thisyear');
 *   df.setCustom('2024-01-01', '2024-06-30');
 *   df.applyMonthDropdown();
 *   df.clear();
 *   df.toggle();
 *   df.close();
 *   const { from, to } = df.getRange();
 *
 * HTML minimal yang dibutuhkan:
 *
 *   <button id="myTriggerBtn">📅 <span id="myLabel">—</span></button>
 *   <div id="myPicker" style="display:none"></div>
 *   <input type="hidden" id="myFrom"/>
 *   <input type="hidden" id="myTo"/>
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

      case 'thisweek': {
        const day = today.getDay(); // 0=Sun
        const diffToMon = day === 0 ? -6 : 1 - day;
        const mon = new Date(today); mon.setDate(today.getDate() + diffToMon);
        const sun = new Date(mon);   sun.setDate(mon.getDate() + 6);
        from = _fmt(mon); to = _fmt(sun); label = 'Minggu Ini'; break;
      }

      case 'yesterday': {
        const yest = new Date(today); yest.setDate(today.getDate() - 1);
        from = _fmt(yest); to = _fmt(yest); label = 'Kemarin'; break;
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
      case 'none':
        from = ''; to = ''; label = 'Semua Waktu'; break;

      default:
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

  /* ── Unique ID helper ───────────────────────────────────────────────── */
  let _uid = 0;
  function _genId() { return `_df${++_uid}`; }

  /* ── Factory utama ──────────────────────────────────────────────────── */
  function create(opts = {}) {
    const {
      pickerEl,
      triggerBtn,
      labelEl,
      inputFrom,
      inputTo,
      quickPresets = [
        { preset: 'all',       label: 'Semua Waktu' },
        { preset: 'today',     label: 'Hari Ini'    },
        { preset: 'thismonth', label: 'Bulan Ini'   },
        { preset: 'lastmonth', label: 'Bulan Lalu'  },
        { preset: 'thisyear',  label: 'Tahun Ini'   },
        { preset: 'lastyear',  label: 'Tahun Lalu'  },
      ],
      onChange,
      default: defaultPreset = 'all',
      triggerOnInit = false,
    } = opts;

    const el = id => (typeof id === 'string' ? document.getElementById(id) : id);

    /* ID unik untuk elemen yang di-render */
    const IDS = {
      yearNav   : _genId(),
      yearLabel : _genId(),
      yearPrev  : _genId(),
      yearNext  : _genId(),
      monthGrid : _genId(),
      btnApply  : _genId(),
      inputFrom : _genId(),
      inputTo   : _genId(),
    };

    /* state range selection */
    let _rangeYear  = new Date().getFullYear();
    let _rangeFrom  = null; /* { y, m } bulan pertama dipilih */
    let _rangeTo    = null; /* { y, m } bulan kedua dipilih */

    /* map preset → btn element */
    const _presetBtnMap = {};

    /* ── Render month grid ── */
    function _renderMonthGrid() {
      const grid = document.getElementById(IDS.monthGrid);
      const applyBtn = document.getElementById(IDS.btnApply);
      if (!grid) return;

      const MONTH_SHORT = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

      grid.innerHTML = MONTH_SHORT.map((name, i) => {
        const m = i + 1;
        const isFrom = _rangeFrom && _rangeFrom.y === _rangeYear && _rangeFrom.m === m;
        const isTo   = _rangeTo   && _rangeTo.y   === _rangeYear && _rangeTo.m   === m;

        /* highlight range antara from dan to */
        let inRange = false;
        if (_rangeFrom && _rangeTo) {
          const fromMs = _rangeFrom.y * 12 + _rangeFrom.m;
          const toMs   = _rangeTo.y   * 12 + _rangeTo.m;
          const curMs  = _rangeYear   * 12 + m;
          const [lo, hi] = fromMs < toMs ? [fromMs, toMs] : [toMs, fromMs];
          inRange = curMs > lo && curMs < hi;
        }

        let cls = 'df-mg-cell';
        if (isFrom || isTo) cls += ' df-mg-selected';
        else if (inRange)   cls += ' df-mg-inrange';

        return `<button class="${cls}" data-m="${m}">${name}</button>`;
      }).join('');

      /* year label */
      const lbl = document.getElementById(IDS.yearLabel);
      if (lbl) lbl.textContent = _rangeYear;

      /* apply btn label */
      if (applyBtn) {
        if (_rangeFrom && _rangeTo) {
          const [lo, hi] = _monthOrder(_rangeFrom, _rangeTo);
          applyBtn.textContent = `Terapkan: ${MONTH_NAMES[lo.m-1].slice(0,3)} ${lo.y} – ${MONTH_NAMES[hi.m-1].slice(0,3)} ${hi.y}`;
          applyBtn.disabled = false;
        } else if (_rangeFrom) {
          applyBtn.textContent = `Terapkan: ${MONTH_NAMES[_rangeFrom.m-1]} ${_rangeFrom.y}`;
          applyBtn.disabled = false;
        } else {
          applyBtn.textContent = 'Pilih bulan...';
          applyBtn.disabled = true;
        }
      }

      /* attach cell events */
      grid.querySelectorAll('.df-mg-cell').forEach(btn => {
        btn.addEventListener('click', () => _onMonthCellClick(parseInt(btn.dataset.m)));
      });
    }

    function _monthOrder(a, b) {
      const aMs = a.y * 12 + a.m;
      const bMs = b.y * 12 + b.m;
      return aMs <= bMs ? [a, b] : [b, a];
    }

    function _onMonthCellClick(m) {
      if (!_rangeFrom) {
        /* klik pertama = set from */
        _rangeFrom = { y: _rangeYear, m };
        _rangeTo   = null;
      } else if (!_rangeTo) {
        const clicked = { y: _rangeYear, m };
        const fromMs  = _rangeFrom.y * 12 + _rangeFrom.m;
        const clickMs = clicked.y * 12 + clicked.m;
        if (fromMs === clickMs) {
          /* klik bulan yang sama = 1 bulan */
          _rangeTo = { ..._rangeFrom };
        } else {
          _rangeTo = clicked;
        }
      } else {
        /* klik ketiga = reset, mulai dari awal */
        _rangeFrom = { y: _rangeYear, m };
        _rangeTo   = null;
      }
      _renderMonthGrid();
    }

    /* ── Render HTML picker (2 kolom) ── */
    function _renderPicker() {
      const dp = el(pickerEl);
      if (!dp) return;

      /* init _rangeYear ke tahun sekarang */
      _rangeYear = new Date().getFullYear();

      const quickBtns = quickPresets.map(({ preset, label }) => {
        const id = _genId();
        _presetBtnMap[String(preset)] = id;
        return `<button class="df-quick-btn" id="${id}" data-preset="${preset}">${label}</button>`;
      }).join('');

      dp.innerHTML = `
        <div class="df-layout">
          <div class="df-col-left">
            <div class="df-section-label">Filter Cepat</div>
            <div class="df-quick-list">${quickBtns}</div>
          </div>
          <div class="df-col-right">
            <div class="df-section-label">Lompat ke Bulan</div>
            <div class="df-year-nav" id="${IDS.yearNav}">
              <button class="df-year-btn" id="${IDS.yearPrev}">‹</button>
              <span class="df-year-label" id="${IDS.yearLabel}">${_rangeYear}</span>
              <button class="df-year-btn" id="${IDS.yearNext}">›</button>
            </div>
            <div class="df-month-grid" id="${IDS.monthGrid}"></div>
            <button class="df-mp-apply" id="${IDS.btnApply}" disabled>Pilih bulan...</button>
            <div class="df-section-label" style="margin-top:10px">Rentang Kustom</div>
            <div class="df-custom-range">
              <div class="df-custom-row">
                <span class="df-range-span">Dari</span>
                <input type="date" id="${IDS.inputFrom}" class="df-range-input"/>
              </div>
              <div class="df-custom-row">
                <span class="df-range-span">S/d</span>
                <input type="date" id="${IDS.inputTo}" class="df-range-input"/>
              </div>
            </div>
            <button class="df-reset-btn" id="_dfReset_${IDS.btnApply}">↺ Reset ke ${_resolvePreset(defaultPreset).label}</button>
          </div>
        </div>
      `;

      _renderMonthGrid();

      /* events */
      document.getElementById(IDS.yearPrev).addEventListener('click', () => { _rangeYear--; _rangeFrom = null; _rangeTo = null; _renderMonthGrid(); });
      document.getElementById(IDS.yearNext).addEventListener('click', () => { _rangeYear++; _rangeFrom = null; _rangeTo = null; _renderMonthGrid(); });
      document.getElementById(IDS.btnApply).addEventListener('click', applyMonthDropdown);
      document.getElementById(`_dfReset_${IDS.btnApply}`).addEventListener('click', clear);
      dp.querySelector(`#${IDS.inputFrom}`).addEventListener('change', _onCustomChange);
      dp.querySelector(`#${IDS.inputTo}`).addEventListener('change', _onCustomChange);
      dp.querySelectorAll('.df-quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = btn.dataset.preset;
          setQuick(isNaN(Number(p)) ? p : Number(p));
        });
      });
    }

    /* ── Internal: apply ke DOM ── */
    function _apply(from, to, label) {
      if (el(inputFrom)) el(inputFrom).value = from || '';
      if (el(inputTo))   el(inputTo).value   = to   || '';
      if (el(labelEl))   el(labelEl).textContent = label;

      /* sync visible custom range inputs */
      const inpFrom = document.getElementById(IDS.inputFrom);
      const inpTo   = document.getElementById(IDS.inputTo);
      if (inpFrom) inpFrom.value = from || '';
      if (inpTo)   inpTo.value   = to   || '';

      const btn = el(triggerBtn);
      if (btn) {
        btn.style.borderColor = from ? 'var(--accent)' : '';
        btn.style.color       = from ? 'var(--accent)' : '';
      }
    }

    /* ── Internal: highlight tombol aktif ── */
    function _highlightBtn(activePreset) {
      Object.values(_presetBtnMap).forEach(id => el(id)?.classList.remove('active'));
      if (activePreset !== null) {
        const id = _presetBtnMap[String(activePreset)];
        if (id) el(id)?.classList.add('active');
      }
    }

    /* ── Internal: tutup picker ── */
    function _closePicker() {
      const dp = el(pickerEl);
      if (dp) dp.style.display = 'none';
      document.removeEventListener('mousedown', _outsideHandler);
      document.removeEventListener('keydown', _keyHandler);
    }

    function _outsideHandler(e) {
      const dp  = el(pickerEl);
      const btn = el(triggerBtn);
      if (dp && !dp.contains(e.target) && btn && !btn.contains(e.target)) _closePicker();
    }

    function _keyHandler(e) {
      if (e.key === 'Escape') _closePicker();
    }

    function _onCustomChange() {
      const from = document.getElementById(IDS.inputFrom)?.value || '';
      const to   = document.getElementById(IDS.inputTo)?.value   || '';
      if (!from && !to) return;
      const label = _customLabel(from, to);
      _apply(from, to, label);
      _highlightBtn(null);
      if (typeof onChange === 'function') onChange(from, to, label);
    }

    /* ═══════════════════════════════════════════
       PUBLIC API
    ═══════════════════════════════════════════ */

    function setQuick(preset) {
      const { from, to, label } = _resolvePreset(preset);
      _apply(from, to, label);
      _highlightBtn(preset);
      /* reset month grid selection */
      _rangeFrom = null; _rangeTo = null;
      _renderMonthGrid();
      _closePicker();
      if (typeof onChange === 'function') onChange(from, to, label);
    }

    function applyMonthDropdown() {
      if (!_rangeFrom) return;
      const [lo, hi] = _rangeTo ? _monthOrder(_rangeFrom, _rangeTo) : [_rangeFrom, _rangeFrom];
      const from  = _fmt(new Date(lo.y, lo.m - 1, 1));
      const to    = _fmt(new Date(hi.y, hi.m, 0));
      const label = lo.y === hi.y && lo.m === hi.m
        ? `${MONTH_NAMES[lo.m-1]} ${lo.y}`
        : `${MONTH_NAMES[lo.m-1].slice(0,3)} ${lo.y} – ${MONTH_NAMES[hi.m-1].slice(0,3)} ${hi.y}`;
      _apply(from, to, label);
      _highlightBtn(null);
      _rangeFrom = null; _rangeTo = null;
      _renderMonthGrid();
      _closePicker();
      if (typeof onChange === 'function') onChange(from, to, label);
    }

    function setCustom(from, to) {
      if (!from && !to) return;
      const label = _customLabel(from, to);
      _apply(from, to, label);
      _highlightBtn(null);
      if (typeof onChange === 'function') onChange(from, to, label);
    }

    function clear() {
      _rangeFrom = null; _rangeTo = null;
      _renderMonthGrid();
      setQuick(defaultPreset || 'all');
    }

    function toggle() {
      const dp = el(pickerEl);
      if (!dp) return;
      const isOpen = dp.style.display !== 'none' && dp.style.display !== '';
      if (isOpen) {
        _closePicker();
      } else {
        const parent = dp.parentElement;
        if (parent) {
          const pos = window.getComputedStyle(parent).position;
          if (pos === 'static') parent.style.position = 'relative';
        }
        dp.style.display = '';
        setTimeout(() => {
          document.addEventListener('mousedown', _outsideHandler);
          document.addEventListener('keydown', _keyHandler);
        }, 0);
      }
    }

    function close() { _closePicker(); }

    function getRange() {
      return {
        from: el(inputFrom) ? el(inputFrom).value : '',
        to:   el(inputTo)   ? el(inputTo).value   : '',
      };
    }

    /* ── Init ── */
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _renderPicker);
    } else {
      _renderPicker();
    }

    if (defaultPreset && defaultPreset !== 'none') {
      const { from, to, label } = _resolvePreset(defaultPreset);
      _apply(from, to, label);
      if (triggerOnInit && typeof onChange === 'function') onChange(from, to, label);
      setTimeout(() => _highlightBtn(defaultPreset), 0);
    }

    const btnEl = el(triggerBtn);
    if (btnEl && !btnEl.dataset.dfBound) {
      btnEl.addEventListener('click', toggle);
      btnEl.dataset.dfBound = '1';
    }

    return { setQuick, applyMonthDropdown, setCustom, clear, toggle, close, getRange };
  }

  return { create };

})();
