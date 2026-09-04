
-- Printer profiles
CREATE TABLE public.printer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  config jsonb NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.printer_profiles TO authenticated;
GRANT ALL ON public.printer_profiles TO service_role;
ALTER TABLE public.printer_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pp_owner_all" ON public.printer_profiles FOR ALL TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL) WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Add blocked flag to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false;

-- Admin can update any profile (block/unblock)
DROP POLICY IF EXISTS profiles_admin_update ON public.profiles;
CREATE POLICY profiles_admin_update ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Licenses
CREATE TABLE public.licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  plan text NOT NULL DEFAULT 'standard',
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active', -- active, revoked
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX licenses_user_id_idx ON public.licenses(user_id);
CREATE INDEX licenses_key_idx ON public.licenses(key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.licenses TO authenticated;
GRANT ALL ON public.licenses TO service_role;
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

-- Users can read their own license
CREATE POLICY licenses_select_own ON public.licenses FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
-- Only admin can insert/update/delete
CREATE POLICY licenses_admin_insert ON public.licenses FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY licenses_admin_update ON public.licenses FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY licenses_admin_delete ON public.licenses FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
-- Allow authenticated user to redeem an unassigned key (bind key -> self)
CREATE POLICY licenses_redeem ON public.licenses FOR UPDATE TO authenticated
  USING (user_id IS NULL) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER licenses_touch BEFORE UPDATE ON public.licenses
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER printer_profiles_touch BEFORE UPDATE ON public.printer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
