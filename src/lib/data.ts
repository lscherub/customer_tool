import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

export function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Cookie-backed Supabase client (via @supabase/ssr). The session lives in
 * httpOnly-friendly cookies so the Next.js proxy can validate it server-side
 * on every request; localStorage is never used for auth or business data.
 */
export function supabaseBrowser(): SupabaseClient | null {
  if (typeof window === 'undefined') return null;
  if (!isSupabaseConfigured()) return null;
  if (browserClient) return browserClient;
  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
  );
  return browserClient;
}

/**
 * Remove every legacy `gn_*` offline-cache key from localStorage.
 * Called on sign-out (and after each successful cloud load) so customer,
 * sales, reward and settings data never survives a session in the browser.
 */
const CACHE_PREFIX = 'gn_';
export function clearLocalCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch { /* storage unavailable */ }
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

/** True when an error means the session is missing/expired/invalid. */
export function isAuthError(msg: string): boolean {
  return /AUTH_REQUIRED|jwt expired|invalid claim|401|not authenticated|invalid token|refresh_token_not_found/i.test(msg);
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
    if (error) {
      if (isAuthError(error.message)) throw new Error('AUTH_REQUIRED');
      throw error;
    }
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 60000) break; // safety cap
  }
  return out;
}

