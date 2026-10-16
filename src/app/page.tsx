'use client';
import Link from 'next/link';
import { Card, Stat, useStore } from './store-context';
import { cad } from '@/lib/utils';

export default function Dashboard() {
  const { store } = useStore();
  const lastCust = store.customerImports[0];
  const lastSales = store.salesImports[0];
  const matched = store.referrals.filter((r) => r.match_status === 'matched').length;
  const ambiguous = store.referrals.filter((r) => r.match_status === 'ambiguous').length;
  const unmatched = store.referrals.filter((r) => r.match_status === 'unmatched').length;
  const sel = store.referrals.filter((r) => r.included);
  const pend = store.batches.filter((b) => b.status === 'Exported').length;
  const conf = store.batches.filter((b) => b.status === 'Confirmed').length;
  const canc = store.batches.filter((b) => b.status === 'Cancelled').length;
  const totalNet = store.referrals.reduce((a, r) => a + r.net_sales, 0);
  const totalVal = sel.reduce((a, r) => a + r.reward_value, 0);
  const totalPts = sel.reduce((a, r) => a + r.points, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-stone-600">Amber POS stays the source of truth. Import snapshots, calculate rewards, export points, then confirm after POS import.</p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/customers" className="rounded-lg bg-emerald-700 px-3 py-2 text-white">Import customers</Link>
          <Link href="/referrals" className="rounded-lg border px-3 py-2">Import sales</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total customers" value={store.customers.length.toLocaleString()} sub={lastCust ? `Last import ${new Date(lastCust.imported_at).toLocaleString()}` : 'No imports yet'} />
        <Stat label="Referral net sales" value={cad(totalNet)} sub={`${store.referrals.length} referrer rows`} />
        <Stat label="Matches" value={`${matched}/${ambiguous}/${unmatched}`} sub="matched / ambiguous / unmatched" />
        <Stat label="Selected rewards" value={`${totalPts.toLocaleString()} pts`} sub={`${cad(totalVal)} reward value`} />
        <Stat label="Last customer import" value={lastCust ? new Date(lastCust.imported_at).toLocaleDateString() : '—'} sub={lastCust ? `${lastCust.filename} · ${lastCust.records_processed.toLocaleString()} records` : 'none'} />
        <Stat label="Last sales import" value={lastSales ? new Date(lastSales.imported_at).toLocaleDateString() : '—'} sub={lastSales ? `${lastSales.filename} · period ${lastSales.reporting_period}` : 'none'} />
        <Stat label="Batches" value={`${store.batches.length}`} sub={`Pending ${pend} · Confirmed ${conf} · Cancelled ${canc}`} />
        <Stat label="Point adjustments" value={store.adjustments.length.toLocaleString()} sub="confirmed POS applications" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Recent customer imports">
          {!store.customerImports.length && <p className="text-sm text-stone-500">No imports yet.</p>}
          {store.customerImports.slice(0, 5).map((h) => (
            <div key={h.id} className="flex justify-between border-b py-1.5 text-sm">
              <span>{h.filename}</span>
              <span className="text-stone-500">+{h.added} ~{h.updated} · {new Date(h.imported_at).toLocaleString()}</span>
            </div>
          ))}
        </Card>
        <Card title="Recent sales imports & batches">
          {!store.salesImports.length && !store.batches.length && <p className="text-sm text-stone-500">No sales imports yet.</p>}
          {store.salesImports.slice(0, 3).map((h) => (
            <div key={h.id} className="flex justify-between border-b py-1.5 text-sm">
              <span>{h.filename} ({h.reporting_period})</span>
              <span className="text-stone-500">{h.records_processed} rows</span>
            </div>
          ))}
          {store.batches.slice(0, 4).map((b) => (
            <div key={b.id} className="flex justify-between border-b py-1.5 text-sm">
              <span>{b.id} · {b.status}</span>
              <span className="text-stone-500">{b.total_points} pts · {b.entries.length} customers</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
