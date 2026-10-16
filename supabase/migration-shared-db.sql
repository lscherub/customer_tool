-- Migration: shared-database + manual-reward support (additive, no data loss).
-- Run AFTER supabase/schema.sql and supabase/rls.sql in Supabase SQL Editor.
-- Safe to re-run (all statements idempotent).

-- 1) Stable client IDs so browser-generated history IDs (cimp-*, simp-*, man-*)
--    survive round-trips without colliding with uuid primary keys.
alter table customer_imports add column if not exists client_id text unique;
alter table sales_imports add column if not exists client_id text unique;
alter table manual_point_records add column if not exists client_id text unique;
alter table customer_imports add column if not exists data jsonb not null default '{}';
alter table sales_imports add column if not exists data jsonb not null default '{}';

-- 2) Referral aggregates: existing referral_matches table only stores match
--    status, not net sales / rewards / inclusion flags. Store the full aggregate
--    document here so every device renders the identical Referral Sales view.
create table if not exists referral_aggregates (
  id text primary key,
  sales_client_id text,
  reporting_period text not null default '',
  referral_phone_normalized text not null default '',
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create index if not exists idx_referral_aggs_period on referral_aggregates (reporting_period);
create index if not exists idx_referral_aggs_sales on referral_aggregates (sales_client_id);
alter table referral_aggregates enable row level security;
do $$ begin
  create policy staff_all_referral_aggs on referral_aggregates for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- 3) Link reward batches back to the sales import via stable client id
--    (uuid FK cannot hold browser ids like 'simp-...').
alter table reward_batches add column if not exists sales_client_id text;

-- 4) Manual rewards need net-sales inputs (spec: Total Net Sales + Reward Rate).
alter table manual_point_records add column if not exists net_sales numeric;
alter table manual_point_records add column if not exists reward_pct numeric;
alter table manual_point_records add column if not exists reward_value numeric;
alter table manual_point_records add column if not exists projected_balance int;

-- 5) Manual-points table policy (rls.sql references it before it may exist).
do $$ begin
  create policy staff_all_mpr on manual_point_records for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- 6) Full-fidelity customer upsert: previous helper dropped address/AR/credit
--    fields and always reported added=0. Replace with correct version.
create or replace function bulk_upsert_customers(payload jsonb)
returns jsonb language plpgsql security definer as $$
declare r jsonb; v_added int := 0; v_updated int := 0; v_is_new boolean;
begin
  for r in select * from jsonb_array_elements(payload) loop
    select not exists (select 1 from customers where customer_id = r->>'customer_id') into v_is_new;
    insert into customers (customer_id, company, first_name, last_name, phone1, phone2,
      cell_phone, phone1_normalized, phone2_normalized, cell_normalized, email, member_id,
      customer_type, ar, store_credit, points, deposit, referral, customer_code,
      date_added, address1, address2, city, province, postal, country, raw, updated_at)
    values (r->>'customer_id', r->>'company', r->>'first_name', r->>'last_name',
      r->>'phone1', r->>'phone2', r->>'cell_phone', r->>'phone1_normalized',
      r->>'phone2_normalized', r->>'cell_normalized', r->>'email', r->>'member_id',
      r->>'customer_type',
      nullif(r->>'ar','')::numeric, nullif(r->>'store_credit','')::numeric,
      coalesce(nullif(r->>'points','')::int, 0),
      nullif(r->>'deposit','')::numeric,
      r->>'referral', r->>'customer_code',
      nullif(r->>'date_added','')::date,
      r->>'address1', r->>'address2', r->>'city', r->>'province', r->>'postal', r->>'country',
      coalesce(r->'raw','{}'::jsonb), now())
    on conflict (customer_id) do update set
      company=excluded.company, first_name=excluded.first_name, last_name=excluded.last_name,
      phone1=excluded.phone1, phone2=excluded.phone2, cell_phone=excluded.cell_phone,
      phone1_normalized=excluded.phone1_normalized, phone2_normalized=excluded.phone2_normalized,
      cell_normalized=excluded.cell_normalized, email=excluded.email, member_id=excluded.member_id,
      customer_type=excluded.customer_type, ar=excluded.ar, store_credit=excluded.store_credit,
      points=excluded.points, deposit=excluded.deposit, referral=excluded.referral,
      customer_code=excluded.customer_code, date_added=excluded.date_added,
      address1=excluded.address1, address2=excluded.address2, city=excluded.city,
      province=excluded.province, postal=excluded.postal, country=excluded.country,
      raw=excluded.raw, updated_at=now();
    if v_is_new then v_added := v_added + 1; else v_updated := v_updated + 1; end if;
  end loop;
  return jsonb_build_object('added', v_added, 'updated', v_updated);
end $$;
