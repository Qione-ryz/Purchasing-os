-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Enable RLS + Copy Policies dari project lama
-- Run di Supabase Dashboard → SQL Editor (project baru)
-- ═══════════════════════════════════════════════════════════════

-- ─── STEP 1: Enable RLS di semua tabel yang punya policy ─────────
ALTER TABLE public.activity_log              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barang                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barang_barcodes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barang_brands             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barang_request            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barang_satuan_order       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brands                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_audit           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_audit_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_stock           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transfer        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transfer_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kategori                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pastry                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pastry_riwayat            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pemesan                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pemesan_config            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.riwayat_beli              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.riwayat_beli_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.riwayat_harga             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.satuan                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_mappings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.so_barang_config          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.so_item_group_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.so_item_groups            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_opname              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_brands             ENABLE ROW LEVEL SECURITY;

-- ─── STEP 2: Create Policies ──────────────────────────────────────

-- activity_log
CREATE POLICY "admin can read all logs" ON public.activity_log AS PERMISSIVE FOR SELECT TO public USING ((( SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = 'admin'::text));
CREATE POLICY "authenticated can insert log" ON public.activity_log AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "user can read own logs" ON public.activity_log AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

-- app_settings
CREATE POLICY "admin only update settings" ON public.app_settings AS PERMISSIVE FOR ALL TO public USING ((( SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = 'admin'::text));
CREATE POLICY "all can read settings" ON public.app_settings AS PERMISSIVE FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));

-- barang
CREATE POLICY "anon read barang" ON public.barang AS PERMISSIVE FOR SELECT TO anon USING (true);
CREATE POLICY auth_all ON public.barang AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- barang_barcodes
CREATE POLICY "anon full access" ON public.barang_barcodes AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);

-- barang_brands
CREATE POLICY "anon read barang_brands" ON public.barang_brands AS PERMISSIVE FOR SELECT TO anon USING (true);
CREATE POLICY auth_all ON public.barang_brands AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- barang_request
CREATE POLICY "barang_request: baca bebas" ON public.barang_request AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "barang_request: insert bebas" ON public.barang_request AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);

-- barang_satuan_order
CREATE POLICY "anon can read satuan_order" ON public.barang_satuan_order AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "anon read barang_satuan_order" ON public.barang_satuan_order AS PERMISSIVE FOR SELECT TO anon USING (true);
CREATE POLICY "auth can write satuan_order" ON public.barang_satuan_order AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));

-- brands
CREATE POLICY "anon read brands" ON public.brands AS PERMISSIVE FOR SELECT TO anon USING (true);
CREATE POLICY auth_all ON public.brands AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- inventory_*
CREATE POLICY "anon full access" ON public.inventory_audit AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "anon full access" ON public.inventory_audit_items AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "anon full access" ON public.inventory_log AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "anon full access" ON public.inventory_stock AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "anon full access" ON public.inventory_transfer AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "anon full access" ON public.inventory_transfer_items AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);

-- kategori
CREATE POLICY allow_all_authenticated ON public.kategori AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));

-- order_items
CREATE POLICY "allow update order_items" ON public.order_items AS PERMISSIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon delete order_items pending" ON public.order_items AS PERMISSIVE FOR DELETE TO anon USING ((order_id IN ( SELECT orders.id FROM orders WHERE (orders.status = 'pending'::text))));
CREATE POLICY "anon insert order_items" ON public.order_items AS PERMISSIVE FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon read order_items" ON public.order_items AS PERMISSIVE FOR SELECT TO anon USING (true);
CREATE POLICY "anon update order_items pending" ON public.order_items AS PERMISSIVE FOR UPDATE TO anon USING ((order_id IN ( SELECT orders.id FROM orders WHERE (orders.status = 'pending'::text))));
CREATE POLICY "auth delete order_items" ON public.order_items AS PERMISSIVE FOR DELETE TO authenticated USING (true);
CREATE POLICY "order_items: baca bebas" ON public.order_items AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "order_items: insert bebas" ON public.order_items AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "pemesan can update own order_items" ON public.order_items AS PERMISSIVE FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "purchasing can update order_items" ON public.order_items AS PERMISSIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- orders
CREATE POLICY "allow update orders" ON public.orders AS PERMISSIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon insert orders" ON public.orders AS PERMISSIVE FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon read orders" ON public.orders AS PERMISSIVE FOR SELECT TO anon USING (true);
CREATE POLICY "anon update order pending" ON public.orders AS PERMISSIVE FOR UPDATE TO anon USING ((status = 'pending'::text)) WITH CHECK ((status = 'pending'::text));
CREATE POLICY "auth delete orders" ON public.orders AS PERMISSIVE FOR DELETE TO authenticated USING (true);
CREATE POLICY "orders: baca bebas" ON public.orders AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "orders: insert bebas" ON public.orders AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "pemesan can update own orders" ON public.orders AS PERMISSIVE FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- pastry
CREATE POLICY "public can delete pastry" ON public.pastry AS PERMISSIVE FOR DELETE TO public USING (true);
CREATE POLICY "public can insert pastry" ON public.pastry AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "public can read pastry" ON public.pastry AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "public can update pastry" ON public.pastry AS PERMISSIVE FOR UPDATE TO public USING (true) WITH CHECK (true);

