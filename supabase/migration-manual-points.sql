-- Additive migration: manual points + override audit (no breaking changes).
alter table reward_batches add column if not exists kind text not null default 'referral';
alter table reward_batches add column if not exists origin text;
alter table reward_entries add column if not exists referral_phones text[];
alter table reward_entries add column if not exists override_status text;
alter table reward_entries add column if not exists override_reason text;
alter table reward_entries add column if not exists override_operator text;
alter table reward_entries add column if not exists override_at timestamptz;
alter table reward_entries add column if not exists override_verified boolean;
create table if not exists manual_point_records (
  id uuid primary key default gen_random_uuid(),
  batch_id text references reward_batches(id),
  customer_id text not null references customers(customer_id),
  customer_name text not null,
  originating_location text not null default 'Unknown',
  balance_before int not null default 0,
  points_adjustment int not null,
  balance_after int not null,
  reward_amount_dollars numeric,
  points_per_dollar numeric,
  reason text not null default '',
  operator text not null default '',
  created_at timestamptz not null default now(),
  exported_at timestamptz,
  filename text,
  status text not null default 'Exported',
  confirmed_at timestamptz
);
alter table manual_point_records enable row level security;
