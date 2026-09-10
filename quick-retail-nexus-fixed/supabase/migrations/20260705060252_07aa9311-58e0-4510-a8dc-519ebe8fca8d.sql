
-- Stores table
CREATE TABLE IF NOT EXISTS public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stores TO authenticated;
GRANT ALL ON public.stores TO service_role;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stores_select_all ON public.stores;
CREATE POLICY stores_select_all ON public.stores FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS stores_admin_write ON public.stores;
CREATE POLICY stores_admin_write ON public.stores FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS stores_touch ON public.stores;
CREATE TRIGGER stores_touch BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- profiles.store_id
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL;

-- helper: current user's store
CREATE OR REPLACE FUNCTION public.current_store_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT store_id FROM public.profiles WHERE id = auth.uid() $$;

-- add store_id + trigger + RLS to a table
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','categories','customers','suppliers','sales','purchases','held_bills']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(store_id)', t||'_store_id_idx', t);
  END LOOP;
END $$;

-- Auto-fill store_id from profile on insert
CREATE OR REPLACE FUNCTION public.fill_store_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.store_id IS NULL THEN
    NEW.store_id := public.current_store_id();
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','categories','customers','suppliers','sales','purchases','held_bills']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t||'_fill_store', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fill_store_id()', t||'_fill_store', t);
  END LOOP;
END $$;

-- Store-scoped RLS: user sees rows in their store OR legacy NULL rows OR admin sees all
DO $$
DECLARE t text; polname text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','categories','customers','suppliers','sales','purchases','held_bills']
  LOOP
    polname := t || '_store_scope';
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', polname, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      || 'USING (store_id IS NULL OR store_id = public.current_store_id() OR public.has_role(auth.uid(),''admin'')) '
      || 'WITH CHECK (store_id IS NULL OR store_id = public.current_store_id() OR public.has_role(auth.uid(),''admin''))',
      polname, t);
  END LOOP;
END $$;
