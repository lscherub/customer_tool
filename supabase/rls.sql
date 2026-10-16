-- RLS: authenticated staff full access, anon blocked. Run after schema.sql.
do $$ begin
  create policy staff_all_customers on customers for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy staff_all_cimports on customer_imports for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy staff_all_simports on sales_imports for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy staff_all_srows on sales_rows for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy staff_all_rmatch on referral_matches for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy staff_all_rbatch on reward_batches for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy staff_all_rentry on reward_entries for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy staff_all_padj on point_adjustments for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy staff_all_aset on app_settings for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy staff_all_audit on audit_log for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Bulk upsert helper for 20k+ customers: call with JSONB array chunks of ~1000.
create or replace function bulk_upsert_customers(payload jsonb)
returns jsonb language plpgsql security definer as $$
declare r jsonb; v_added int := 0; v_updated int := 0;
begin
  for r in select * from jsonb_array_elements(payload) loop
    insert into customers (customer_id, company, first_name, last_name, phone1, phone2,
      cell_phone, phone1_normalized, phone2_normalized, cell_normalized, email, member_id,
      customer_type, points, referral, customer_code, raw, updated_at)
    values (r->>'customer_id', r->>'company', r->>'first_name', r->>'last_name',
      r->>'phone1', r->>'phone2', r->>'cell_phone', r->>'phone1_normalized',
      r->>'phone2_normalized', r->>'cell_normalized', r->>'email', r->>'member_id',
      r->>'customer_type', coalesce((r->>'points')::int, 0),
      r->>'referral', r->>'customer_code', coalesce(r->'raw','{}'::jsonb), now())
    on conflict (customer_id) do update set
      company=excluded.company, first_name=excluded.first_name, last_name=excluded.last_name,
      phone1=excluded.phone1, phone2=excluded.phone2, cell_phone=excluded.cell_phone,
      phone1_normalized=excluded.phone1_normalized, phone2_normalized=excluded.phone2_normalized,
      cell_normalized=excluded.cell_normalized, email=excluded.email, member_id=excluded.member_id,
      customer_type=excluded.customer_type, points=excluded.points, referral=excluded.referral,
      customer_code=excluded.customer_code, raw=excluded.raw, updated_at=now();
    v_updated := v_updated + 1;
  end loop;
  return jsonb_build_object('added', v_added, 'updated', v_updated);
end $$;
