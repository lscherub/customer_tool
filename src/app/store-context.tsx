'use client';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadStore, saveStore, type StoreShape } from '@/lib/store';
import { fetchSharedStore, persistStoreDiff } from '@/lib/supabase-store';
import { isSupabaseConfigured, lsGet, signInEmail, signOut as sbSignOut, supabaseBrowser, supabaseUrl } from '@/lib/data';

interface StoreCtx {
  store: StoreShape;
  setStore: (updater: (s: StoreShape) => StoreShape) => void;
  loaded: boolean;
  cloud: 'local' | 'loading' | 'shared' | 'error';
  cloudError: string | null;
  cloudUser: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOutAll: () => Promise<void>;
  refreshFromCloud: () => Promise<void>;
  migrateLocalToCloud: () => Promise<string>;
  syncState: string | null;
}

const Ctx = createContext<StoreCtx>({
  store: loadStore(), setStore: () => {}, loaded: false,
  cloud: 'local', cloudError: null, cloudUser: null,
  signIn: async () => {}, signOutAll: async () => {},
  refreshFromCloud: async () => {}, migrateLocalToCloud: async () => '',
  syncState: null,
});

function mergePreferCloud(cloud: StoreShape, local: StoreShape): StoreShape {
  const hasCloud = cloud.customers.length > 0 || cloud.batches.length > 0
    || cloud.customerImports.length > 0 || cloud.salesImports.length > 0;
  if (!hasCloud) return local.customers.length || local.batches.length ? local : cloud;
  const byId = <T extends { id: string }>(arr: T[]) => new Map(arr.map((x) => [x.id, x]));
  const union = <T extends { id: string }>(c: T[], l: T[]) => {
    const m = byId(c);
    for (const x of l) if (!m.has(x.id)) m.set(x.id, x);
    return Array.from(m.values());
  };
  const custById = new Map(cloud.customers.map((c) => [c.customer_id, c]));
  for (const c of local.customers) if (!custById.has(c.customer_id)) custById.set(c.customer_id, c);
  return {
    customers: Array.from(custById.values()),
    customerImports: union(cloud.customerImports, local.customerImports),
    salesImports: union(cloud.salesImports, local.salesImports),
    referrals: cloud.referrals.length ? cloud.referrals : local.referrals,
    batches: union(cloud.batches, local.batches),
    adjustments: union(cloud.adjustments, local.adjustments),
    manualPoints: union(cloud.manualPoints, local.manualPoints),
    settings: cloud.settings?.updated_at && local.settings?.updated_at
      ? (new Date(cloud.settings.updated_at) >= new Date(local.settings.updated_at) ? cloud.settings : local.settings)
      : cloud.settings,
  };
}
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [store, setStoreState] = useState<StoreShape>(() => loadStore());
  const [loaded, setLoaded] = useState(false);
  const [cloud, setCloud] = useState<StoreCtx['cloud']>(() => (isSupabaseConfigured() ? 'loading' : 'local'));
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudUser, setCloudUser] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<string | null>(null);
  const prevRef = useRef<StoreShape | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storeRef = useRef(store);
  storeRef.current = store;
  const persistLocal = useCallback((next: StoreShape) => {
    saveStore(next);
    if (cloud !== 'shared') return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    setSyncState('Saving…');
    syncTimer.current = setTimeout(() => {
      const prev = prevRef.current;
      persistStoreDiff(prev, storeRef.current).then(() => {
        prevRef.current = storeRef.current;
        setSyncState(null);
      }).catch((e: unknown) => {
        setSyncState(null);
        setCloudError(e instanceof Error ? e.message : String(e));
      });
    }, 600);
  }, [cloud]);
  const setStore = useCallback((updater: (s: StoreShape) => StoreShape) => {
    setStoreState((prev) => {
      const next = updater(prev);
      persistLocal(next);
      return next;
    });
  }, [persistLocal]);
  const loadCloud = useCallback(async () => {
    if (!isSupabaseConfigured()) { setCloud('local'); setLoaded(true); return; }
    const sb = supabaseBrowser();
    if (!sb) { setCloud('local'); setLoaded(true); return; }
    const { data: sess } = await sb.auth.getSession();
    setCloudUser(sess?.session?.user?.email ?? null);
    if (!sess?.session) {
      setCloud('error');
      setCloudError('Sign in to load the shared database. Showing offline cache.');
      setLoaded(true);
      return;
    }
    setCloud('loading');
    setCloudError(null);
    try {
      const remote = await fetchSharedStore();
      const local = loadStore();
      const merged = mergePreferCloud(remote, local);
      prevRef.current = merged;
      setStoreState(merged);
      saveStore(merged);
      const hasLocalOnly = merged.customers.some((c) => !remote.customers.some((x) => x.customer_id === c.customer_id))
        || merged.batches.some((b) => !remote.batches.some((x) => x.id === b.id))
        || merged.customerImports.some((h) => !remote.customerImports.some((x) => x.id === h.id))
        || merged.salesImports.some((h) => !remote.salesImports.some((x) => x.id === h.id));
      if (hasLocalOnly) {
        await persistStoreDiff(remote, merged);
        prevRef.current = merged;
      }
      setCloud('shared');
      setLoaded(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setCloud('error');
      setCloudError(msg === 'AUTH_REQUIRED'
        ? 'Sign in to load the shared database. Showing offline cache.'
        : 'Shared database unavailable: ' + msg + '. Showing offline cache.');
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void loadCloud();
    const sb = supabaseBrowser();
    if (!sb) return;
    const { data: sub } = sb.auth.onAuthStateChange(() => { void loadCloud(); });
    return () => { sub.subscription.unsubscribe(); };
  }, [loadCloud]);
  const signIn = useCallback(async (email: string, password: string) => {
    await signInEmail(email, password);
    await loadCloud();
  }, [loadCloud]);
  const signOutAll = useCallback(async () => {
    await sbSignOut();
    setCloudUser(null);
    setCloud('error');
    setCloudError('Signed out. Offline cache shown — shared data is preserved in Supabase.');
  }, []);
  const refreshFromCloud = useCallback(async () => { await loadCloud(); }, [loadCloud]);
  const migrateLocalToCloud = useCallback(async () => {
    const sb = supabaseBrowser();
    if (!sb) throw new Error('Supabase is not configured.');
    const { data: sess } = await sb.auth.getSession();
    if (!sess?.session) throw new Error('Sign in first.');
    const remote = await fetchSharedStore().catch(() => null);
    const local = loadStore();
    const target = remote ? mergePreferCloud(remote, local) : local;
    await persistStoreDiff(remote, target);
    prevRef.current = target;
    setStoreState(target);
    saveStore(target);
    setCloud('shared');
    return `Migrated ${local.customers.length} customers, ${local.batches.length} batches, ${local.manualPoints.length} manual records to shared DB. Local cache kept.`;
  }, []);
  const value = useMemo(() => ({
    store, setStore, loaded, cloud, cloudError, cloudUser,
    signIn, signOutAll, refreshFromCloud, migrateLocalToCloud, syncState,
  }), [store, setStore, loaded, cloud, cloudError, cloudUser, signIn, signOutAll, refreshFromCloud, migrateLocalToCloud, syncState]);
  const banner = cloud === 'loading'
    ? 'Connecting to shared database…'
    : cloud === 'shared'
      ? `Shared database · ${supabaseUrl().replace('https://', '').split('.')[0]} · ${cloudUser ?? ''}${syncState ? ' · ' + syncState : ''}`
      : cloud === 'error'
        ? (cloudError ?? 'Shared database unavailable.')
        : 'Local mode — set Supabase env vars to share across devices.';
  return (
    <Ctx.Provider value={value}>
      <div className={`px-4 py-1.5 text-xs ${cloud === 'shared' ? 'bg-emerald-950 text-emerald-100' : cloud === 'loading' ? 'bg-amber-100 text-amber-900' : 'bg-red-50 text-red-800'}`}>
        <span className="mx-auto flex max-w-7xl flex-wrap items-center gap-2">
          <span className="font-semibold">{cloud === 'shared' ? '● Shared DB' : cloud === 'loading' ? '◌ Connecting…' : cloud === 'local' ? '○ Local mode' : '⚠ Offline cache'}</span>
          <span className="opacity-90">{banner}</span>
          <span className="ml-auto flex items-center gap-2">
            {cloud !== 'shared' && cloud !== 'loading' && isSupabaseConfigured() && <AuthInline onSignIn={signIn} />}
            {cloud === 'shared' && (
              <>
                <button className="underline" onClick={() => void refreshFromCloud()}>Refresh</button>
                <span className="opacity-70">{lsGet<unknown[]>('customers', []).length.toLocaleString()} cached</span>
                <button className="underline" onClick={() => void signOutAll()}>Sign out{cloudUser ? ` (${cloudUser})` : ''}</button>
              </>
            )}
          </span>
        </span>
      </div>
      {children}
    </Ctx.Provider>
  );
}

function AuthInline({ onSignIn }: { onSignIn: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-1">
      <input className="w-36 rounded border border-stone-300 px-1 py-0.5 text-xs" placeholder="staff email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="w-28 rounded border border-stone-300 px-1 py-0.5 text-xs" type="password" placeholder="password" value={pw} onChange={(e) => setPw(e.target.value)} />
      <button
        className="rounded bg-white/20 px-2 py-0.5 font-semibold"
        disabled={busy}
        onClick={() => {
          setBusy(true); setErr(null);
          onSignIn(email.trim(), pw).catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
        }}
      >{busy ? '…' : 'Sign in'}</button>
      {err && <span className="font-semibold">{err}</span>}
    </span>
  );
}

export function useStore(): StoreCtx {
  return useContext(Ctx);
}

export function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-1 text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

export const btn = 'rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50';
export const btnGhost = 'rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50 disabled:opacity-50';
export const input = 'rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm w-full';
export const th = 'border-b border-stone-200 px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-stone-500';
export const td = 'border-b border-stone-100 px-2 py-1.5 text-sm';
