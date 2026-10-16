import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import { StoreProvider } from './store-context';

export const metadata: Metadata = {
  title: 'Genesis Nutrition — Referral Rewards',
  description: 'Customer, referral and loyalty rewards operations for Amber POS.',
};

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/customers', label: 'All Customers' },
  { href: '/referrals', label: 'Referral Sales' },
  { href: '/history', label: 'Reward History' },
  { href: '/manual-points', label: 'Manual Points' },
  { href: '/settings', label: 'Settings' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-100 text-stone-900">
        <StoreProvider>
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
              <div className="ml-auto hidden text-xs text-emerald-200 md:block">
                Amber POS is source of truth · internal tool
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-7xl px-4 pb-10 text-xs text-stone-500">
            Points are added to existing POS balances on import. Confirm POS import manually — the app cannot verify Amber POS accepted a file.
          </footer>
        </StoreProvider>
      </body>
    </html>
  );
}
