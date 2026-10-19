'use client';
import { useMemo, useState } from 'react';
import { Card, btn, btnGhost, input, useStore } from '../store-context';
import { buildWorkbook, downloadWorkbook } from '@/lib/excel';
import { cad, calcReward, nowMs, todayStamp } from '@/lib/utils';
import { customerDisplayName, originatingLocation, type Customer, type ManualPointRecord, type RewardBatch } from '@/lib/types';

export default function ManualPointsPage() {
  const { store, setStore, commitAndSave, cloud, cloudError, cloudUser, loaded } = useStore();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Customer | null>(null);
  const [netText, setNetText] = useState('');
  // Rate-field state: track whether the user edited each field. Untouched fields
  // fall back to the saved Settings defaults AT RENDER TIME, so async settings
  // loads after sign-in are always reflected and user edits are never lost.
  const [pctEdited, setPctEdited] = useState(false);
  const [ppdEdited, setPpdEdited] = useState(false);
  const [pctUserText, setPctUserText] = useState('');
  const [ppdUserText, setPpdUserText] = useState('');
  const pctText: string = pctEdited ? pctUserText : String(store.settings.reward_pct);
  const ppdText: string = ppdEdited ? ppdUserText : String(store.settings.points_per_dollar);
  const [reason, setReason] = useState('');
  const [operator, setOperator] = useState(() => cloudUser ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return store.customers.filter((c) => c.active !== false)
      .filter((c) => [c.customer_id, c.company, c.first_name, c.last_name, c.phone1, c.phone2, c.cell_phone].filter(Boolean).join(' ').toLowerCase().includes(needle)).slice(0, 20);
  }, [q, store.customers]);
  // Always use the freshest copy of the selected customer (balance changes after confirm).
  const livePicked = picked ? (store.customers.find((c) => c.customer_id === picked.customer_id) ?? picked) : null;
  const net = netText.trim() === '' ? null : Number(netText);
  const pct = pctText.trim() === '' ? null : Number(pctText);
  const ppd = ppdText.trim() === '' ? null : Number(ppdText);
  const validNet = net !== null && Number.isFinite(net) && net > 0;
  const validPct = pct !== null && Number.isFinite(pct) && pct >= 0;
  const validPpd = ppd !== null && Number.isFinite(ppd) && ppd >= 0;
  const calc = validNet && validPct && validPpd ? calcReward(net as number, pct as number, ppd as number, store.settings.rounding) : null;
  const points = calc ? calc.points : null;
  const rewardValue = calc ? calc.rewardValue : null;
  const valid = validNet && validPct && validPpd && points !== null && points > 0;
  const projected = livePicked && valid ? livePicked.points + (points as number) : null;
  function pick(c: Customer) { setPicked(c); setMsg(null); }
  /**
   * Reset the unsaved form to a clean state. Uses the saved Settings defaults
   * for the rate fields; clears customer, net sales, notes, results and
   * messages. Writes NOTHING to the database and never touches balances or
   * existing batches.
   */
  function resetForm() {
    setQ('');
    setPicked(null);
    setNetText('');
    setPctEdited(false); setPctUserText('');
    setPpdEdited(false); setPpdUserText('');
    setReason('');
    setOperator(cloudUser ?? '');
    setMsg('Form reset — customer selection, Total Net Sales and Notes cleared. Reward Rate (' + store.settings.reward_pct + '%) and Points per $1 (' + store.settings.points_per_dollar + ') restored from saved Settings defaults; Operator prefilled with your sign-in identity. No database records were changed.');
  }
  async function doExport() {
    if (!livePicked) { setMsg('Search and select a customer first.'); return; }
    if (!validNet) { setMsg('Enter the total eligible net sales (before taxes).'); return; }
    if (!validPct) { setMsg('Enter the reward rate %.'); return; }
    if (!validPpd) { setMsg('Enter the points-per-$1 rate.'); return; }
    if (points === null || points <= 0) { setMsg('Calculation produced zero points — check net sales, rate, and conversion.'); return; }
    const op = (operator.trim() || cloudUser || '').trim();
    if (!op) { setMsg('Operator identity is required — sign in or type an operator name.'); return; }
    const cols = ['CustomerID', 'Points', ...store.settings.optional_columns.filter((c) => ['MemberID', 'AR', 'StoreCredit'].includes(c))];
    const row = cols.map((c) => c === 'CustomerID' ? livePicked.customer_id : c === 'Points' ? (points as number) : c === 'MemberID' ? (livePicked.member_id ?? '') : c === 'AR' ? (livePicked.ar ?? '') : c === 'StoreCredit' ? (livePicked.store_credit ?? '') : '');
    const batchId = 'MAN-' + todayStamp() + '-' + String(store.batches.length + 1).padStart(3, '0');
    const filename = batchId + '-manual-reward.xlsx';
    // 1) Generate and download the incremental-points file (not the balance).
    downloadWorkbook(buildWorkbook(cols, [row as (string | number)[]], ['CustomerID']), filename);
    const recId = 'man-' + nowMs();
    const rec: ManualPointRecord = {
      id: recId, batch_id: batchId, customer_id: livePicked.customer_id, customer_name: customerDisplayName(livePicked),
      originating_location: originatingLocation(livePicked.customer_id), balance_before: livePicked.points,
      points_adjustment: points as number, balance_after: livePicked.points + (points as number),
      reward_amount_dollars: rewardValue, points_per_dollar: ppd as number,
      net_sales: net as number, reward_pct: pct as number, reward_value: rewardValue as number,
      projected_balance: livePicked.points + (points as number),
      reason: reason.trim(), operator: op,
      created_at: new Date().toISOString(), exported_at: new Date().toISOString(), filename,
      status: 'Exported', confirmed_at: null,
    };
    const batch: RewardBatch = {
      id: batchId, reporting_period: 'manual', created_at: new Date().toISOString(), filename,
      entries: [{
        customer_id: livePicked.customer_id, customer_name: customerDisplayName(livePicked),
        referral_phone: '', referral_phones: [],
        net_sales: net as number, reward_pct: pct as number, reward_value: rewardValue as number,
        points_per_dollar: ppd as number, points: points as number,
        member_id: livePicked.member_id, ar: livePicked.ar ?? null, store_credit: livePicked.store_credit ?? null,
        originating_location: originatingLocation(livePicked.customer_id),
        override_status: null, override_reason: reason.trim() || null, override_operator: op, override_at: new Date().toISOString(), override_verified: true,
      }],
      settings: { reward_pct: pct as number, points_per_dollar: ppd as number, rounding: store.settings.rounding, optional_columns: cols.filter((c) => c !== 'CustomerID' && c !== 'Points'), optional_defaults: {} },
      status: 'Exported', total_net_sales: net as number, total_reward_value: rewardValue as number, total_points: points as number,
      columns: cols, applied_to_balances: false, kind: 'manual', origin: 'Manual reward',
    };
    // 2) Save the record and batch BEFORE treating the export as completed.
    try {
      await commitAndSave((st) => ({ ...st, manualPoints: [rec, ...st.manualPoints], batches: [batch, ...st.batches] }));
    } catch (e) {
      setMsg('The Excel file was downloaded, but the record could NOT be saved to the shared database'
        + (e instanceof Error ? ' (' + e.message + ')' : '')
        + '. Do not import it into Amber POS — check the connection and export again.');
      return;
    }
    setMsg('Exported ' + filename + ' (' + livePicked.customer_id + ' +' + points + ' pts). Balance unchanged until you confirm the POS import.');
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
  return (<div className="space-y-4"><h1 className="text-2xl font-bold">Manual Reward Calculator</h1>
    <p className="text-sm text-stone-600">Same reward math as Referral Sales — for one customer, no sales report needed. Export the POS file, import it in Amber, then confirm. Exporting never changes the stored balance.</p>
    {!loaded && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Loading shared customer database…</div>}
    {loaded && cloud !== 'shared' && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{cloudError ?? 'Shared database unavailable.'} Customer search and exports cannot be saved until the connection is restored.</div>}
    <Card title="1. Customer (from shared All Customers)">
      <input className={input} placeholder="Search Customer ID, name, or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!!matches.length && (<div className="mt-2 max-h-48 overflow-auto text-sm">{matches.map((c) => (<div key={c.customer_id} className="flex items-center justify-between gap-2 border-b py-1"><span>{customerDisplayName(c)} · {c.customer_id} · {originatingLocation(c.customer_id)} · {c.points} pts</span><button className={btnGhost} onClick={() => pick(c)}>Select</button></div>))}</div>)}
      {q.trim() && !matches.length && <div className="mt-2 text-sm text-stone-500">No customers match — check spelling or import the customer export first.</div>}
      {livePicked && (<div className="mt-2 rounded bg-emerald-50 p-2 text-sm">Selected: {customerDisplayName(livePicked)} · {livePicked.customer_id} · {originatingLocation(livePicked.customer_id)} · current known balance {livePicked.points} pts</div>)}
    </Card>
    <Card title="2. Reward calculation">
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <label className="text-sm">Total Net Sales ($)* — starts blank<input className={input} value={netText} onChange={(e) => setNetText(e.target.value)} placeholder="20.00" inputMode="decimal" /></label>
        <label className="text-sm">Reward Rate (%)* — prefilled from Settings<input className={input} value={pctText} onChange={(e) => { setPctUserText(e.target.value); setPctEdited(true); }} inputMode="decimal" /></label>
        <label className="text-sm">Points per $1* — prefilled from Settings<input className={input} value={ppdText} onChange={(e) => { setPpdUserText(e.target.value); setPpdEdited(true); }} inputMode="decimal" /></label>
      </div>
      <p className="mt-1 text-xs text-stone-500">Blank fields: Total Net Sales, Notes. Prefilled from saved Settings defaults: Reward Rate % and Points per $1 (edit freely — Reset Form restores them). Operator prefills with your signed-in staff identity.</p>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <label className="text-sm">Reward Value ($) — auto<input className={input} value={rewardValue !== null ? rewardValue.toFixed(2) : ''} readOnly placeholder="—" /></label>
        <label className="text-sm">Points to Award — auto<input className={input} value={points !== null ? String(points) : ''} readOnly placeholder="—" /></label>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <label className="text-sm">Notes / Reason (optional)<input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Goodwill gesture…" /></label>
        <label className="text-sm">Operator<input className={input} value={operator} onChange={(e) => setOperator(e.target.value)} placeholder={cloudUser ?? 'staff name'} /></label>
      </div>
      <div className="mt-2 rounded border p-2 text-sm">Current known balance: {livePicked ? livePicked.points + ' pts' : '—'} · Additional points to award: {points !== null ? points + ' pts' : '—'} · Projected balance after POS import: {projected !== null ? projected + ' pts' : '—'} · Reward value: {rewardValue !== null ? cad(rewardValue) : '—'}</div>
      <div className="mt-2 flex flex-wrap gap-2"><button className={btn} onClick={() => void doExport()}>Export POS File</button><button className={btnGhost} onClick={resetForm}>Reset Form</button></div>
      {msg && <div className="mt-2 rounded bg-emerald-50 p-2 text-sm text-emerald-900">{msg}</div>}
    </Card>
    <Card title={'Manual reward history (' + store.manualPoints.length + ')'}>
      {!store.manualPoints.length && <p className="text-sm text-stone-500">No manual rewards yet.</p>}
      {store.manualPoints.slice(0, 20).map((m) => (<div key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 text-sm">
        <span>{m.customer_name} · {m.customer_id} · net {m.net_sales != null ? cad(m.net_sales) : '—'} @ {m.reward_pct ?? '—'}% = {m.reward_value != null ? cad(m.reward_value) : '—'} → +{m.points_adjustment} pts · {m.status}</span>
        <span className="flex gap-2">{m.status === 'Exported' && (<><button className={btn} onClick={() => confirmRec(m.id)}>Confirm POS Import</button><button className={btnGhost} onClick={() => cancelRec(m.id)}>Cancel</button></>)}</span>
      </div>))}
    </Card>
  </div>);
}
