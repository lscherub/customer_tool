import { supabaseBrowser } from './data';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Administrative customer-database operations.
 *
 * These call server-side `security definer` RPCs (see
 * supabase/migration-admin-controls.sql) which enforce administrator
 * authorization and confirmation text in the database itself — the UI
 * hiding these controls is display-only and never the security boundary.
 * Results are reported exactly as the database returned them: success is
 * only ever claimed when the operation actually succeeded.
 */

export type AdminOpResult = {
  ok: boolean;
  /** true when the database refused a hard delete because history references customers */
  blocked?: boolean;
  message: string;
  deleted?: number;
  archived?: number;
  restored?: number;
  details?: Record<string, number>;
};

export const CLEAR_CONFIRM_PHRASE = 'CLEAR CUSTOMERS';

/** True when the signed-in user is a registered administrator (server-checked). */
export async function fetchIsAdmin(): Promise<boolean> {
  const sb = supabaseBrowser();
  if (!sb) return false;
  const { data, error } = await sb.rpc('am_i_admin');
  if (error) return false; // migration not applied, or not signed in — hide admin UI
  return data === true;
}

/**
 * Hard-delete every customer row. The server function refuses (blocked) while
 * any reward entry, point adjustment, manual reward record or referral match
 * references a customer, so history is never cascade-damaged.
 */
export async function clearCustomerDatabase(): Promise<AdminOpResult> {
  const sb = supabaseBrowser();
  if (!sb) return { ok: false, message: 'Not signed in.' };
  const { data, error } = await sb.rpc('admin_clear_customers', { confirm_text: CLEAR_CONFIRM_PHRASE });
  if (error) return { ok: false, message: error.message };
  const r = (data ?? {}) as { status?: string; deleted?: number; reason?: string; details?: Record<string, number> };
  if (r.status === 'ok') {
    return { ok: true, message: `Deleted ${r.deleted ?? 0} customer record(s) from the shared database. Related history was not touched.`, deleted: r.deleted ?? 0 };
  }
  if (r.status === 'blocked') {
    return { ok: false, blocked: true, message: r.reason ?? 'Customer deletion is blocked while historical records reference customers.', details: r.details };
  }
  return { ok: false, message: 'Unexpected response from the database: ' + JSON.stringify(data ?? null) };
}

/** Safer alternative: archive (deactivate) all customers; reversible per-customer. */
export async function archiveAllCustomers(): Promise<AdminOpResult> {
  const sb = supabaseBrowser();
  if (!sb) return { ok: false, message: 'Not signed in.' };
  const { data, error } = await sb.rpc('admin_archive_customers', { confirm_text: CLEAR_CONFIRM_PHRASE });
  if (error) return { ok: false, message: error.message };
  const r = (data ?? {}) as { status?: string; archived?: number };
  if (r.status === 'ok') {
    return { ok: true, message: `Archived ${r.archived ?? 0} customer record(s). Records stay in the shared database (hidden from search and matching) and can be restored individually.`, archived: r.archived ?? 0 };
  }
  return { ok: false, message: 'Unexpected response from the database: ' + JSON.stringify(data ?? null) };
}

/** Restore one archived customer (admin-only, server-checked). */
export async function restoreCustomer(customerId: string): Promise<AdminOpResult> {
  const sb = supabaseBrowser();
  if (!sb) return { ok: false, message: 'Not signed in.' };
  const { data, error } = await sb.rpc('admin_restore_customer', { p_customer_id: customerId });
  if (error) return { ok: false, message: error.message };
  const r = (data ?? {}) as { status?: string };
  if (r.status === 'ok') return { ok: true, message: `Restored ${customerId}.`, restored: 1 };
  return { ok: false, message: `Customer ${customerId} was not restored (not found or not archived).` };
}

/* ------------------------------------------------------------------------ */
/* Bulk deletion of specific customers (All Customers page row selection).   */
/* ------------------------------------------------------------------------ */

/** Result of a bulk delete: which customer IDs were actually removed, so the
 *  caller can prune them from its selection while keeping the rest. */
export type BulkDeleteResult = AdminOpResult & { deletedIds: string[] };

/** Delete in chunks so long Customer ID lists stay within request-URL limits. */
const DELETE_CHUNK = 300;
function chunkIds(ids: string[], size = DELETE_CHUNK): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Every table with a foreign key to `customers` (supabase/schema.sql and
 *  supabase/migration-manual-points.sql). Read-only here — these records are
 *  never modified or cascade-deleted. */
const LINKED_RECORD_CHECKS = [
  { table: 'reward_entries', column: 'customer_id', label: 'reward history entries' },
  { table: 'point_adjustments', column: 'customer_id', label: 'point applications' },
  { table: 'manual_point_records', column: 'customer_id', label: 'manual point records' },
  { table: 'referral_matches', column: 'selected_customer_id', label: 'referral matches' },
] as const;

/** Which of `ids` are referenced by history, mapped to what references them.
 *  Throws when verification is impossible — callers must then refuse to delete
 *  (fail safe). A missing table means its migration (and foreign key) was never
 *  applied, so nothing there can reference customers and the check is skipped. */
