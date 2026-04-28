/* ═══════════════════════════════════════════
   auth.js — Role helper, include di semua halaman
   ═══════════════════════════════════════════ */

/**
 * Panggil ini di awal setiap halaman setelah auth check.
 * Mengambil role dari sessionStorage (sudah di-set saat login),
 * atau fallback fetch dari Supabase jika belum ada.
 *
 * Return: 'admin' | 'user'
 */
async function getUserRole() {
  const cached = sessionStorage.getItem('userRole');
  if (cached) return cached;

  try {
    const { data: { session } } = await window._sb.auth.getSession();
    if (!session) return 'user';
    const { data: profile } = await window._sb
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();
    const role = profile?.role || 'user';
    sessionStorage.setItem('userRole', role);
    return role;
  } catch(e) {
    return 'user';
  }
}

/**
 * Sembunyikan elemen yang hanya boleh dilihat admin.
 * Tambahkan class "admin-only" pada elemen HTML yang ingin disembunyikan dari user biasa.
 */
function applyRoleUI(role) {
  window._userRole = role;
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = role === 'admin' ? '' : 'none';
  });
  /* Tampilkan badge role di sidebar */
  const roleEl = document.getElementById('userRole');
  if (roleEl) {
    roleEl.textContent = role === 'admin' ? 'Admin' : 'User';
    roleEl.style.color = role === 'admin' ? 'var(--accent2)' : 'var(--muted)';
  }
}

/** Cek apakah user boleh melakukan aksi. Tampilkan toast jika tidak. */
function requireAdmin(showToastFn) {
  if (window._userRole !== 'admin') {
    if (showToastFn) showToastFn('Hanya admin yang bisa melakukan aksi ini.', 'error');
    return false;
  }
  return true;
}

window.getUserRole  = getUserRole;
window.applyRoleUI  = applyRoleUI;
window.requireAdmin = requireAdmin;
