
-- Roles enum & user_roles table
create type public.app_role as enum ('admin','manager','cashier');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- Auto profile + role on signup (first user => admin)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  user_count int;
begin
  insert into public.profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  select count(*) into user_count from public.user_roles;
  if user_count = 0 then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  else
    insert into public.user_roles (user_id, role) values (new.id, 'cashier');
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles policies
create policy "profiles_select_auth" on public.profiles for select to authenticated using (true);
create policy "profiles_update_self" on public.profiles for update to authenticated using (auth.uid() = id);

-- user_roles policies
create policy "roles_select_auth" on public.user_roles for select to authenticated using (true);
create policy "roles_admin_manage" on public.user_roles for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Categories
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);
alter table public.categories enable row level security;
create policy "cat_all_auth" on public.categories for all to authenticated using (true) with check (true);

-- Products
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text unique,
  barcode text unique,
  hsn_code text,
  category_id uuid references public.categories(id) on delete set null,
  unit text not null default 'PCS',
  mrp numeric(12,2) not null default 0,
  sale_price numeric(12,2) not null default 0,
  wholesale_price numeric(12,2) not null default 0,
  purchase_price numeric(12,2) not null default 0,
  gst_rate numeric(5,2) not null default 0,
  stock numeric(12,3) not null default 0,
  low_stock_alert numeric(12,3) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.products enable row level security;
create policy "prod_all_auth" on public.products for all to authenticated using (true) with check (true);
create index on public.products (name);
create index on public.products (barcode);
create index on public.products (sku);

-- Customers
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  gstin text,
  balance numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
alter table public.customers enable row level security;
create policy "cust_all_auth" on public.customers for all to authenticated using (true) with check (true);

-- Sales
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  customer_id uuid references public.customers(id) on delete set null,
  cashier_id uuid references auth.users(id) on delete set null,
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  cgst numeric(12,2) not null default 0,
  sgst numeric(12,2) not null default 0,
  igst numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  paid_cash numeric(12,2) not null default 0,
  paid_card numeric(12,2) not null default 0,
  paid_upi numeric(12,2) not null default 0,
  status text not null default 'completed',
  notes text,
  created_at timestamptz not null default now()
);
alter table public.sales enable row level security;
create policy "sales_all_auth" on public.sales for all to authenticated using (true) with check (true);
create index on public.sales (created_at desc);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  hsn_code text,
  qty numeric(12,3) not null,
  price numeric(12,2) not null,
  discount numeric(12,2) not null default 0,
  gst_rate numeric(5,2) not null default 0,
  gst_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null
);
alter table public.sale_items enable row level security;
create policy "saleitems_all_auth" on public.sale_items for all to authenticated using (true) with check (true);

-- Stock ledger
create table public.stock_ledger (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  change numeric(12,3) not null,
  reason text not null,
  ref_id uuid,
  created_at timestamptz not null default now()
);
alter table public.stock_ledger enable row level security;
create policy "ledger_all_auth" on public.stock_ledger for all to authenticated using (true) with check (true);

-- Held bills (park/recall)
create table public.held_bills (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid references auth.users(id) on delete cascade,
  label text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.held_bills enable row level security;
create policy "held_all_auth" on public.held_bills for all to authenticated using (true) with check (true);

-- Invoice number generator
create sequence if not exists public.invoice_seq start 1;
create or replace function public.next_invoice_no()
returns text language sql as $$
  select 'INV-' || to_char(now(),'YYYYMMDD') || '-' || lpad(nextval('public.invoice_seq')::text, 5, '0')
$$;

-- updated_at trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();
