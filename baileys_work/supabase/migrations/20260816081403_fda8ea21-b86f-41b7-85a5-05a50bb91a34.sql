ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url text;

CREATE TABLE IF NOT EXISTS public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  label text,
  barcode text,
  mrp numeric NOT NULL DEFAULT 0,
  sale_price numeric NOT NULL DEFAULT 0,
  purchase_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variants TO authenticated;
GRANT ALL ON public.product_variants TO service_role;

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "variants_store_scope" ON public.product_variants FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND (p.store_id IS NULL OR p.store_id = public.current_store_id() OR public.has_role(auth.uid(), 'admin'::app_role))))
WITH CHECK (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND (p.store_id IS NULL OR p.store_id = public.current_store_id() OR public.has_role(auth.uid(), 'admin'::app_role))));

CREATE INDEX IF NOT EXISTS product_variants_product_idx ON public.product_variants(product_id);
CREATE INDEX IF NOT EXISTS product_variants_barcode_idx ON public.product_variants(barcode);

CREATE TRIGGER product_variants_touch BEFORE UPDATE ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();