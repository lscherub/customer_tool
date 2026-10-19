'use client';
import React, { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { StoreProvider, useStore } from './store-context';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/customers', label: 'All Customers' },
  { href: '/referrals', label: 'Referral Sales' },
  { href: '/history', label: 'Reward History' },
  { href: '/manual-points', label: 'Manual Points' },
  { href: '/settings', label: 'Settings' },
];

/**
 * Client-side authentication gate for the (protected) route group.
 *
 * The Next.js proxy already redirects unauthenticated requests server-side;
 * this layer additionally guarantees that after client-side sign-out (or an
 * expired/invalid session) protected content is removed IMMEDIATELY and a
 * neutral loading screen is shown while the session is being checked —
 * protected data never flashes on screen before the redirect.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { authStatus, cloud, cloudError, cloudUser, syncState, loaded, signOutAll, refreshFromCloud } = useStore();
  const router = useRouter();

  useEffect(() => {
    if (authStatus === 'signedOut') void router.replace('/signin');
  }, [authStatus, router]);

  // Neutral loading screen: no navigation, no data — only while checking.
  if (authStatus === 'loading' && !loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100">
        <div className="rounded-xl border border-stone-200 bg-white px-8 py-10 text-center shadow-sm">
          <div className="text-sm font-medium text-stone-700">Checking your session…</div>
          <div className="mt-1 text-xs text-stone-500">Genesis Nutrition — Referral Rewards</div>
        </div>
      </div>
    );
  }

  // Signed out: render nothing and redirect to the sign-in page.
  if (authStatus === 'signedOut') return null;

  // Signed in but the shared database could not be loaded: a real error state
  // instead of empty/misleading tables.
  if (authStatus === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
        <div className="max-w-lg rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-bold text-red-800">Could not load the shared database</h1>
          <p className="mt-2 text-sm text-stone-700">{cloudError ?? 'Unknown error.'}</p>
          <p className="mt-2 text-xs text-stone-500">No cached or sample data is shown. Fix the connection and try again.</p>
          <div className="mt-4 flex gap-2">
            <button className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800" onClick={() => void refreshFromCloud()}>
              Retry
            </button>
            <button className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50" onClick={() => void signOutAll()}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-emerald-950 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-3">
          <div className="mr-4 font-bold tracking-wide">Genesis Nutrition</div>
          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded px-3 py-1.5 hover:bg-emerald-800">
                {n.label}
              </Link>
            ))}
          </nav>
          <span className="ml-auto flex items-center gap-3 text-xs text-emerald-200">
            <span>{cloud === 'shared' ? '● Shared DB' : cloud === 'loading' ? '◌ Connecting…' : '⚠ Database unavailable'}</span>
            {syncState && <span>{syncState}</span>}
            {cloudUser && <span className="hidden md:inline">{cloudUser}</span>}
            <button className="underline" onClick={() => void refreshFromCloud()}>Refresh</button>
            <button className="rounded bg-white/10 px-2 py-0.5 font-semibold text-white hover:bg-white/20" onClick={() => void signOutAll()}>
              Sign out
            </button>
          </span>
        </div>
        {cloud === 'error' && cloudError && (
          <div className="bg-red-900/80 px-4 py-1.5 text-center text-xs text-red-100">
            {cloudError} — data on screen may be stale. Use Refresh or sign out.
          </div>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-7xl px-4 pb-10 text-xs text-stone-500">
        Points are added to existing POS balances on import. Confirm POS import manually — the app cannot verify Amber POS accepted a file.
      </footer>
    </>
  );
}

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <StoreProvider>
      <AuthGate>{children}</AuthGate>
    </StoreProvider>
  );
}