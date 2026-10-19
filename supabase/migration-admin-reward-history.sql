-- Migration: administrative reward-history deletion (additive, no data loss).
-- Run AFTER supabase/schema.sql, supabase/rls.sql, supabase/migration-shared-db.sql,
-- supabase/migration-manual-points.sql and supabase/migration-admin-controls.sql
-- (am_i_admin() must exist) in the Supabase SQL Editor. Safe to re-run.
--
-- Provides admin_delete_reward_batches(p_batch_ids text[]): a transactional RPC that
--   * re-checks administrator authorization IN THE DATABASE (UI checks are display-only),
--   * deletes ONLY the selected reward_batches rows, and only where safe: batches
--     referenced by point_adjustments or manual_point_records, or flagged
--     applied_to_balances, are skipped and reported by id (nothing is ever cascade-
--     damaged; their reward_entries are removed together with them via the existing
--     ON DELETE CASCADE),
--   * never touches point_adjustments, manual_point_records, sales_imports, customers,
--     import history or audit_log (one new audit entry records the deletion),
--   * answers { status: ok | partial | blocked, deleted, entries_deleted, skipped,
--     missing, requested, reason, details } so the client can report exactly what
--     happened. Success is only ever claimed for rows the database actually removed.

create or replace function admin_delete_reward_batches(p_batch_ids text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_requested int := 0;
  v_ids text[] := '{}';
  v_blocked text[] := '{}';
  v_part text[] := '{}';
  v_safe text[] := '{}';
  v_adj int := 0;
  v_man int := 0;
  v_applied int := 0;
  v_entries int := 0;
  v_deleted int := 0;
  v_missing int := 0;
  v_status text;
begin
  if not am_i_admin() then
    raise exception 'Not authorized: administrator access required.';
  end if;

  select count(distinct x) into v_requested from unnest(p_batch_ids) as t(x);
  if v_requested = 0 then
    return jsonb_build_object('status', 'blocked', 'reason', 'No batches selected.',
      'deleted', 0, 'entries_deleted', 0, 'skipped', '[]'::jsonb, 'missing', 0,
      'requested', 0, 'details', '{}'::jsonb);
  end if;

  -- Only ids that still exist (deduplicated).
  select coalesce(array_agg(distinct b.id), '{}') into v_ids
    from reward_batches b where b.id = any(p_batch_ids);
  v_missing := v_requested - coalesce(array_length(v_ids, 1), 0);

  if coalesce(array_length(v_ids, 1), 0) > 0 then
    -- (a) applied point records referencing the batches
    select coalesce(array_agg(distinct a.batch_id), '{}') into v_part
      from point_adjustments a where a.batch_id = any(v_ids);
    v_blocked := v_blocked || v_part;
    select count(*) into v_adj from point_adjustments a where a.batch_id = any(v_ids);

    -- (b) manual point records (table exists only after migration-manual-points.sql;
    --     if it is absent its foreign key is absent too, so nothing can reference batches)
    begin
      select coalesce(array_agg(distinct m.batch_id), '{}') into v_part
        from manual_point_records m where m.batch_id = any(v_ids);
      v_blocked := v_blocked || v_part;
      select count(*) into v_man from manual_point_records m where m.batch_id = any(v_ids);
    exception when undefined_table then
      v_man := 0;
    end;

    -- (c) batches whose customer balances were already applied
    select coalesce(array_agg(distinct b.id), '{}') into v_part
      from reward_batches b where b.id = any(v_ids) and b.applied_to_balances;
    v_blocked := v_blocked || v_part;
    select count(*) into v_applied from reward_batches b where b.id = any(v_ids) and b.applied_to_balances;

    select coalesce(array_agg(distinct x), '{}') into v_blocked from unnest(v_blocked) as t(x);

    -- Safe set: every requested batch that is not blocked.
    select coalesce(array_agg(b.id), '{}') into v_safe
      from reward_batches b where b.id = any(v_ids) and b.id <> all(v_blocked);

    -- Count the reward entries that will go with their batches, then delete the
    -- batches (entries cascade through the existing ON DELETE CASCADE constraint).
    select count(*) into v_entries from reward_entries e where e.batch_id = any(v_safe);
    delete from reward_batches where id = any(v_safe);
    get diagnostics v_deleted = row_count;

    if v_deleted > 0 then
      insert into audit_log (actor, action, entity, entity_id, detail)
        values (auth.uid(), 'delete_reward_batches', 'reward_batches',
                array_to_string(v_safe, ','),
                jsonb_build_object('batches', v_deleted, 'reward_entries', v_entries, 'skipped', v_blocked));
    end if;
  end if;

  v_status := case when coalesce(array_length(v_blocked, 1), 0) = 0 then 'ok'
                   when v_deleted > 0 then 'partial'
                   else 'blocked' end;

  return jsonb_build_object(
    'status', v_status,
    'deleted', v_deleted,
    'entries_deleted', v_entries,
    'skipped', v_blocked,
    'missing', v_missing,
    'requested', v_requested,
    'reason', case when v_status = 'blocked'
                   then 'Selected batches are referenced by applied point records or were applied to balances, so they cannot be deleted.'
                   else null end,
    'details', jsonb_build_object('point_adjustments', v_adj, 'manual_point_records', v_man, 'applied_to_balances', v_applied)
  );
end $$;

revoke execute on function admin_delete_reward_batches(text[]) from public, anon;
grant execute on function admin_delete_reward_batches(text[]) to authenticated;
