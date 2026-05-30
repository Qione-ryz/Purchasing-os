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
/** Cek apakah role punya privilege admin-level (admin atau superadmin). */
function isAdminLevel(role) {
  return role === 'admin' || role === 'superadmin';
}

function applyRoleUI(role) {
  window._userRole = role;
  window._isAdmin  = isAdminLevel(role);
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = window._isAdmin ? '' : 'none';
  });
  /* Tampilkan badge role di sidebar */
  const roleEl = document.getElementById('userRole');
  if (roleEl) {
    if (role === 'superadmin') {
      roleEl.textContent = 'Superadmin';
      roleEl.style.color = '#a78bfa';
    } else if (role === 'admin') {
      roleEl.textContent = 'Admin';
      roleEl.style.color = 'var(--accent2)';
    } else {
      roleEl.textContent = role ? (role[0].toUpperCase()+role.slice(1)) : 'User';
      roleEl.style.color = 'var(--muted)';
    }
  }
}

/** Cek apakah user boleh melakukan aksi admin-level (admin atau superadmin). */
function requireAdmin(showToastFn) {
  if (!isAdminLevel(window._userRole)) {
    if (showToastFn) showToastFn('Hanya admin yang bisa melakukan aksi ini.', 'error');
    return false;
  }
  return true;
}

window.getUserRole  = getUserRole;
window.applyRoleUI  = applyRoleUI;
window.requireAdmin = requireAdmin;
window.isAdminLevel = isAdminLevel;
