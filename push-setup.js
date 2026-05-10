// ═══════════════════════════════════════════════
// push-setup.js — PurchaseOS Web Push Helper
// ═══════════════════════════════════════════════
// Taruh di root folder repo, load SETELAH supabase client siap.
// Cara pakai: <script src="push-setup.js" defer></script>
// Lalu panggil: initWebPush(supabaseClient)

// ── GANTI dengan VAPID Public Key kamu ───────────────────────────────────────
// Generate pakai: npx web-push generate-vapid-keys
// Simpan private key di Supabase Secrets dengan nama: VAPID_PRIVATE_KEY
// Simpan juga VAPID_PUBLIC_KEY dan VAPID_SUBJECT di Secrets
const VAPID_PUBLIC_KEY = 'BEvXzS-b9Jh7SJPq5DVMVn_fuum11A83y2DFygDzOB2n5_kynxhnnuJNtYb0e_BwE-7DggHm6CVX58mqEQQ6ww4';
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Konversi VAPID public key dari base64 ke Uint8Array
 * (format yang dibutuhkan browser untuk subscribe)
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

/**
 * Simpan subscription ke tabel push_subscriptions di Supabase
 * Retry hingga 3x jika user session belum siap (race condition saat page load)
 */
async function saveSubscriptionToDB(sb, subscription) {
  let user = null;

  // Retry sampai 3x dengan delay 1 detik — Supabase kadang belum refresh token
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data } = await sb.auth.getUser();
    if (data?.user) { user = data.user; break; }
    if (attempt < 3) await new Promise(r => setTimeout(r, 1000));
  }

  if (!user) {
    console.warn('[Push] User belum login setelah 3x retry, skip simpan subscription');
    return;
  }

  const subJson  = subscription.toJSON();
  const endpoint = subJson.endpoint;
  const p256dh   = subJson.keys?.p256dh;
  const auth     = subJson.keys?.auth;

  // Upsert: kalau endpoint sudah ada, update; kalau baru, insert
  const { error } = await sb
    .from('push_subscriptions')
    .upsert(
      {
        user_id  : user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: navigator.userAgent.substring(0, 200),
        updated_at: new Date().toISOString()
      },
      { onConflict: 'endpoint' }
    );

  if (error) {
    console.error('[Push] Gagal simpan subscription:', error);
  } else {
    console.log('[Push] Subscription tersimpan ✓ user:', user.email || user.id);
  }
}

/**
 * Hapus subscription dari DB (dipanggil saat user unsubscribe)
 */
async function removeSubscriptionFromDB(sb, endpoint) {
  const { error } = await sb
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint);

  if (error) {
    console.error('[Push] Gagal hapus subscription:', error);
  }
}

/**
 * Fungsi utama — panggil ini saat halaman load
 * @param {object} sb - Supabase client (_sb)
 * @param {object} opts - { onSuccess, onDenied, onError }
 */
async function initWebPush(sb, opts = {}) {
  // Cek dukungan browser
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[Push] Browser tidak mendukung Web Push');
    opts.onError?.('browser_unsupported');
    return;
  }

  // file:// tidak didukung — Service Worker butuh http/https
  if (location.protocol === 'file:') {
    console.warn('[Push] Web Push tidak tersedia di file:// — buka via http/https');
    opts.onError?.('file_protocol');
    return;
  }

  try {
    // 1. Register Service Worker
    //    Pakai path relatif terhadap halaman ini, bukan hardcode '/sw.js'
    //    Supaya benar di GitHub Pages subdirectory maupun custom domain:
    //      https://user.github.io/Purchasing-os/ordermasuk.html
    //        → swUrl  = /Purchasing-os/sw.js   ✓
    //        → scope  = /Purchasing-os/         ✓
    //      https://myapp.com/ordermasuk.html
    //        → swUrl  = /sw.js                 ✓
    //        → scope  = /                      ✓
    let registration;
    try {
      const swUrl  = new URL('sw.js', location.href).pathname;
      const swScope= new URL('./',    location.href).pathname;
      registration = await navigator.serviceWorker.register(swUrl, { scope: swScope });
      await navigator.serviceWorker.ready;
      console.log('[Push] Service Worker siap ✓', swUrl, '(scope:', swScope + ')');
    } catch (swErr) {
      console.warn('[Push] Gagal register Service Worker:', swErr.message);
      opts.onError?.('sw_register_failed');
      return;
    }

    // 2. Minta izin notifikasi
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('[Push] Izin notifikasi ditolak');
      opts.onDenied?.();
      return;
    }

    // 3. Cek apakah sudah ada subscription aktif
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly     : true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
      console.log('[Push] Subscription baru dibuat ✓');
    } else {
      console.log('[Push] Subscription sudah ada ✓');
    }

    // 4. Simpan ke Supabase
    await saveSubscriptionToDB(sb, subscription);

    opts.onSuccess?.();

    // 5. Listen pesan dari SW (jika subscription berubah)
    navigator.serviceWorker.addEventListener('message', async (event) => {
      if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') {
        console.log('[Push] Re-subscribe karena subscription berubah...');
        await initWebPush(sb, opts);
      }
    });

    return subscription;

  } catch (err) {
    console.error('[Push] Error setup:', err);
    opts.onError?.(err.message);
  }
}

/**
 * Unsubscribe user dari push notification (opsional, untuk tombol toggle)
 */
async function disableWebPush(sb) {
  try {
    const registration  = await navigator.serviceWorker.getRegistration('/');
    if (!registration) return;
    const subscription  = await registration.pushManager.getSubscription();
    if (!subscription)  return;

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await removeSubscriptionFromDB(sb, endpoint);
    console.log('[Push] Unsubscribed ✓');
  } catch (err) {
    console.error('[Push] Error unsubscribe:', err);
  }
}

// Export ke global scope
window.initWebPush    = initWebPush;
window.disableWebPush = disableWebPush;
