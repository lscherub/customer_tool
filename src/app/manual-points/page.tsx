'use client';
import { useMemo, useState } from 'react';
import { Card, btn, btnGhost, input, useStore } from '../store-context';
import { buildWorkbook, downloadWorkbook } from '@/lib/excel';
import { todayStamp } from '@/lib/utils';
import { customerDisplayName, originatingLocation, type Customer, type ManualPointRecord, type RewardBatch } from '@/lib/types';

export default function ManualPointsPage() {
  const { store, setStore } = useStore();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Customer | null>(null);
  const [ptsText, setPtsText] = useState('');
  const [dollarsText, setDollarsText] = useState('');
  const [ppdText, setPpdText] = useState(String(10));
  const [reason, setReason] = useState('');
  const [operator, setOperator] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [, setLastId] = useState<string | null>(null);
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return store.customers.filter((c) => [c.customer_id, c.company, c.first_name, c.last_name, c.phone1, c.phone2, c.cell_phone].filter(Boolean).join(' ').toLowerCase().includes(needle)).slice(0, 20);
  }, [q, store.customers]);
  const ptsManual = ptsText.trim() === '' ? null : Number(ptsText);
  const dollars = dollarsText.trim() === '' ? null : Number(dollarsText);
  const ppd = ppdText.trim() === '' ? null : Number(ppdText);
  const derived = dollars !== null && ppd !== null && Number.isFinite(dollars) && Number.isFinite(ppd) ? Math.round(dollars * ppd) : null;
  const adjustment = ptsManual !== null && Number.isFinite(ptsManual) ? Math.trunc(ptsManual) : derived;
  const validAdj = adjustment !== null && Number.isFinite(adjustment) && Number.isInteger(adjustment) && adjustment !== 0;
  const projected = picked && validAdj ? picked.points + (adjustment as number) : null;
  function pick(c: Customer) { setPicked(c); setMsg(null); }
  function computeAdj(): number | null {
    if (!validAdj) return null;
    return adjustment as number;
  }
  function doExport() {
    if (!picked) { setMsg('Search and select a customer first.'); return; }
    const adj = computeAdj();
    if (adj === null) { setMsg('Enter a non-zero whole-number points adjustment (or dollars x points-per-$1).'); return; }
    if (!reason.trim()) { setMsg('Enter a reason or note for the adjustment (audit trail).'); return; }
    if (!operator.trim()) { setMsg('Enter the operator name (audit trail).'); return; }
    const cols = ['CustomerID', 'Points', ...store.settings.optional_columns.filter((c) => ['MemberID', 'AR', 'StoreCredit'].includes(c))];
    const row = cols.map((c) => c === 'CustomerID' ? picked.customer_id : c === 'Points' ? adj : c === 'MemberID' ? (picked.member_id ?? '') : c === 'AR' ? (picked.ar ?? '') : c === 'StoreCredit' ? (picked.store_credit ?? '') : '');
    const batchId = 'MAN-' + todayStamp() + '-' + String(store.batches.length + 1).padStart(3, '0');
    const filename = batchId + '-manual-points.xlsx';
    downloadWorkbook(buildWorkbook(cols, [row as (string | number)[]], ['CustomerID']), filename);
    const recId = 'man-' + Date.now();
    const rec: ManualPointRecord = {
      id: recId, batch_id: batchId, customer_id: picked.customer_id, customer_name: customerDisplayName(picked),
      originating_location: originatingLocation(picked.customer_id), balance_before: picked.points,
      points_adjustment: adj, balance_after: picked.points + adj,
      reward_amount_dollars: dollars, points_per_dollar: ppd, reason: reason.trim(), operator: operator.trim(),
      created_at: new Date().toISOString(), exported_at: new Date().toISOString(), filename,
      status: 'Exported', confirmed_at: null,
    };
    const batch: RewardBatch = {
      id: batchId, reporting_period: 'manual', created_at: new Date().toISOString(), filename,
      entries: [{ customer_id: picked.customer_id, customer_name: customerDisplayName(picked), referral_phone: 'manual', referral_phones: ['manual'], net_sales: 0, reward_pct: 0, reward_value: dollars ?? 0, points_per_dollar: ppd ?? 0, points: adj, member_id: picked.member_id, ar: picked.ar ?? null, store_credit: picked.store_credit ?? null, originating_location: originatingLocation(picked.customer_id), override_status: null, override_reason: reason.trim(), override_operator: operator.trim(), override_at: new Date().toISOString(), override_verified: true }],
      settings: { reward_pct: 0, points_per_dollar: ppd ?? 0, rounding: store.settings.rounding, optional_columns: cols.slice(2), optional_defaults: {} },
      status: 'Exported', total_net_sales: 0, total_reward_value: dollars ?? 0, total_points: adj, columns: cols, applied_to_balances: false,
      kind: 'manual', origin: 'Manual points adjustment',
    };
    setStore((st) => ({ ...st, batches: [batch, ...st.batches], manualPoints: [rec, ...st.manualPoints] }));
    setLastId(recId);
    setMsg('Exported ' + filename + ' (1 row: ' + picked.customer_id + ' ' + (adj > 0 ? '+' : '') + adj + ' pts). Stored balance unchanged until you confirm POS import below.');
  }
  function confirmRec(id: string) {
    const rec = store.manualPoints.find((m) => m.id === id); if (!rec) return;
    if (rec.status === 'Confirmed') { setMsg('Already confirmed — cannot apply twice.'); return; }
    if (rec.status === 'Cancelled') { setMsg('Cancelled records cannot be confirmed.'); return; }
    const cust = store.customers.find((c) => c.customer_id === rec.customer_id);
    const before = cust ? cust.points : rec.balance_before;
    const after = before + rec.points_adjustment;
    setStore((st) => ({
      ...st,
      customers: cust ? st.customers.map((c) => c.customer_id === rec.customer_id ? { ...c, points: after, updated_at: new Date().toISOString() } : c) : st.customers,
      manualPoints: st.manualPoints.map((m) => m.id === id ? { ...m, status: 'Confirmed' as const, confirmed_at: new Date().toISOString(), balance_before: before, balance_after: after } : m),
      batches: st.batches.map((b) => b.id === rec.batch_id ? { ...b, status: 'Confirmed' as const, applied_to_balances: true } : b),
      adjustments: [{ id: rec.batch_id + ':' + rec.customer_id + ':' + Date.now(), batch_id: rec.batch_id ?? rec.id, customer_id: rec.customer_id, points_added: rec.points_adjustment, balance_before: before, balance_after: after, confirmed_at: new Date().toISOString(), note: 'Manual points: ' + rec.reason } , ...st.adjustments],
    }));
    setMsg('Confirmed ' + rec.customer_id + ': applied once.');
  }
  function cancelRec(id: string) {
    const rec = store.manualPoints.find((m) => m.id === id); if (!rec) return;
    if (rec.status === 'Confirmed') { setMsg('Already imported — cannot reverse via cancel.'); return; }
    setStore((st) => ({ ...st, manualPoints: st.manualPoints.map((m) => m.id === id ? { ...m, status: 'Cancelled' as const } : m) }));
    setMsg('Cancelled ' + id + '. No balance changed.');
  }
  return (<div className="space-y-4"><h1 className="text-2xl font-bold">Manual Points Calculator</h1>
    <p className="text-sm text-stone-600">One-off Amber POS adjustments without a referral report. Export, import in POS, then confirm — only then is the stored balance updated.</p>
    <Card title="1. Find customer">
      <input className={input} placeholder="Search Customer ID, name, or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!!matches.length && (<div className="mt-2 max-h-48 overflow-auto text-sm">{matches.map((c) => (<div key={c.customer_id} className="flex items-center justify-between gap-2 border-b py-1"><span>{customerDisplayName(c)} · {c.customer_id} · {c.points} pts</span><button className={btnGhost} onClick={() => pick(c)}>Select</button></div>))}</div>)}
      {picked && (<div className="mt-2 rounded bg-emerald-50 p-2 text-sm">Selected: {customerDisplayName(picked)} · {picked.customer_id} · {originatingLocation(picked.customer_id)} · current {picked.points} pts</div>)}
    </Card>
    <Card title="2. Points adjustment">
      <div className="grid gap-2 md:grid-cols-3">
        <label className="text-sm">Points adjustment (whole +/-)<input className={input} value={ptsText} onChange={(e) => setPtsText(e.target.value)} placeholder="50 or -20" /></label>
        <label className="text-sm">Reward amount $ (optional)<input className={input} value={dollarsText} onChange={(e) => setDollarsText(e.target.value)} placeholder="5.00" /></label>
        <label className="text-sm">Points per $1 (optional)<input className={input} value={ppdText} onChange={(e) => setPpdText(e.target.value)} /></label>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <label className="text-sm">Reason / note<input className={input} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <label className="text-sm">Operator<input className={input} value={operator} onChange={(e) => setOperator(e.target.value)} /></label>
      </div>
      <div className="mt-2 rounded border p-2 text-sm">Existing: {picked ? picked.points : '—'} · Adjustment: {validAdj ? (adjustment as number) : '—'} · Projected: {projected ?? '—'}</div>
      <div className="mt-2"><button className={btn} onClick={doExport}>Export POS File</button></div>
      {msg && <div className="mt-2 rounded bg-emerald-50 p-2 text-sm text-emerald-900">{msg}</div>}
    </Card>
    <Card title={'Manual adjustment history (' + store.manualPoints.length + ')'}>
      {!store.manualPoints.length && <p className="text-sm text-stone-500">No manual adjustments yet.</p>}
      {store.manualPoints.slice(0, 20).map((m) => (<div key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 text-sm">
        <span>{m.customer_name} · {m.customer_id} · {m.balance_before} + ({m.points_adjustment}) = {m.balance_after} · {m.status}</span>
        <span className="flex gap-2">{m.status === 'Exported' && (<><button className={btn} onClick={() => confirmRec(m.id)}>Confirm POS Import</button><button className={btnGhost} onClick={() => cancelRec(m.id)}>Cancel</button></>)}</span>
      </div>))}
    </Card>
  </div>);
}
