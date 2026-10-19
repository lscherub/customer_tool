'use client';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { emptyStore, normalizeStoredSettings, type StoreShape } from '@/lib/store';
import { fetchSharedStore, persistStoreDiff } from '@/lib/supabase-store';
import { clearLocalCache, isAuthError, isSupabaseConfigured, signOut as sbSignOut, supabaseBrowser } from '@/lib/data';
import type { AuthStatus } from '@/lib/types';

interface StoreCtx {
  store: StoreShape;
  setStore: (updater: (s: StoreShape) => StoreShape) => void;
  /** Persist to Supabase immediately (no debounce) and only then update state. */
  commitAndSave: (updater: (s: StoreShape) => StoreShape) => Promise<StoreShape>;
  loaded: boolean;
  cloud: 'loading' | 'shared' | 'error';
  cloudError: string | null;
  cloudUser: string | null;
  authStatus: AuthStatus;
  signOutAll: () => Promise<void>;
  refreshFromCloud: () => Promise<void>;
  syncState: string | null;
}

const Ctx = createContext<StoreCtx>({
  store: emptyStore(), setStore: () => {}, commitAndSave: async (u) => u(emptyStore()), loaded: false,
  cloud: 'loading', cloudError: null, cloudUser: null, authStatus: 'loading',
  signOutAll: async () => {}, refreshFromCloud: async () => {},
  syncState: null,
});

export function StoreProvider({ children }: { children: React.ReactNode }) {
  // Supabase is the single source of truth. State starts EMPTY and is only
  // populated after the session is verified and shared data is fetched —
  // never from localStorage, so signed-out users can never see cached data.
  const [store, setStoreState] = useState<StoreShape>(emptyStore);
  const [loaded, setLoaded] = useState(false);
  const [cloud, setCloud] = useState<StoreCtx['cloud']>('loading');
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudUser, setCloudUser] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
  const [syncState, setSyncState] = useState<string | null>(null);
  const prevRef = useRef<StoreShape | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storeRef = useRef(store);
  useEffect(() => { storeRef.current = store; }, [store]);
  const lockedRef = useRef(true); // true until a verified session loads; blocks all writes

  /**
   * Lock the protected interface: wipe ALL in-memory business data, purge any
   * locally cached data, cancel pending writes, and report signed-out.
   */
  const lockOut = useCallback(() => {
    lockedRef.current = true;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = null;
    prevRef.current = null;
    setStoreState(emptyStore());
    clearLocalCache();
    setCloudUser(null);
    setCloudError(null);
    setSyncState(null);
    setCloud('loading');
    setLoaded(true);
    setAuthStatus('signedOut');
  }, []);

  const loadCloud = useCallback(async () => {
    if (!isSupabaseConfigured()) { lockOut(); return; }
    const sb = supabaseBrowser();
    if (!sb) { lockOut(); return; }
    const { data: sess, error: sessErr } = await sb.auth.getSession();
    if (sessErr || !sess?.session) { lockOut(); return; }
    lockedRef.current = false;
    setCloudUser(sess.session.user.email ?? null);
    setCloudError(null);
    setAuthStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const remote = await fetchSharedStore();
      prevRef.current = remote;
      setStoreState(remote);
      clearLocalCache(); // cloud is truth; never keep a local copy of business data
      setCloud('shared');
      setLoaded(true);
      setAuthStatus('ready');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isAuthError(msg)) { lockOut(); return; }
      setCloud('error');
      setCloudError('Shared database unavailable: ' + msg);
      setLoaded(true);
      setAuthStatus('error');
    }
  }, [lockOut]);

  /** Debounced write-through. Never writes when signed out. */
  const persistLocal = useCallback((next: StoreShape) => {
    if (lockedRef.current) return;
    if (cloud !== 'shared') return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    setSyncState('Saving…');
    syncTimer.current = setTimeout(() => {
      const prev = prevRef.current;
      persistStoreDiff(prev, next)
        .then(() => { prevRef.current = next; setSyncState(null); })
        .catch((e: unknown) => {
          setSyncState(null);
          const msg = e instanceof Error ? e.message : String(e);
          if (isAuthError(msg)) { lockOut(); return; }
          setCloudError(msg);
        });
    }, 600);
  }, [cloud, lockOut]);

  const setStore = useCallback((updater: (s: StoreShape) => StoreShape) => {
    setStoreState((s) => {
      const next = updater(s);
      persistLocal(next);
      return next;
    });
  }, [persistLocal]);

  /**
   * Save to the shared database FIRST and only then adopt the new state —
   * callers use this for operations (like exports) that must not be treated
   * as completed unless the database write actually succeeded.
   */
  const commitAndSave = useCallback(async (updater: (s: StoreShape) => StoreShape) => {
    if (lockedRef.current) throw new Error('Signed out — changes were not saved.');
    const next = updater(storeRef.current);
    if (syncTimer.current) clearTimeout(syncTimer.current);
    setSyncState('Saving…');
    try {
      await persistStoreDiff(prevRef.current, next);
    } catch (e) {
      setSyncState(null);
      const msg = e instanceof Error ? e.message : String(e);
      if (isAuthError(msg)) { lockOut(); throw new Error('Signed out — changes were not saved.'); }
      setCloudError('Save failed: ' + msg);
      throw e;
    }
    prevRef.current = next;
    setStoreState(next);
    setSyncState(null);
    return next;
  }, [lockOut]);

  const refreshFromCloud = useCallback(async () => {
    setAuthStatus((s) => (s === 'ready' ? s : 'loading'));
    await loadCloud();
  }, [loadCloud]);

  const signOutAll = useCallback(async () => {
    lockOut(); // immediately remove protected content, even before the network call
    await sbSignOut();
    lockOut();
  }, [lockOut]);

  useEffect(() => {
    // Deferred so the effect body never sets state synchronously.
    const boot = setTimeout(() => { void loadCloud(); }, 0);
    const sb = supabaseBrowser();
    if (!sb) return () => clearTimeout(boot);
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { lockOut(); return; }
      // Session restored/refreshed: re-verify and reload shared data.
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') void loadCloud();
    });
    return () => { clearTimeout(boot); sub.subscription.unsubscribe(); };
  }, [loadCloud, lockOut]);

  const value = useMemo<StoreCtx>(() => ({
    store, setStore, commitAndSave, loaded, cloud, cloudError, cloudUser, authStatus,
    signOutAll, refreshFromCloud, syncState,
  }), [store, setStore, commitAndSave, loaded, cloud, cloudError, cloudUser, authStatus, signOutAll, refreshFromCloud, syncState]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreCtx {
  return useContext(Ctx);
}

/** Settings patch helper shared by dashboard and settings pages. */
export function withSettings(s: StoreShape, patch: Partial<StoreShape['settings']>): StoreShape {
  return { ...s, settings: normalizeStoredSettings({ ...s.settings, ...patch, updated_at: new Date().toISOString() }) };
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
export const btnDanger = 'rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50';
export const input = 'rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm w-full';
export const th = 'border-b border-stone-200 px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-stone-500';
export const td = 'border-b border-stone-100 px-2 py-1.5 text-sm';

