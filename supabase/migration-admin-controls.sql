-- Migration: administrative customer controls (additive, no data loss).
-- Run AFTER supabase/schema.sql, supabase/rls.sql and supabase/migration-shared-db.sql
-- in the Supabase SQL Editor. Safe to re-run (all statements idempotent).
--
-- Provides:
--   * customer archive flag (active/deactivated_at) — the safe alternative to
--     hard-deleting customers that reward history references.
--   * app_admin_users registry + am_i_admin() helper.
--   * admin_clear_customers / admin_archive_customers / admin_restore_customer
--     transactional RPCs that re-check authorization and confirmation IN THE
--     DATABASE (UI checks are display-only).
--   * Hard-delete of customers is restricted to administrators at the RLS
--     layer, and the clear RPC refuses to run while any reward entry, point
--     adjustment, manual reward record or referral match references customers —
--     nothing is ever cascade-deleted.

-- 1) Customer archive support ------------------------------------------------
alter table customers add column if not exists active boolean not null default true;
alter table customers add column if not exists deactivated_at timestamptz;

-- 2) Administrator registry --------------------------------------------------
create table if not exists app_admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id)
);
alter table app_admin_users enable row level security;

-- Grant admin rights in SQL Editor, e.g.:
--   insert into app_admin_users (user_id) select id from auth.users where email = 'owner@example.com';
-- Alternatively set the user's app_metadata role to 'admin' (custom claims).
-- Either mechanism is honoured by am_i_admin().

-- 3) Authorization helper (server-side; never trust the client) --------------
create or replace function am_i_admin()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  return coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'service_role'), false)
      or exists (select 1 from app_admin_users where user_id = auth.uid());
end $$;

do $$ begin
  create policy admin_users_read_own on app_admin_users for select to authenticated
    using (user_id = auth.uid() or public.am_i_admin());
exception when duplicate_object then null; end $$;

-- 4) Hard clear (blocked automatically while history references customers) ---
create or replace function admin_clear_customers(confirm_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reward_entries int;
  v_adjustments int;
  v_manual int;
  v_matches int;
  v_total int;
  v_deleted int;
begin
  if not am_i_admin() then
    raise exception 'Not authorized: administrator access required.';
  end if;
  if coalesce(confirm_text, '') <> 'CLEAR CUSTOMERS' then
    raise exception 'Confirmation text must be exactly: CLEAR CUSTOMERS';
  end if;
  select count(*) into v_reward_entries from reward_entries re join customers c on c.customer_id = re.customer_id;
  select count(*) into v_adjustments from point_adjustments p join customers c on c.customer_id = p.customer_id;
  select count(*) into v_manual from manual_point_records m join customers c on c.customer_id = m.customer_id;
  select count(*) into v_matches from referral_matches rm join customers c on c.customer_id = rm.selected_customer_id;
  v_total := v_reward_entries + v_adjustments + v_manual + v_matches;
  if v_total > 0 then
    -- Deletion would damage historical records (no cascades allowed). Block it.
    return jsonb_build_object(
      'status', 'blocked',
      'reason', 'Customer deletion is blocked: reward entries, point adjustments, manual reward records or referral matches reference customer records. Nothing was deleted. Use admin_archive_customers (Archive) instead — it keeps all history intact.',
      'details', jsonb_build_object(
        'reward_entries', v_reward_entries,
        'point_adjustments', v_adjustments,
        'manual_point_records', v_manual,
        'referral_matches', v_matches));
  end if;
  delete from customers;
  get diagnostics v_deleted = row_count;
  insert into audit_log (actor, action, entity, entity_id, detail)
    values (auth.uid(), 'clear_customers', 'customers', 'ALL', jsonb_build_object('deleted', v_deleted));
  return jsonb_build_object('status', 'ok', 'deleted', v_deleted);
end $$;

-- 5) Archive (deactivate) every active customer — reversible per customer ----
create or replace function admin_archive_customers(confirm_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_archived int;
begin
  if not am_i_admin() then
    raise exception 'Not authorized: administrator access required.';
  end if;
  if coalesce(confirm_text, '') <> 'CLEAR CUSTOMERS' then
    raise exception 'Confirmation text must be exactly: CLEAR CUSTOMERS';
  end if;
  update customers set active = false, deactivated_at = now() where active;
  get diagnostics v_archived = row_count;
  insert into audit_log (actor, action, entity, entity_id, detail)
    values (auth.uid(), 'archive_customers', 'customers', 'ALL', jsonb_build_object('archived', v_archived));
  return jsonb_build_object('status', 'ok', 'archived', v_archived);
end $$;

-- 6) Restore one archived customer ------------------------------------------
create or replace function admin_restore_customer(p_customer_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_restored int;
begin
  if not am_i_admin() then
    raise exception 'Not authorized: administrator access required.';
  end if;
  update customers set active = true, deactivated_at = null where customer_id = p_customer_id and active = false;
  get diagnostics v_restored = row_count;
  if v_restored > 0 then
    insert into audit_log (actor, action, entity, entity_id, detail)
      values (auth.uid(), 'restore_customer', 'customers', p_customer_id, '{}'::jsonb);
    return jsonb_build_object('status', 'ok');
  end if;
  return jsonb_build_object('status', 'not_found');
end $$;

-- 7) Tighten customers RLS: ordinary staff keep select/insert/update, but
--    DELETE is administrator-only (previously any authenticated user could
--    delete customer rows directly through PostgREST).
drop policy if exists staff_all_customers on customers;
do $$ begin
  create policy staff_select_customers on customers for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy staff_insert_customers on customers for insert to authenticated with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy staff_update_customers on customers for update to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy admin_delete_customers on customers for delete to authenticated using (am_i_admin());
exception when duplicate_object then null; end $$;

-- 8) Lock function execution down: never callable by anon --------------------
revoke execute on function bulk_upsert_customers(jsonb) from public, anon;
grant execute on function bulk_upsert_customers(jsonb) to authenticated;
revoke execute on function am_i_admin() from public, anon;
grant execute on function am_i_admin() to authenticated;
revoke execute on function admin_clear_customers(text) from public, anon;
grant execute on function admin_clear_customers(text) to authenticated;
revoke execute on function admin_archive_customers(text) from public, anon;
grant execute on function admin_archive_customers(text) to authenticated;
revoke execute on function admin_restore_customer(text) from public, anon;
grant execute on function admin_restore_customer(text) to authenticated;
