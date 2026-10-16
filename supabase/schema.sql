-- Genesis Nutrition — Supabase PostgreSQL schema
-- Amber POS is source of truth; this app stores snapshots, matches, batches, audit.

create table if not exists customers (
  customer_id text primary key,
  company text, first_name text, last_name text,
  phone1 text, phone2 text, cell_phone text,
  phone1_normalized text, phone2_normalized text, cell_normalized text,
  email text, member_id text, customer_type text,
  ar numeric, store_credit numeric, points integer not null default 0,
  deposit numeric, referral text, customer_code text,
  date_added date,
  address1 text, address2 text, city text, province text, postal text, country text,
  raw jsonb, updated_at timestamptz not null default now()
);
create index if not exists idx_customers_phone1n on customers (phone1_normalized);
create index if not exists idx_customers_phone2n on customers (phone2_normalized);
create index if not exists idx_customers_celln on customers (cell_normalized);
create index if not exists idx_customers_name on customers (last_name, first_name);

create table if not exists customer_imports (
  id uuid primary key default gen_random_uuid(),
  filename text not null, imported_at timestamptz not null default now(),
  records_processed int not null default 0,
  added int not null default 0, updated int not null default 0,
  unchanged int not null default 0, skipped int not null default 0, failed int not null default 0,
  errors jsonb not null default '[]', file_hash text,
  created_by uuid references auth.users(id)
);

create table if not exists sales_imports (
  id uuid primary key default gen_random_uuid(),
  filename text not null, imported_at timestamptz not null default now(),
  reporting_period text not null,
  records_processed int not null default 0,
  referrer_count int not null default 0,
  total_net_sales numeric not null default 0,
  matched int not null default 0, ambiguous int not null default 0, unmatched int not null default 0,
  errors jsonb not null default '[]', file_hash text unique,
  column_mapping jsonb not null default '{}',
  created_by uuid references auth.users(id)
);

create table if not exists sales_rows (
  id uuid primary key default gen_random_uuid(),
  sales_import_id uuid not null references sales_imports(id) on delete cascade,
  referral_phone_raw text not null, referral_phone_normalized text not null,
  group1 text, group2name text, store_name text,
  qty numeric, gross_sale numeric, markdown numeric, subtotal numeric not null default 0,
  gross_profit numeric, cost numeric, spiff numeric,
  transactions int, raw jsonb, created_at timestamptz not null default now()
);
create index if not exists idx_sales_rows_import on sales_rows (sales_import_id);
create index if not exists idx_sales_rows_phone on sales_rows (referral_phone_normalized);

create table if not exists referral_matches (
  id uuid primary key default gen_random_uuid(),
  sales_import_id uuid not null references sales_imports(id) on delete cascade,
  reporting_period text not null,
  referral_phone_normalized text not null, referral_phone_raw text not null,
  match_status text not null check (match_status in ('matched','ambiguous','unmatched')),
  selected_customer_id text references customers(customer_id),
  resolved_at timestamptz, resolved_by uuid references auth.users(id),
  unique (sales_import_id, referral_phone_normalized)
);

create table if not exists reward_batches (
  id text primary key, reporting_period text not null,
  sales_import_id uuid references sales_imports(id),
  created_at timestamptz not null default now(), filename text not null,
  settings jsonb not null, columns text[] not null default '{CustomerID,Points}',
  status text not null default 'Draft' check (status in ('Draft','Exported','Confirmed','Cancelled')),
  total_net_sales numeric not null default 0,
  total_reward_value numeric not null default 0, total_points int not null default 0,
  applied_to_balances boolean not null default false,
  file_base64 text, created_by uuid references auth.users(id)
);

create table if not exists reward_entries (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null references reward_batches(id) on delete cascade,
  customer_id text not null references customers(customer_id),
  customer_name text not null, referral_phone text not null,
  net_sales numeric not null, reward_pct numeric not null,
  reward_value numeric not null, points_per_dollar numeric not null, points int not null,
  member_id text, ar numeric, store_credit numeric,
  unique (batch_id, customer_id)
);

create table if not exists point_adjustments (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null references reward_batches(id),
  customer_id text not null references customers(customer_id),
  points_added int not null, balance_before int not null, balance_after int not null,
  confirmed_at timestamptz not null default now(),
  note text not null default '', confirmed_by uuid references auth.users(id),
  unique (batch_id, customer_id)
);

create table if not exists app_settings (
  id int primary key, data jsonb not null, updated_at timestamptz not null default now()
);
insert into app_settings (id, data) values
  (1, '{"reward_pct":10,"points_per_dollar":10,"rounding":"nearest","optional_columns":[],"optional_defaults":{}}')
  on conflict (id) do nothing;

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor uuid references auth.users(id),
  action text not null, entity text not null, entity_id text not null,
  detail jsonb not null default '{}'
);

alter table customers enable row level security;
alter table customer_imports enable row level security;
alter table sales_imports enable row level security;
alter table sales_rows enable row level security;
alter table referral_matches enable row level security;
alter table reward_batches enable row level security;
alter table reward_entries enable row level security;
alter table point_adjustments enable row level security;
alter table app_settings enable row level security;
alter table audit_log enable row level security;

