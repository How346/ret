
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS receipt_margin_top numeric(5,2) NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS receipt_margin_bottom numeric(5,2) NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS receipt_margin_left numeric(5,2) NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS receipt_margin_right numeric(5,2) NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS receipt_bold boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS receipt_line_height numeric(4,2) NOT NULL DEFAULT 1.30;
