-- Preserve the exact purchase-line barcode and selling fields entered on a purchase bill.
-- Existing rows remain valid; edit screens fall back to the current product master when these are NULL.
ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS mrp numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sale_price numeric NOT NULL DEFAULT 0;
