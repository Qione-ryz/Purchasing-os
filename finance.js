/* ================================================================
   finance.js — Outstanding payment view & aksi pembayaran
   ================================================================ */

// ── State ─────────────────────────────────────────────────────────
const FinState = {
  allRows:        [],
  filteredRows:   [],
  _markPaidId:    null,
  _uploadId:      null,
  dateFrom:       '',
  dateTo:         '',
};

// ── Helpers ───────────────────────────────────────────────────────
function formatRp(n) {
  return 'Rp ' + (n || 0).toLocaleString('id-ID');
}

function formatDate(s) {
  if (!s) return '—';
  try {
    const d = new Date(s.includes('T') ? s : s + 'T00:00:00');
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return s; }
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, type = 'info') {
  const prev = document.getElementById('toastEl');
  if (prev) prev.remove();
  const t = document.createElement('div');
  t.id = 'toastEl';
  const bg = type === 'success' ? 'var(--accent3)' : type === 'error' ? 'var(--danger)' : 'var(--surface2)';
  t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 18px;border-radius:10px;background:${bg};color:#fff;font-size:13px;font-family:var(--sans);box-shadow:0 4px 20px rgba(0,0,0,.4);max-width:340px;line-height:1.4;transition:opacity .3s`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
}

function hideLoader() {
  const el = document.getElementById('page-loader');
  if (el) el.style.display = 'none';
}

// ── Brand ─────────────────────────────────────────────────────────
async function loadBrands() {
  const { data } = await window._sb.from('brands').select('*').order('nama');
  const sel = document.getElementById('brandSelect');
  if (!sel) return;
  (data || []).forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id; opt.textContent = b.nama;
    sel.appendChild(opt);
  });
  const saved = localStorage.getItem('activeBrand');
  if (saved) sel.value = saved;
  _updateBrandLabel();
}

function _updateBrandLabel() {
  const sel = document.getElementById('brandSelect');
  const lbl = document.getElementById('activeBrandLabel');
  if (!sel || !lbl) return;
  const opt = sel.options[sel.selectedIndex];
  lbl.textContent = opt?.value ? opt.textContent : 'Semua Brand';
}

function onBrandChange() {
  const sel = document.getElementById('brandSelect');
  if (sel?.value) localStorage.setItem('activeBrand', sel.value);
  _updateBrandLabel();
  loadPayments();
}

// ── Load data ─────────────────────────────────────────────────────
async function loadPayments() {
  const sb     = window._sb;
  const brand  = document.getElementById('brandSelect')?.value  || '';
  const tbody  = document.getElementById('financeTableBody');
  tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--muted)">Memuat...</td></tr>`;

  let q = sb.from('payment_requests')
    .select(`
      *,
      riwayat_beli!inner(nomor_faktur, tanggal, riwayat_beli_items(nama)),
      vendor(nama),
      vendor_bank_accounts(bank_name, account_number, account_name)
    `)
    .order('created_at', { ascending: false });

  if (brand && brand !== 'all') q = q.eq('brand_id', brand);
  if (FinState.dateFrom) q = q.gte('created_at', FinState.dateFrom);
  if (FinState.dateTo)   q = q.lte('created_at', FinState.dateTo + 'T23:59:59');

  const { data, error } = await q;
  if (error) { showToast('Gagal memuat data: ' + error.message, 'error'); return; }

  FinState.allRows = (data || []).map(r => ({
    ...r,
    _vendorNama:  r.vendor?.nama || '—',
    _faktur:      r.riwayat_beli?.nomor_faktur || '—',
    _tglInvoice:  r.riwayat_beli?.tanggal || '',
    _description: (r.riwayat_beli?.riwayat_beli_items || []).map(i => i.nama).filter(Boolean).join(', '),
    _bankLabel:   r.vendor_bank_accounts
      ? `${r.vendor_bank_accounts.bank_name} ${r.vendor_bank_accounts.account_number}`
      : '—',
  }));

  updateSummary();
  applyFilter();
}

// ── Summary bar ───────────────────────────────────────────────────
function updateSummary() {
  const now     = new Date();
  const thisY   = now.getFullYear();
  const thisM   = now.getMonth();

  const pending = FinState.allRows.filter(r => r.status_payment === 'pending');
  const paidMonth = FinState.allRows.filter(r => {
    if (r.status_payment !== 'paid' || !r.payment_date) return false;
    const d = new Date(r.payment_date + 'T00:00:00');
    return d.getFullYear() === thisY && d.getMonth() === thisM;
  });

  const totalOutstanding = pending.reduce((s, r) => s + (r.amount || 0), 0);
  const totalPaidMonth   = paidMonth.reduce((s, r) => s + (r.amount || 0), 0);

  document.getElementById('statOutstanding').textContent = formatRp(totalOutstanding);
  document.getElementById('statNeedsPay').textContent    = `${pending.length} item`;
  document.getElementById('statPaidMonth').textContent   = formatRp(totalPaidMonth);
}

