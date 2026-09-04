
-- Store / shop settings (single row)
create table if not exists public.store_settings (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique,
  shop_name text not null default 'My Shop',
  address text,
  phone text,
  email text,
  gstin text,
  state text,
  state_code text,
  logo_url text,
  invoice_prefix text not null default 'INV',
  invoice_footer text default 'Thank you for your business!',
  terms text,
  paper_size text not null default '80mm', -- '58mm' | '80mm' | 'A4'
  print_copies int not null default 1,
  show_logo boolean not null default true,
  show_gstin boolean not null default true,
  show_footer boolean not null default true,
  auto_print boolean not null default false,
  bank_name text,
  bank_account text,
  bank_ifsc text,
  upi_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.store_settings enable row level security;

create policy "store_settings_select_auth" on public.store_settings
  for select to authenticated using (true);

create policy "store_settings_admin_write" on public.store_settings
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create trigger store_settings_touch
  before update on public.store_settings
  for each row execute function public.touch_updated_at();

-- Seed default row
insert into public.store_settings (shop_name) values ('My Shop')
on conflict (singleton) do nothing;

-- Track sale edits
alter table public.sales add column if not exists updated_at timestamptz not null default now();
alter table public.sales add column if not exists edited_by uuid;

drop trigger if exists sales_touch on public.sales;
create trigger sales_touch
  before update on public.sales
  for each row execute function public.touch_updated_at();

-- Logo storage bucket
insert into storage.buckets (id, name, public)
values ('store-assets', 'store-assets', true)
on conflict (id) do nothing;

create policy "store_assets_public_read" on storage.objects
  for select using (bucket_id = 'store-assets');

create policy "store_assets_admin_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'store-assets' and public.has_role(auth.uid(), 'admin'));

create policy "store_assets_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'store-assets' and public.has_role(auth.uid(), 'admin'));

create policy "store_assets_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'store-assets' and public.has_role(auth.uid(), 'admin'));
