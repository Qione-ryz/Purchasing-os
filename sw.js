// ═══════════════════════════════════════════════
// SERVICE WORKER — PurchaseOS Push Notification
// ═══════════════════════════════════════════════
// File ini harus ada di ROOT folder repo (sejajar index.html / ordermasuk.html)

const SW_VERSION = 'v1.0.0';

self.addEventListener('install', (event) => {
  console.log('[SW] Installed', SW_VERSION);
  self.skipWaiting(); // Langsung aktif tanpa tunggu tab lama ditutup
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activated', SW_VERSION);
  event.waitUntil(self.clients.claim()); // Ambil kontrol semua tab sekarang
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
    vibrate    : [200, 100, 200],  // pola getar di HP
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

  // Buka / fokus ke tab ordermasuk.html
  const targetUrl = event.notification.data.url || '/Purchasing-os/ordermasuk.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Cek apakah tab ordermasuk sudah terbuka
      for (const client of clients) {
        if (client.url.includes('ordermasuk') && 'focus' in client) {
          return client.focus();
        }
      }
      // Kalau belum ada, buka tab baru
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// ── HANDLE PUSH SUBSCRIPTION CHANGE ─────────────────────────────────────────
// Dipanggil browser jika subscription expired / berubah
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[SW] Subscription berubah, perlu re-subscribe');
  // Kirim pesan ke main thread untuk re-subscribe
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
    });
  });
});
