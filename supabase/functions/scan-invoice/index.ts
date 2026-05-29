// supabase/functions/scan-invoice/index.ts
// Deploy: supabase functions deploy scan-invoice
// Env var yang dibutuhkan: GEMINI_API_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY tidak ditemukan di environment variables");
    }

    // Terima file sebagai multipart/form-data
    const formData = await req.formData();
    const file = formData.get("invoice") as File;

    if (!file) {
      return new Response(
        JSON.stringify({ error: "File invoice tidak ditemukan. Gunakan field name 'invoice'." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validasi tipe file
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowedTypes.includes(file.type)) {
      return new Response(
        JSON.stringify({ error: `Tipe file tidak didukung: ${file.type}. Gunakan JPG, PNG, atau PDF.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Konversi file ke base64 (chunk-based agar tidak stack overflow untuk file besar)
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);

    // Tentukan mimeType untuk Gemini
    // PDF dikirim sebagai inline_data juga (Gemini 1.5 support PDF)
    const mimeType = file.type;

    // Prompt ekstraksi invoice
    const prompt = `Kamu adalah sistem ekstraksi data invoice yang akurat.
Analisis invoice ini dan ekstrak semua informasi yang tersedia.

Kembalikan HANYA JSON valid (tanpa markdown, tanpa komentar, tanpa teks lain) dengan struktur berikut:

{
  "nomor_faktur": "nomor invoice/faktur/PO (string, kosong jika tidak ada)",
  "tanggal": "tanggal dalam format YYYY-MM-DD (kosong jika tidak jelas)",
  "vendor": "nama vendor/supplier/penjual (string)",
  "catatan": "catatan relevan dari invoice jika ada (string, kosong jika tidak ada)",
  "ppn_included": true/false (true jika harga sudah termasuk PPN, false jika harga belum termasuk PPN/harga netto/harga exclude PPN),
  "diskon": angka dalam rupiah (0 jika tidak ada),
  "ongkir": angka dalam rupiah (0 jika tidak ada),
  "items": [
    {
      "nama": "nama barang",
      "qty": angka,
      "satuan": "pcs/kg/box/dll (kosong jika tidak ada)",
      "harga_satuan": angka dalam rupiah (harga per satuan, bukan subtotal)
    }
  ]
}

Aturan penting:
- Semua angka harga dalam Rupiah (tanpa titik/koma pemisah)
- Jika mata uang bukan IDR, konversi tidak perlu dilakukan, cukup ambil angkanya saja
- Jika ada diskon per-item, abaikan dan gunakan harga setelah diskon sebagai harga_satuan
- Jika tanggal tidak jelas, kembalikan string kosong
- Jangan mengarang data yang tidak ada di invoice
- PENTING untuk ppn_included: invoice Indonesia yang tidak mencantumkan keterangan PPN sama sekali biasanya sudah include PPN. Set ppn_included=true jika tidak ada kolom/baris PPN terpisah di invoice. Set ppn_included=false HANYA jika ada baris PPN terpisah yang ditambahkan ke subtotal, atau ada tulisan "Harga Belum Termasuk PPN", "Exclude PPN", "Netto", atau sejenisnya`;

    // Model fallback — dicoba berurutan jika model sebelumnya 503/429/unavailable
    const MODELS = [
      "gemini-3.1-flash-lite-preview",  // Utama: 500 RPD free
      "gemini-2.5-flash",               // Fallback 1: 20 RPD
      "gemini-2.0-flash-lite",          // Fallback 2: stable
    ];

    const requestBody = JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: prompt },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            nomor_faktur: { type: "string" },
            tanggal:      { type: "string" },
            vendor:       { type: "string" },
            catatan:      { type: "string" },
            ppn_included: { type: "boolean" },
            diskon:       { type: "number" },
            ongkir:       { type: "number" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  nama:         { type: "string" },
                  qty:          { type: "number" },
                  satuan:       { type: "string" },
                  harga_satuan: { type: "number" },
                },
                required: ["nama", "qty", "harga_satuan"],
              },
            },
          },
          required: ["nomor_faktur", "tanggal", "vendor", "ppn_included", "items"],
        },
      },
    });

    let geminiData: Record<string, unknown> | null = null;
    let lastError = "";

    for (const model of MODELS) {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
        }
      );

      if (geminiRes.ok) {
        geminiData = await geminiRes.json();
        console.log(`[scan-invoice] Berhasil dengan model: ${model}`);
        break;
      }

      const errText = await geminiRes.text();
      lastError = `${model} error ${geminiRes.status}: ${errText}`;
      console.warn(`[scan-invoice] ${lastError} — mencoba model berikutnya...`);

      // Hanya fallback untuk error server-side (503, 429, 500)
      // Error 400 (bad request) atau 404 (model tidak ada) tidak perlu retry model lain
      if (geminiRes.status === 400) {
        throw new Error(`Request tidak valid: ${errText}`);
      }

      // Jeda singkat sebelum coba model berikutnya
      await new Promise(r => setTimeout(r, 500));
    }

    if (!geminiData) {
      throw new Error(`Semua model Gemini tidak tersedia saat ini. Error terakhir: ${lastError}`);
    }

    // Ekstrak teks dari response Gemini
    const rawText = (geminiData as Record<string, unknown>)?.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined;
    if (!rawText) {
      throw new Error("Gemini tidak mengembalikan hasil. Pastikan invoice terbaca dengan jelas.");
    }

    // Parse JSON dari response Gemini
    // Bersihkan jika ada markdown fence
    const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let extracted;
    try {
      extracted = JSON.parse(cleaned);
    } catch {
      throw new Error("Gagal memparse hasil dari Gemini. Response: " + rawText.substring(0, 200));
    }

    // Validasi struktur minimal
    if (!extracted.items || !Array.isArray(extracted.items)) {
      extracted.items = [];
    }

    // Sanitasi angka — handle kalau Gemini return "Rp 10.000" atau "10,000"
    const toNum = (v: unknown): number => {
      if (typeof v === "number" && !isNaN(v)) return v;
      if (typeof v === "string") {
        const cleaned = v.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(/,/g, ".");
        const n = parseFloat(cleaned);
        return isNaN(n) ? 0 : n;
      }
      return 0;
    };

    extracted.diskon = toNum(extracted.diskon);
    extracted.ongkir = toNum(extracted.ongkir);
    extracted.items = extracted.items.map((it: Record<string, unknown>) => ({
      nama:         String(it.nama || "").trim(),
      qty:          toNum(it.qty) || 1,
      satuan:       String(it.satuan || "").trim(),
      harga_satuan: toNum(it.harga_satuan),
    })).filter((it: { nama: string }) => it.nama.trim().length > 0);

    return new Response(
      JSON.stringify({ success: true, data: extracted }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("scan-invoice error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Terjadi kesalahan tidak terduga" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
