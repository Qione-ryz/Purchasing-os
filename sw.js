// ═══════════════════════════════════════════════
// SERVICE WORKER — PurchaseOS Push Notification
// ═══════════════════════════════════════════════
// File ini harus ada di ROOT folder repo (sejajar index.html / ordermasuk.html)

const SW_VERSION = 'v1.1.0';

self.addEventListener('install', (event) => {
  console.log('[SW] Installed', SW_VERSION);
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activated', SW_VERSION);
  event.waitUntil(self.clients.claim());
});

// ── HANDLE PUSH EVENT (dari server) ──────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) {
    console.warn('[SW] Push diterima tapi tidak ada data');
    return;
  }

  let payload;
  try {
    payload = event.data.json();
  } catch (e) {
    payload = { title: '🛒 Order Baru!', body: event.data.text() };
  }

  const title   = payload.title || '🛒 Order Baru Masuk!';
  const options = {
    body       : payload.body    || 'Ada pesanan baru masuk.',
    icon       : payload.icon    || '/favicon.ico',
    badge      : payload.badge   || '/favicon.ico',
    tag        : payload.tag     || 'order-masuk',
    data       : payload.data    || {},
    requireInteraction: false,
    vibrate    : [200, 100, 200],
    actions    : [
      { action: 'open',   title: '📋 Lihat Order' },
      { action: 'dismiss',title: '✕ Tutup' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── HANDLE KLIK NOTIFIKASI ────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data.url || './ordermasuk.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes('ordermasuk') && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// ── HANDLE PUSH SUBSCRIPTION CHANGE ─────────────────────────────────────────
// Dipanggil browser otomatis jika subscription expired / berubah
const VAPID_PUBLIC_KEY = 'BEvXzS-b9Jh7SJPq5DVMVn_fuum11A83y2DFygDzOB2n5_kynxhnnuJNtYb0e_BwE-7DggHm6CVX58mqEQQ6ww4';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[SW] Subscription berubah, re-subscribe otomatis...');

  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly     : true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    })
    .then(async (newSubscription) => {
      console.log('[SW] Re-subscribe berhasil ✓');
      const subJson = newSubscription.toJSON();

      // Kirim ke tab yang terbuka — push-setup.js akan simpan ke Supabase
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      if (clients.length > 0) {
        clients.forEach(client => {
          client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED', subscription: subJson });
        });
        console.log('[SW] Subscription baru dikirim ke tab ✓');
      } else {
        // Tidak ada tab terbuka — initWebPush() akan upsert saat halaman dibuka berikutnya
        console.log('[SW] Tidak ada tab terbuka, subscription tersimpan saat halaman dibuka');
      }
    })
    .catch((err) => {
      console.error('[SW] Re-subscribe gagal:', err);
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
        });
      });
    })
  );
});
