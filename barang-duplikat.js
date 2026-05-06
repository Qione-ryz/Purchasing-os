/* ════════════════════════════════════════════
   barang-duplikat.js
   Fitur Cek & Hapus Duplikat Barang
   Bergantung pada: window._sb, window.allBrands,
                    window.loadBarang, showToast
════════════════════════════════════════════ */

/* ══ DUPLIKAT BARANG ══ */

async function openDuplikatModal() {
  document.getElementById('duplikatOverlay').classList.add('show');
  document.getElementById('duplikatLoading').style.display = '';
  document.getElementById('duplikatEmpty').style.display   = 'none';
  document.getElementById('duplikatList').style.display    = 'none';
  document.getElementById('duplikatFooter').style.display  = 'none';

  try {
    /* Ambil semua barang, group by nama (case-insensitive) */
    const { data: rows } = await window._sb
      .from('barang')
      .select('*, barang_brands(brand_id)')
      .order('nama');

    const grupNama = {};
    (rows||[]).forEach(b => {
      const key = (b.nama||'').toLowerCase().trim();
      if (!grupNama[key]) grupNama[key] = [];
      grupNama[key].push({
        ...b,
        brand_ids: (b.barang_brands||[]).map(x=>x.brand_id)
      });
    });

    /* Hanya grup yang punya > 1 item */
    const dupGroups = Object.entries(grupNama)
      .filter(([,items]) => items.length > 1)
      .sort((a,b) => a[0].localeCompare(b[0]));

    document.getElementById('duplikatLoading').style.display = 'none';

    if (!dupGroups.length) {
      document.getElementById('duplikatEmpty').style.display = '';
      return;
    }

    /* Render grup */
    const listEl = document.getElementById('duplikatList');
    listEl.style.display = '';
    listEl.innerHTML = dupGroups.map(([key, items]) => `
      <div style="border-bottom:1px solid var(--border);padding:16px 20px">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:8px">
          <span style="background:rgba(247,146,79,0.15);color:var(--accent3);font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:4px">${items.length} duplikat</span>
          ${items[0].nama}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${items.map((b,i) => {
            const brandTags = b.brand_ids.map(bid => {
              const br = (window.allBrands||[]).find(x=>x.id===bid);
              const color = br?.warna||'#4f8ef7';
              return `<span style="font-size:10px;padding:1px 7px;border-radius:3px;background:${color}22;color:${color};border:1px solid ${color}44">${br?.nama||bid}</span>`;
            }).join(' ');
            const tgl = b.created_at ? new Date(b.created_at).toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'}) : '—';
            return `
            <label style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:border-color .15s" onmouseover="this.style.borderColor='rgba(248,113,113,0.4)'" onmouseout="this.style.borderColor='var(--border)'">
              <input type="checkbox" data-id="${b.id}" style="width:16px;height:16px;accent-color:var(--danger);flex-shrink:0"/>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <span style="font-family:var(--mono);font-size:11px;color:var(--muted)">${b.id.slice(0,8)}…</span>
                  ${b.sku ? `<span style="font-family:var(--mono);font-size:11px;color:var(--accent2)">${b.sku}</span>` : ''}
                  <span style="font-family:var(--mono);font-size:11px">${b.satuan||'—'}</span>
                  ${brandTags}
                </div>
                <div style="font-size:11px;color:var(--muted);margin-top:3px">Dibuat: ${tgl}</div>
              </div>
              ${i===0 ? '<span style="font-size:10px;font-family:var(--mono);color:var(--accent2);white-space:nowrap">Pertama dibuat</span>' : ''}
            </label>`;
          }).join('')}
        </div>
        <div style="margin-top:8px;display:flex;gap:8px">
          <button onclick="pilihDuplikatGrup('${key}', 'all')" style="font-size:11px;font-family:var(--mono);padding:4px 10px;background:none;border:1px solid var(--border);border-radius:5px;color:var(--muted);cursor:pointer">Pilih semua</button>
          <button onclick="pilihDuplikatGrup('${key}', 'keep_first')" style="font-size:11px;font-family:var(--mono);padding:4px 10px;background:none;border:1px solid var(--border);border-radius:5px;color:var(--muted);cursor:pointer">Pilih semua kecuali pertama</button>
          <button onclick="pilihDuplikatGrup('${key}', 'none')" style="font-size:11px;font-family:var(--mono);padding:4px 10px;background:none;border:1px solid var(--border);border-radius:5px;color:var(--muted);cursor:pointer">Batalkan pilihan</button>
        </div>
      </div>`
    ).join('');

    document.getElementById('duplikatFooter').style.display = '';
    updateDuplikatCount();

    /* Update count on checkbox change */
    listEl.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', updateDuplikatCount);
    });

  } catch(e) {
    document.getElementById('duplikatLoading').innerHTML =
      `<div style="color:var(--danger);padding:20px">Gagal memuat: ${e.message}</div>`;
  }
}