// ── Filter & render ───────────────────────────────────────────────
function applyFilter() {
  const status  = document.getElementById('filterStatus')?.value  || '';
  const search  = (document.getElementById('searchVendor')?.value || '').toLowerCase().trim();

  FinState.filteredRows = FinState.allRows.filter(r => {
    if (status && r.status_payment !== status) return false;
    if (search && !r._vendorNama.toLowerCase().includes(search) && !r._faktur.toLowerCase().includes(search)) return false;
    return true;
  });

  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('financeTableBody');
  const rows  = FinState.filteredRows;
  const info  = document.getElementById('tableInfo');

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--muted)">Tidak ada data</td></tr>`;
    if (info) info.textContent = '';
    return;
  }

  tbody.innerHTML = rows.map(r => renderRow(r)).join('');
  if (info) info.textContent = `Menampilkan ${rows.length} dari ${FinState.allRows.length} data`;
}

function renderRow(r) {
  const isPaid    = r.status_payment === 'paid';
  const isXero    = r.status_xero === 'inputted';
  const descShort = r._description.length > 60 ? r._description.slice(0, 57) + '…' : r._description;

  const statusBadge = isPaid
    ? `<span class="badge-green" style="font-size:10px">Lunas</span>`
    : `<span class="badge-orange" style="font-size:10px">Pending</span>`;

  const attachCell = r.attachment_url
    ? `<a href="${escHtml(r.attachment_url)}" target="_blank" class="btn-ghost" style="font-size:11px;padding:3px 8px;white-space:nowrap">📎 Lihat</a>
       <button class="btn-ghost" style="font-size:11px;padding:3px 6px" onclick="triggerUpload('${r.id}')" title="Ganti file">↑</button>`
    : `<button class="btn-ghost" style="font-size:11px;padding:3px 8px;white-space:nowrap" onclick="triggerUpload('${r.id}')">↑ Upload</button>`;

  const actionCell = isPaid
    ? `<span style="font-size:11px;color:var(--muted)">Lunas ${formatDate(r.payment_date)}</span>`
    : `<button class="btn-primary" style="font-size:11px;padding:4px 10px;white-space:nowrap" onclick="openMarkPaid('${r.id}')">✓ Tandai Lunas</button>`;

  return `<tr>
    <td style="white-space:nowrap;font-family:'DM Mono',monospace;font-size:12px">${r.payment_date ? formatDate(r.payment_date) : '—'}<br/>${statusBadge}</td>
    <td style="font-family:'DM Mono',monospace;font-size:12px;white-space:nowrap">${escHtml(r._faktur)}<br/><span style="font-size:11px;color:var(--muted)">${formatDate(r._tglInvoice)}</span></td>
    <td style="font-size:13px">${escHtml(r._vendorNama)}</td>
    <td style="font-size:12px;color:var(--muted);max-width:200px" title="${escHtml(r._description)}">${escHtml(descShort)}</td>
    <td style="text-align:right;font-family:'DM Mono',monospace;font-size:13px;font-weight:600;white-space:nowrap;color:var(--accent)">${formatRp(r.amount)}</td>
    <td style="font-size:12px;white-space:nowrap">${escHtml(r._bankLabel)}<br/>${r.vendor_bank_accounts?.account_name ? `<span style="font-size:11px;color:var(--muted)">${escHtml(r.vendor_bank_accounts.account_name)}</span>` : ''}</td>
    <td style="text-align:center">
      <input type="checkbox" ${isXero ? 'checked' : ''} onchange="toggleXero('${r.id}', this.checked)" title="Input Xero"
             ${isPaid ? '' : 'style="opacity:.5"'}/>
    </td>
    <td style="text-align:center">${attachCell}</td>
    <td style="text-align:center;white-space:nowrap">${actionCell}</td>
  </tr>`;
}

// ── Mark paid ─────────────────────────────────────────────────────
function openMarkPaid(id) {
  const row = FinState.allRows.find(r => r.id === id);
  if (!row) return;
  FinState._markPaidId = id;

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('markPaidDate').value    = today;
  document.getElementById('markPaidCatatan').value = '';
  document.getElementById('markPaidInfo').innerHTML = `
    <b>${escHtml(row._vendorNama)}</b><br/>
    Invoice: ${escHtml(row._faktur)}<br/>
    Jumlah: <b style="color:var(--accent)">${formatRp(row.amount)}</b>
  `;
  document.getElementById('markPaidModal').style.display = 'flex';
  setTimeout(() => document.getElementById('markPaidDate')?.focus(), 40);
}

