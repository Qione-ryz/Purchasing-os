/* ═══════════════════════════════════════════
   logger.js — Activity log helper
   Include di semua halaman setelah auth.js
   ═══════════════════════════════════════════ */

async function logActivity(aksi, tipe, targetNama, detail) {
  try {
    const { data: { session } } = await window._sb.auth.getSession();
    if (!session) return;
    const user = session.user;
    const nama = user.user_metadata?.full_name || user.email?.split('@')[0] || '—';
    await window._sb.from('activity_log').insert({
      user_id:     user.id,
      user_nama:   nama,
      user_email:  user.email,
      aksi,
      tipe,
      target_nama: targetNama || null,
      detail:      detail     || null
    });
  } catch(e) {
    /* Log gagal tidak boleh menghentikan aksi utama */
    console.warn('Log activity failed:', e.message);
  }
}

window.logActivity = logActivity;
