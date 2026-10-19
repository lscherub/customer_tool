import { supabaseBrowser } from './data';

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