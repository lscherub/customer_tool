'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { isSupabaseConfigured, signInEmail } from '@/lib/data';

/**
 * Dedicated sign-in page. All customer, referral and reward pages live behind
 * the (protected) route group and the server-side proxy, so this is the only
 * page an unauthenticated visitor can see. Email and password fields always
 * start EMPTY — no credentials are ever prefilled or stored in the codebase.
 */
export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const configured = isSupabaseConfigured();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const em = email.trim();
    if (!em || !password) { setErr('Enter your staff email and password.'); return; }
    setBusy(true); setErr(null);
    try {
      await signInEmail(em, password);
      router.replace('/');
    } catch (e2) {
      const m = e2 instanceof Error ? e2.message : String(e2);
      setErr(/invalid login credentials/i.test(m) ? 'Email or password is incorrect.' : 'Sign-in failed: ' + m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold">Genesis Nutrition</h1>
        <p className="mt-0.5 text-sm text-stone-600">Referral Rewards — staff sign in required.</p>
        {!configured ? (
          <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Authentication is not configured on this deployment. Set
            <code className="mx-1 rounded bg-red-100 px-1">NEXT_PUBLIC_SUPABASE_URL</code> and
            <code className="mx-1 rounded bg-red-100 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and redeploy.
            There is no offline or local-data mode.
          </div>
        ) : (
          <form className="mt-4 space-y-3" onSubmit={submit} autoComplete="off">
            <label className="block text-sm">
              Staff email
              <input
                className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={busy}
                required
              />
            </label>
            <label className="block text-sm">
              Password
              <input
                className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                type="password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                disabled={busy}
                required
              />
            </label>
            {err && <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">{err}</div>}
            <button
              className="w-full rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              type="submit"
              disabled={busy}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="text-xs text-stone-500">
              Access is limited to authorised staff accounts. All data lives in the shared Supabase database —
              nothing is cached on this device.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}