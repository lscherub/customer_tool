'use client';
import Link from 'next/link';
import { Card, Stat, useStore } from './store-context';
import type { StoreShape } from '@/lib/store';

const SHORTCUTS = [
  { href: '/customers', title: 'All Customers', desc: 'Import and manage customer records from Amber POS exports.' },
  { href: '/referrals', title: 'Referral Sales', desc: 'Import sales, resolve matches, calculate and export rewards.' },
  { href: '/manual-points', title: 'Manual Points', desc: 'Calculate a one-off reward for a single customer.' },
  { href: '/history', title: 'Reward History', desc: 'Review exported batches and confirm POS imports.' },
];

/**
 * Operational home page: four workflow shortcuts plus a compact
 * "Needs Attention" list. Optional statistics are hidden behind an explicit
 * toggle so routine work is not buried under duplicated numbers.
 */
export default function Dashboard() {
  const { store, cloud, syncState, setStore } = useStore();
  const showSummaries = store.settings.dashboard_show_summaries === true;

  // Actionable items only — computed from the shared database (via useStore),
  // never from a local cache or an unsaved on-screen calculation.
  const unmatched = store.referrals.filter((r) => r.match_status === 'unmatched').length;
  const ambiguous = store.referrals.filter((r) => r.match_status === 'ambiguous').length;
  const pendingBatches = store.batches.filter((b) => b.status === 'Exported');
  const failedCustomerImports = store.customerImports.filter((h) => h.failed > 0);
  const failedSalesImports = store.salesImports.filter((h) => h.failed > 0);
  const attention: { key: string; text: string; href: string; label: string }[] = [];
  if (ambiguous > 0 || unmatched > 0) {
    attention.push({
      key: 'matches',
      text: `${ambiguous + unmatched} referral row(s) still need a customer (${ambiguous} ambiguous, ${unmatched} unmatched).`,
      href: '/referrals', label: 'Open Referral Sales',
    });
  }
  if (pendingBatches.length > 0) {
    attention.push({
      key: 'pending',
      text: `${pendingBatches.length} exported reward batch(es) are waiting for POS import confirmation.`,
      href: '/history', label: 'Open Reward History',
    });
  }
  if (failedCustomerImports.length > 0) {
    attention.push({
      key: 'cust-imports',
      text: `${failedCustomerImports.length} customer import(s) had failed rows — review the import history.`,
      href: '/customers', label: 'Open All Customers',
    });
  }
  if (failedSalesImports.length > 0) {
    attention.push({
      key: 'sales-imports',
      text: `${failedSalesImports.length} sales import(s) had failed rows — review the import history.`,
      href: '/referrals', label: 'Open Referral Sales',
    });
  }

  const lastCust = store.customerImports[0];
  const lastSales = store.salesImports[0];
  const conf = store.batches.filter((b) => b.status === 'Confirmed').length;
  const canc = store.batches.filter((b) => b.status === 'Cancelled').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-stone-600">Pick a workflow to get started. Amber POS stays the source of truth.</p>
        </div>
        <button
          className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50"
          onClick={() => setStore((st: StoreShape) => ({
            ...st,
            settings: { ...st.settings, dashboard_show_summaries: !showSummaries, updated_at: new Date().toISOString() },
          }))}
        >
          {showSummaries ? 'Hide dashboard summaries' : 'Show dashboard summaries'}
        </button>
      </div>
      {cloud !== 'shared' && (
        <div className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          Connecting to the shared database…{syncState ? ` (${syncState})` : ''} Numbers below update once loading completes.
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {SHORTCUTS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-emerald-600 hover:shadow"
          >
            <div className="text-lg font-semibold text-emerald-800">{s.title} →</div>
            <p className="mt-1 text-sm text-stone-600">{s.desc}</p>
          </Link>
        ))}
      </div>

      {attention.length > 0 ? (
        <Card title="Needs attention">
          <ul className="space-y-2">
            {attention.map((a) => (
              <li key={a.key} className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <span>{a.text}</span>
                <Link href={a.href} className="font-medium underline">{a.label}</Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-500 shadow-sm">
          Nothing needs attention right now.
        </div>
      )}

      {showSummaries && (
        <Card title="Optional summaries (saved data only)">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Total customers" value={store.customers.length.toLocaleString()} sub={lastCust ? `Last import ${new Date(lastCust.imported_at).toLocaleString()}` : 'No imports yet'} />
            <Stat label="Reward batches" value={String(store.batches.length)} sub={`${pendingBatches.length} pending POS import · ${conf} confirmed · ${canc} cancelled`} />
            <Stat label="Point adjustments" value={store.adjustments.length.toLocaleString()} sub="confirmed POS applications" />
            <Stat label="Last sales import" value={lastSales ? new Date(lastSales.imported_at).toLocaleDateString() : '—'} sub={lastSales ? `${lastSales.filename} · period ${lastSales.reporting_period}` : 'none'} />
          </div>
          <p className="mt-3 text-xs text-stone-500">
            Counts above come from the shared database and only include saved records.
            The current unsaved calculation on Referral Sales is never counted as an exported batch.
          </p>
        </Card>
      )}
    </div>
  );
}