-- pastry_riwayat
CREATE POLICY "public can delete pastry_riwayat" ON public.pastry_riwayat AS PERMISSIVE FOR DELETE TO public USING (true);
CREATE POLICY "public can insert pastry_riwayat" ON public.pastry_riwayat AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "public can read pastry_riwayat" ON public.pastry_riwayat AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "public can update pastry_riwayat" ON public.pastry_riwayat AS PERMISSIVE FOR UPDATE TO public USING (true) WITH CHECK (true);

-- pemesan
CREATE POLICY "pemesan: baca bebas" ON public.pemesan AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "pemesan: tulis authenticated" ON public.pemesan AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));

-- pemesan_config
CREATE POLICY "anon full access" ON public.pemesan_config AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);

-- profiles
CREATE POLICY "admin can update roles" ON public.profiles AS PERMISSIVE FOR UPDATE TO public USING ((( SELECT profiles_1.role FROM profiles profiles_1 WHERE (profiles_1.id = auth.uid())) = 'admin'::text));
CREATE POLICY "user can read own profile" ON public.profiles AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = id));
CREATE POLICY "user can update own nama" ON public.profiles AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));

-- push_subscriptions
CREATE POLICY "Service role full access" ON public.push_subscriptions AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users can manage own subscriptions" ON public.push_subscriptions AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

-- riwayat_beli
CREATE POLICY auth_all ON public.riwayat_beli AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- riwayat_beli_items
CREATE POLICY auth_all ON public.riwayat_beli_items AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- riwayat_harga
CREATE POLICY "anon read riwayat_harga" ON public.riwayat_harga AS PERMISSIVE FOR SELECT TO anon USING (true);
CREATE POLICY auth_all ON public.riwayat_harga AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "riwayat_harga: baca bebas" ON public.riwayat_harga AS PERMISSIVE FOR SELECT TO public USING (true);

-- satuan
CREATE POLICY allow_all_authenticated ON public.satuan AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "anon read satuan" ON public.satuan AS PERMISSIVE FOR SELECT TO anon USING (true);

-- scan_mappings
CREATE POLICY scan_mappings_insert ON public.scan_mappings AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY scan_mappings_select ON public.scan_mappings AS PERMISSIVE FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY scan_mappings_update ON public.scan_mappings AS PERMISSIVE FOR UPDATE TO public USING ((auth.role() = 'authenticated'::text));

-- so_barang_config
CREATE POLICY "anon full" ON public.so_barang_config AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "authenticated read" ON public.so_barang_config AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated write" ON public.so_barang_config AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- so_item_group_members
CREATE POLICY "anon full" ON public.so_item_group_members AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY read_so_item_group_members ON public.so_item_group_members AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY write_so_item_group_members ON public.so_item_group_members AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));

-- so_item_groups
CREATE POLICY "anon full" ON public.so_item_groups AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY read_so_item_groups ON public.so_item_groups AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY write_so_item_groups ON public.so_item_groups AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));

-- stock_opname
CREATE POLICY "Authenticated can read stock_opname" ON public.stock_opname AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can update stock_opname" ON public.stock_opname AS PERMISSIVE FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can upsert stock_opname" ON public.stock_opname AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);

-- vendor
CREATE POLICY auth_all ON public.vendor AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- vendor_brands
CREATE POLICY auth_all ON public.vendor_brands AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