function closeMarkPaidModal() {
  document.getElementById('markPaidModal').style.display = 'none';
}

async function doMarkPaid() {
  const id = FinState._markPaidId;
  if (!id) return;

  const payDate = document.getElementById('markPaidDate').value;
  const catatan = document.getElementById('markPaidCatatan').value.trim();
  if (!payDate) { showToast('Tanggal pembayaran wajib diisi', 'error'); return; }

  const { data: { user } } = await window._sb.auth.getUser();
  const { error } = await window._sb.from('payment_requests').update({
    status_payment: 'paid',
    payment_date:   payDate,
    paid_by:        user?.id || null,
    catatan:        catatan || null,
  }).eq('id', id);

  if (error) { showToast('Gagal: ' + error.message, 'error'); return; }

  closeMarkPaidModal();
  showToast('Pembayaran dikonfirmasi ✓', 'success');

  const row = FinState.allRows.find(r => r.id === id);
  if (row) { row.status_payment = 'paid'; row.payment_date = payDate; }
  updateSummary();
  applyFilter();
}

// ── Xero toggle ───────────────────────────────────────────────────
async function toggleXero(id, checked) {
  const status = checked ? 'inputted' : 'not_input';
  const { error } = await window._sb.from('payment_requests')
    .update({ status_xero: status }).eq('id', id);
  if (error) { showToast('Gagal update Xero: ' + error.message, 'error'); return; }

  const row = FinState.allRows.find(r => r.id === id);
  if (row) row.status_xero = status;
  showToast(checked ? 'Ditandai sudah input Xero' : 'Xero status direset', 'success');
}

// ── Upload bukti transfer ─────────────────────────────────────────
function triggerUpload(id) {
  FinState._uploadId = id;
  const inp = document.getElementById('uploadInput');
  inp.value = '';
  inp.click();
}

async function onUploadFile(input) {
  const id   = FinState._uploadId;
  const file = input.files[0];
  if (!file || !id) return;

  const ext      = file.name.split('.').pop() || 'jpg';
  const path     = `bukti/${id}_${Date.now()}.${ext}`;
  const bucket   = 'invoice-attachments';

  showToast('Mengupload...', 'info');

  const { error: uploadErr } = await window._sb.storage
    .from(bucket)
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadErr) { showToast('Upload gagal: ' + uploadErr.message, 'error'); return; }

  const { data: { publicUrl } } = window._sb.storage.from(bucket).getPublicUrl(path);

  const { error: updateErr } = await window._sb.from('payment_requests')
    .update({ attachment_url: publicUrl }).eq('id', id);

  if (updateErr) { showToast('Gagal simpan URL: ' + updateErr.message, 'error'); return; }

  const row = FinState.allRows.find(r => r.id === id);
  if (row) row.attachment_url = publicUrl;
  applyFilter();
  showToast('Bukti transfer berhasil diupload ✓', 'success');
}

// ── Init ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (typeof applyTheme === 'function') applyTheme();

  const sb = window._sb;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'index.html'; return; }

  const role = await getUserRole();
  if (role !== 'admin' && role !== 'finance') {
    document.querySelector('.content').innerHTML = `
      <div style="padding:60px;text-align:center;color:var(--muted)">
        <div style="font-size:48px;margin-bottom:16px">⛔</div>
        <div>Akses ditolak. Halaman ini hanya untuk Finance.</div>
      </div>`;
    hideLoader();
    return;
  }

  applyRoleUI(role);
  renderSidebar('finance.html', 'Pilih Brand', 'onBrandChange()');
  await loadBrands();

  // DateFilter
  DateFilter.create({
    pickerEl:     'datePickerEl',
    triggerBtn:   'btnDateFilter',
    labelEl:      'dateFilterLabel',
    inputFrom:    'fDateFrom',
    inputTo:      'fDateTo',
    default:      'all',
    quickPresets: [
      { preset: 'all',       label: 'Semua Waktu' },
      { preset: 'thismonth', label: 'Bulan Ini'   },
      { preset: 'lastmonth', label: 'Bulan Lalu'  },
      { preset: 30,          label: '30 Hari'     },
      { preset: 'thisyear',  label: 'Tahun Ini'   },
    ],
    onChange: (from, to) => {
      FinState.dateFrom = from;
      FinState.dateTo   = to;
      loadPayments();
    },
  });

  hideLoader();
  loadPayments();
});
