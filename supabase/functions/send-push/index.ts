// ═══════════════════════════════════════════════════════════════
// Supabase Edge Function — send-push
// File: supabase/functions/send-push/index.ts
//
// Cara deploy:
//   supabase functions deploy send-push --no-verify-jwt
//
// Secrets yang harus di-set dulu:
//   supabase secrets set VAPID_PUBLIC_KEY="..."
//   supabase secrets set VAPID_PRIVATE_KEY="..."
//   supabase secrets set VAPID_SUBJECT="mailto:email@kamu.com"
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Baca payload dari Webhook ──────────────────────────────────
    const body = await req.json();

    // Payload dari Supabase Database Webhook saat INSERT di tabel orders:
    // { type: "INSERT", table: "orders", record: { id, brand_id, pemesan, ... } }
    const record = body?.record;

    if (!record) {
      return new Response(JSON.stringify({ error: 'No record in payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ── Setup VAPID ──────────────────────────────────────────────
    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT')!,
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!
    );

    // ── Koneksi ke Supabase pakai service_role (bypass RLS) ────────
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ── Ambil semua subscription dari DB ──────────────────────────
    const { data: subscriptions, error: fetchError } = await sb
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth');

    if (fetchError) throw fetchError;
    if (!subscriptions || subscriptions.length === 0) {
      console.log('[send-push] Tidak ada subscriber, skip.');
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ── Ambil nama brand dari tabel brands (jika ada) ─────────────
    let brandName = 'Brand';
    if (record.brand_id) {
      const { data: brandData } = await sb
        .from('brands')
        .select('name')
        .eq('id', record.brand_id)
        .single();
      if (brandData?.name) brandName = brandData.name;
    }

    // ── Susun payload notifikasi ──────────────────────────────────
    const orderId  = (record.id || '').substring(0, 8).toUpperCase();
    const pemesan  = record.pemesan || record.created_by || 'Tim';
    const notifPayload = JSON.stringify({
      title: '🛒 Order Baru Masuk!',
      body : `[${brandName}] dari ${pemesan} — ID: ${orderId}`,
      icon : '/favicon.ico',
      badge: '/favicon.ico',
      tag  : `order-masuk-${record.id}`,
      data : {
        url    : '/Purchasing-os/ordermasuk.html',
        orderId: record.id
      }
    });

    // ── Kirim push ke semua subscriber ───────────────────────────
    let sent   = 0;
    let failed = 0;
    const expiredEndpoints: string[] = [];

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys    : { p256dh: sub.p256dh, auth: sub.auth }
            },
            notifPayload,
            { TTL: 60 * 60 } // pesan disimpan 1 jam kalau browser offline
          );
          sent++;
        } catch (err: unknown) {
          failed++;
          // Status 404/410 = subscription sudah tidak valid, hapus dari DB
          const statusCode = (err as { statusCode?: number })?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            expiredEndpoints.push(sub.endpoint);
          } else {
            console.error('[send-push] Gagal kirim ke', sub.endpoint.substring(0, 50), err);
          }
        }
      })
    );

    // ── Hapus subscription yang expired ──────────────────────────
    if (expiredEndpoints.length > 0) {
      await sb
        .from('push_subscriptions')
        .delete()
        .in('endpoint', expiredEndpoints);
      console.log(`[send-push] Hapus ${expiredEndpoints.length} expired subscriptions`);
    }

    console.log(`[send-push] Selesai. Terkirim: ${sent}, Gagal: ${failed}`);

    return new Response(
      JSON.stringify({ sent, failed, expired: expiredEndpoints.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[send-push] Error:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