function pilihDuplikatGrup(namaKey, mode) {
  /* Cari semua checkbox dalam grup ini */
  const listEl   = document.getElementById('duplikatList');
  /* Grup ditandai dari label dengan data-id yang cocok dengan items di grup */
  const allCbs   = Array.from(listEl.querySelectorAll('input[type=checkbox]'));

  /* Dapatkan semua id dalam grup dengan mencocokkan nama di judul grup */
  /* Grup adalah div dengan text nama yang mengandung namaKey */
  const grupDivs = listEl.querySelectorAll('[style*="border-bottom"]');
  grupDivs.forEach(div => {
    const titleEl = div.querySelector('[style*="font-weight:600"]');
    if (!titleEl) return;
    const nama = titleEl.textContent.trim().split('\n').pop().trim().toLowerCase();
    if (nama !== namaKey) return;

    const cbs = Array.from(div.querySelectorAll('input[type=checkbox]'));
    if (mode === 'all') {
      cbs.forEach(cb => cb.checked = true);
    } else if (mode === 'none') {
      cbs.forEach(cb => cb.checked = false);
    } else if (mode === 'keep_first') {
      cbs.forEach((cb, i) => cb.checked = i > 0);
    }
  });
  updateDuplikatCount();
}

function updateDuplikatCount() {
  const count = document.querySelectorAll('#duplikatList input[type=checkbox]:checked').length;
  const btn   = document.getElementById('btnHapusDipilih');
  btn.textContent = count ? `🗑 Hapus ${count} yang Dipilih` : '🗑 Hapus yang Dipilih';
  btn.disabled    = count === 0;
}

async function hapusDuplikatDipilih() {
  const ids = Array.from(document.querySelectorAll('#duplikatList input[type=checkbox]:checked'))
    .map(cb => cb.dataset.id);
  if (!ids.length) return;
  if (!confirm(`Hapus ${ids.length} barang duplikat yang dipilih?\n\nRiwayat harga terkait juga ikut dihapus. Tidak bisa dibatalkan.`)) return;

  const btn = document.getElementById('btnHapusDipilih');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Menghapus...';

  try {
    /* Hapus relasi dan data terkait */
    await window._sb.from('barang_brands').delete().in('barang_id', ids);
    await window._sb.from('riwayat_harga').delete().in('barang_id', ids);
    await window._sb.from('barang').delete().in('id', ids);

    showToast(`✓ ${ids.length} duplikat dihapus`, 'success');
    closeDuplikatModal();
    await window.loadBarang();
  } catch(e) {
    showToast('Gagal: '+e.message, 'error');
    btn.disabled = false; btn.textContent = `🗑 Hapus ${ids.length} yang Dipilih`;
  }
}

function closeDuplikatModal() {
  document.getElementById('duplikatOverlay').classList.remove('show');
}
window.openDuplikatModal=openDuplikatModal;
window.closeDuplikatModal=closeDuplikatModal;
window.hapusDuplikatDipilih=hapusDuplikatDipilih;
