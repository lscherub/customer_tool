import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

export function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function supabaseBrowser(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (browserClient) return browserClient;
  browserClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
  );
  return browserClient;
}

/**
 * Dual-mode persistence: Supabase when configured, localStorage fallback otherwise.
 * localStorage keeps the app fully working end-to-end (demo/offline) while Supabase
 * provides durable Postgres storage once env vars are set. Keys are namespaced.
 */
const PREFIX = 'gn_';
export function lsGet<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}
export function lsSet(key: string, value: unknown): void {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* quota */ }
}

/** Auth helpers — Supabase email login backing RLS `authenticated` role. */
export async function signInEmail(email: string, password: string) {
  const sb = supabaseBrowser();
  if (!sb) throw new Error('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const sb = supabaseBrowser();
  if (!sb) return;
  await sb.auth.signOut();
}

/** Chunked select helper to page past PostgREST default limits. */
export async function selectAll<T>(table: string, orderBy?: { column: string; ascending?: boolean }, pageSize = 1000): Promise<T[]> {
  const sb = supabaseBrowser();
  if (!sb) return [];
  const out: T[] = [];
  let from = 0;
  for (;;) {
    let q = sb.from(table).select('*').range(from, from + pageSize - 1);
    if (orderBy) q = q.order(orderBy.column, { ascending: orderBy.ascending ?? true });
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 60000) break; // safety cap
  }
  return out;
}

