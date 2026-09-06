ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS whatsapp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS whatsapp_country_code text NOT NULL DEFAULT '91';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS whatsapp_message_template text
  NOT NULL DEFAULT 'Hi {customer}, thank you for shopping at {shop}! Your bill {invoice} of {total} is attached. Visit again!';