async function findLinkedCustomers(sb: SupabaseClient, ids: string[]): Promise<Map<string, string[]>> {
  const linked = new Map<string, string[]>();
  for (const chk of LINKED_RECORD_CHECKS) {
    for (const chunk of chunkIds(ids)) {
      const { data, error } = await sb.from(chk.table).select(chk.column).in(chk.column, chunk);
      if (error) {
        if (error.code === '42P01' || /does not exist/i.test(error.message)) break; // table (and its FK) not present
        throw new Error(`Could not check ${chk.label} (${chk.table}): ${error.message}`);
      }
      for (const row of (data ?? []) as Record<string, unknown>[]) {
        const id = String(row[chk.column] ?? '');
        if (!id) continue;
        const labels = linked.get(id);
        if (!labels) linked.set(id, [chk.label]);
        else if (!labels.includes(chk.label)) labels.push(chk.label);
      }
    }
  }
  return linked;
}

/** Counts per referencing record type, e.g. { 'reward history entries': 2 }. */
function linkedCounts(linked: Map<string, string[]>): Record<string, number> {
  const byLabel: Record<string, number> = {};
  for (const labels of linked.values()) for (const l of labels) byLabel[l] = (byLabel[l] ?? 0) + 1;
  return byLabel;
}

/** Accurate, human-readable explanation of a blocked bulk delete. */
function describeLinked(linked: Map<string, string[]>, totalSelected: number): string {
  const counts = Object.entries(linkedCounts(linked)).map(([l, n]) => `${l}: ${n} customer(s)`).join('; ');
  const sampleIds = [...linked.keys()].slice(0, 10).join(', ') + (linked.size > 10 ? ` …and ${linked.size - 10} more` : '');
  const alternative = linked.size < totalSelected
    ? ` Deselect the affected customer(s) to delete the remaining ${totalSelected - linked.size}, or archive them instead`
    : ' Archive them instead';
  return `Deletion blocked — ${linked.size} of ${totalSelected} selected customer record(s) have linked records that must never be cascade-deleted (${counts}). Affected Customer IDs: ${sampleIds}. Nothing was deleted.${alternative} (keeps all history intact and is reversible per customer).`;
}

/**
 * Delete exactly the selected customers — never history, never anything else.
 *
 * Safety model (the database is the boundary, this function only orchestrates
 * and reports): RLS only allows administrators to delete customer rows, and the
 * foreign keys refuse to remove any customer that reward entries, point
 * adjustments, manual reward records or referral matches still reference, so
 * nothing can be cascade-deleted. The referencing tables are pre-checked
 * (read-only) so a refusal is explained BEFORE anything is attempted; should a
 * linked record appear in the meantime, the foreign key still protects the data
 * and a second check explains that case too. Success is only claimed with the
 * exact number of rows the database actually removed.
 */
export async function deleteCustomersByIds(
  ids: string[],
  onPhase?: (phase: 'checking' | 'deleting') => void,
): Promise<BulkDeleteResult> {
  if (!ids.length) return { ok: false, message: 'No customers selected.', deletedIds: [] };
  const sb = supabaseBrowser();
  if (!sb) return { ok: false, message: 'Not signed in.', deletedIds: [] };

  // 1) Read-only pre-check of every table that references customers.
  onPhase?.('checking');
  let linked: Map<string, string[]>;
  try {
    linked = await findLinkedCustomers(sb, ids);
  } catch (e) {
    return { ok: false, message: (e instanceof Error ? e.message : String(e)) + ' Nothing was deleted (deletion only proceeds once linked records are confirmed absent).', deletedIds: [] };
  }
  if (linked.size) {
    return { ok: false, blocked: true, message: describeLinked(linked, ids.length), details: linkedCounts(linked), deletedIds: [] };
  }

  // 2) Delete exactly the selected IDs (RLS re-checks administrator rights and
  //    the foreign keys re-check references on every statement).
  onPhase?.('deleting');
  const deletedIds: string[] = [];
  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    const chunk = ids.slice(i, i + DELETE_CHUNK);
    const { data, error } = await sb.from('customers').delete().in('customer_id', chunk).select('customer_id');
    if (error) {
      const prefix = deletedIds.length
        ? `Deleted ${deletedIds.length} of ${ids.length} selected customer record(s) before the database refused the rest. `
        : 'No customer records were deleted. ';
      if (error.code === '23503' || /foreign key/i.test(error.message)) {
        // A linked record appeared after the pre-check: identify it precisely.
        try {
          const nowLinked = await findLinkedCustomers(sb, ids.slice(i));
          if (nowLinked.size) return { ok: false, blocked: true, message: prefix + describeLinked(nowLinked, ids.length - i), details: linkedCounts(nowLinked), deletedIds };
        } catch { /* fall through to the raw database error below */ }
      }
      return { ok: false, message: prefix + 'Database error: ' + error.message, deletedIds };
    }
    for (const row of (data ?? []) as { customer_id: string }[]) deletedIds.push(row.customer_id);
  }

  // 3) Report exactly what happened — never claim more than the database did.
  if (!deletedIds.length) {
    return { ok: true, deleted: 0, message: `Deleted 0 of ${ids.length} selected customer record(s): none of them exist in the shared database anymore (they may already have been removed elsewhere). The list was refreshed.`, deletedIds };
  }
  if (deletedIds.length < ids.length) {
    return { ok: true, deleted: deletedIds.length, message: `Deleted ${deletedIds.length} of ${ids.length} selected customer record(s); ${ids.length - deletedIds.length} were no longer present in the shared database. Reward history, sales imports, audit logs and point applications were not touched.`, deletedIds };
  }
  return { ok: true, deleted: deletedIds.length, message: `Deleted ${deletedIds.length} customer record(s) from the shared database. Reward history, sales imports, audit logs and point applications were not touched.`, deletedIds };
}