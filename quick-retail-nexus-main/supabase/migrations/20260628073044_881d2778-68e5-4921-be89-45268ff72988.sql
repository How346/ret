
-- Add receipt customization & bill no format settings
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS receipt_font_size integer NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS show_gst_breakdown boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS bill_no_format text NOT NULL DEFAULT 'short';

-- Shorter invoice number generator: e.g. B-00042 (resettable sequence)
CREATE SEQUENCE IF NOT EXISTS public.invoice_short_seq START 1;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.invoice_short_seq TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.next_invoice_no_short()
RETURNS text LANGUAGE sql AS $$
  SELECT 'B' || lpad(nextval('public.invoice_short_seq')::text, 5, '0')
$$;

-- Allow categories CRUD for any authenticated user (currently policy unknown). Re-enable broad access.
DROP POLICY IF EXISTS "auth manage categories" ON public.categories;
CREATE POLICY "auth manage categories" ON public.categories
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Open sales edit/delete to all authenticated users (cashier inclusive)
DROP POLICY IF EXISTS "auth manage sales" ON public.sales;
CREATE POLICY "auth manage sales" ON public.sales
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth manage sale_items" ON public.sale_items;
CREATE POLICY "auth manage sale_items" ON public.sale_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
