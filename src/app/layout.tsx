import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Genesis Nutrition — Referral Rewards',
  description: 'Customer, referral and loyalty rewards operations for Amber POS.',
};

/**
 * Root layout is intentionally minimal. All customer/reward content lives
 * behind the (protected) route group whose layout enforces authentication;
 * signed-out visitors only ever see the /signin page.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-100 text-stone-900">{children}</body>
    </html>
  );
}
