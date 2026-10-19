'use client';
import { useEffect, useMemo, useState } from 'react';
import { Card, btn, btnDanger, btnGhost, useStore } from '../store-context';
import { buildWorkbook, downloadWorkbook } from '@/lib/excel';
import { cad } from '@/lib/utils';
import { deleteRewardBatches, fetchIsAdmin } from '@/lib/admin';
import type { BatchStatus, PointAdjustment, RewardBatch } from '@/lib/types';
export default function HistoryPage() {
const { store, setStore, cloud, cloudError, loaded, commitAndSave, refreshFromCloud } = useStore();
const [open, setOpen] = useState<string|null>(null);
const [kindFilter, setKindFilter] = useState<'all'|'referral'|'manual'>('all');
const [msg, setMsg] = useState<string|null>(null);
// Reward-history bulk deletion (administrators only; the database re-checks authorization).
const [isAdmin, setIsAdmin] = useState(false);
const [sel, setSel] = useState<string[]>([]);
const [delConfirm, setDelConfirm] = useState(false);
const [delBusy, setDelBusy] = useState<null | 'checking' | 'deleting'>(null);
const [delMsg, setDelMsg] = useState<{ ok: boolean; text: string } | null>(null);
useEffect(() => {
  if (cloud !== 'shared') return;
  let live = true;
  void fetchIsAdmin().then((v) => { if (live) setIsAdmin(v); });
  return () => { live = false; };
}, [cloud]);
function setStatus(id: string, status: BatchStatus) {
const b = store.batches.find((x)=>x.id===id); if(!b) return;
if (status==='Confirmed' && b.applied_to_balances) { setMsg('Already applied — cannot apply twice.'); return; }
if (status==='Cancelled' && b.status==='Confirmed') { setMsg('Already imported into POS — cancellation cannot reverse the POS. Contact management for a correcting adjustment.'); return; }
if (status==='Confirmed') {
const custById = new Map(store.customers.map((c)=>[c.customer_id,c]));
const seen = new Set(store.adjustments.map((a)=>a.batch_id+':'+a.customer_id));
const adjs: PointAdjustment[] = []; const next = new Map(custById);
for (const e of b.entries) { if (seen.has(b.id+':'+e.customer_id)) continue;
const cur = next.get(e.customer_id); const before = cur ? cur.points : 0;
if (cur) next.set(e.customer_id, { ...cur, points: before + e.points, updated_at: new Date().toISOString() });
adjs.push({ id: b.id+':'+e.customer_id+':'+Date.now(), batch_id: b.id, customer_id: e.customer_id, points_added: e.points, balance_before: before, balance_after: before + e.points, confirmed_at: new Date().toISOString(), note: 'Confirmed POS import '+b.filename }); }
setStore((st)=>({ ...st, customers: Array.from(next.values()), adjustments: [...adjs, ...st.adjustments],
batches: st.batches.map((x)=>x.id===id?{...x,status:'Confirmed',applied_to_balances:true}:x) }));
setMsg('Confirmed '+b.id+': 20 + 10 = 30 style addition applied once per customer with audit records.');
} else { setStore((st)=>({ ...st, batches: st.batches.map((x)=>x.id===id?{...x,status}:x) })); setMsg(b.id+' → '+status); } }
function redownload(id: string) { const b = store.batches.find((x)=>x.id===id); if(!b) return;
const body = b.entries.map((e)=>b.columns.map((c)=>c==='CustomerID'?e.customer_id:c==='Points'?e.points:c==='MemberID'?(e.member_id??''):c==='AR'?(e.ar??''):c==='StoreCredit'?(e.store_credit??''):''));
downloadWorkbook(buildWorkbook(b.columns, body as (string|number)[][], ['CustomerID']), b.filename);
setMsg('Re-downloaded original file for '+id+'. No new batch created, no points applied.'); }
/** Delete the selected reward batches (administrators only): flush pending local
 *  edits first so "safe" matches the database, then let admin_delete_reward_batches
 *  decide what may be removed. On success: refresh, clear selection, report exactly. */
async function runDelete() {
  const ids = sel;
  if (!ids.length || delBusy) return;
  setDelMsg(null);
  if (cloud !== 'shared') {
    setDelMsg({ ok: false, text: 'Shared database unavailable — reward history cannot be deleted right now.' });
    setDelConfirm(false);
    return;
  }
  if (!isAdmin) {
    setDelMsg({ ok: false, text: 'Not authorized: administrator access is required to delete reward history — the database re-checks this on every call.' });
    setDelConfirm(false);
    return;
  }
  setDelBusy('checking');
  try {
    try {
      await commitAndSave((s) => s); // flush pending local edits so the pre-check matches the database
    } catch (e) {
      setDelMsg({ ok: false, text: 'Could not sync pending changes — nothing was deleted. ' + (e instanceof Error ? e.message : String(e)) });
      setDelConfirm(false);
      return;
    }
    setDelBusy('deleting');
    const res = await deleteRewardBatches(ids);
    setDelMsg({ ok: res.ok, text: res.message });
    if (res.ok) {
      setSel([]);
      try { await refreshFromCloud(); } catch { /* the shared-database banner reports it */ }
    }
    setDelConfirm(false);
  } finally {
    setDelBusy(null);
  }
}
const pend = store.batches.filter((b)=>b.status==='Exported').length;
const shown = store.batches.filter((b)=>kindFilter==='all'?true:(b.kind??'referral')===kindFilter);
  void setKindFilter;
  const adjBatchIds = useMemo(() => new Set(store.adjustments.map((a) => a.batch_id)), [store.adjustments]);
  const manBatchIds = useMemo(() => new Set(store.manualPoints.map((m) => m.batch_id).filter(Boolean)), [store.manualPoints]);
  // Only where safe: a batch may be deleted unless applied point records, a manual
  // point record, or an applied-to-balances flag references it — that history is kept.
  const isUnsafeBatch = (b: RewardBatch) => b.applied_to_balances === true || adjBatchIds.has(b.id) || manBatchIds.has(b.id);
  const selList = store.batches.filter((b) => sel.includes(b.id));
  const safeSel = selList.filter((b) => !isUnsafeBatch(b));
  const unsafeSel = selList.filter((b) => isUnsafeBatch(b));
  const safeEntries = safeSel.reduce((n, b) => n + b.entries.length, 0);
return (<div className="space-y-4"><h1 className="text-2xl font-bold">Reward History</h1>
{!loaded&&<div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Loading shared database…</div>}
{loaded&&cloud!=='shared'&&<div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{cloudError??'Shared database unavailable.'} History shown may be stale until the connection is restored.</div>}
<p className="text-sm text-stone-600">{store.batches.length} batches · {pend} pending POS import. Re-downloading never creates a new batch.</p>
{msg&&<div className="rounded bg-emerald-50 p-2 text-sm text-emerald-900">{msg}</div>}
{isAdmin&&!!store.batches.length&&(<div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
  <label className="flex items-center gap-1"><input type="checkbox" checked={shown.length>0&&shown.every((b)=>sel.includes(b.id))} onChange={(e)=>{ if(e.target.checked){ setSel((s)=>Array.from(new Set([...s,...shown.map((b)=>b.id)]))); } else { const shownIds=new Set(shown.map((b)=>b.id)); setSel((s)=>s.filter((id)=>!shownIds.has(id))); } }} /> Select All{kindFilter!=='all'?' (shown)':''}</label>
  <span>{sel.length} selected</span>
  {sel.length>0&&<button className={btnGhost} disabled={!!delBusy} onClick={()=>{setSel([]); setDelConfirm(false);}}>Clear</button>}
  <button className={btnDanger} disabled={!sel.length||!!delBusy} onClick={()=>{setDelMsg(null); setDelConfirm(true);}}>Delete Selected</button>
</div>)}
{delMsg&&(<div className={'rounded border p-2 text-sm '+(delMsg.ok?'border-emerald-300 bg-emerald-50 text-emerald-900':'border-red-300 bg-red-50 text-red-800')}>{delMsg.text}</div>)}
{delConfirm&&(<div className="mb-3 rounded border border-red-300 bg-red-50 p-3 text-sm">
  <div className="font-semibold text-red-900">{!selList.length ? 'Selected batch(es) no longer exist' : `Delete ${unsafeSel.length?safeSel.length+' of '+selList.length:selList.length} selected reward batch(es) — ${safeEntries} reward-entry record(s)?`}</div>
  {!selList.length&&<p className="mt-1 text-xs">They have already been removed elsewhere. Close this dialog and review the list.</p>}
  {selList.length>0&&(<>
  <p className="mt-1">Exactly what will be DELETED, permanently, from the shared database for all staff and devices:</p>
  <ul className="mt-1 max-h-40 list-disc overflow-auto pl-5 text-xs">
    {selList.slice(0,30).map((b)=>{ const safe=!isUnsafeBatch(b); return (<li key={b.id} className={safe?'':'font-semibold text-red-900'}>{safe?'':'KEEP — '}{b.kind==='manual'?'[Manual] ':''}{b.id} · {b.status} · period {b.reporting_period} · {b.entries.length} reward entries · {b.filename}</li>); })}
    {selList.length>30&&<li>…and {selList.length-30} more</li>}
  </ul>
  <p className="mt-1 text-xs">Each selected batch&apos;s details and its associated reward-entry records are deleted together ({safeEntries} reward-entry record(s) in total). Deletion runs through an administrator-only database operation and is written to the audit log.</p>
  {unsafeSel.length>0&&(<p className="mt-1 rounded border border-amber-300 bg-amber-50 p-1.5 text-xs text-amber-900">Skipped — never deleted: {unsafeSel.length} selected batch(es) have applied point records or were applied to balances: {unsafeSel.map((b)=>b.id).join(', ')}. They are kept while the safe batches are deleted.</p>)}
  <p className="mt-1 text-xs">Never touched: point adjustments, manual point records, sales imports, customers, import history and audit logs.</p>
  </>)}
  <div className="mt-2 flex gap-2">
    <button className={btnGhost} disabled={!!delBusy} onClick={()=>setDelConfirm(false)}>Cancel</button>
    {safeSel.length>0&&<button className={btnDanger} disabled={!!delBusy} onClick={()=>void runDelete()}>{delBusy==='checking'?'Preparing…':delBusy==='deleting'?'Deleting…':'Confirm Delete ('+safeSel.length+')'}</button>}
  </div>
  {selList.length>0&&!safeSel.length&&<p className="mt-2 text-xs font-semibold text-red-900">Nothing safe to delete — every selected batch is referenced by applied history. Keep it, or deselect some batches.</p>}
</div>)}
{!store.batches.length&&<Card title="No batches yet"><p className="text-sm text-stone-500">Export rewards from the Referral Sales page.</p></Card>}
{shown.map((b)=>(<Card key={b.id} title={(b.kind==='manual'?'[Manual] ':'')+b.id+' · '+b.status} right={<div className="flex flex-wrap items-center gap-2">
{isAdmin&&<input type="checkbox" checked={sel.includes(b.id)} onChange={()=>setSel((s)=>s.includes(b.id)?s.filter((x)=>x!==b.id):[...s,b.id])} aria-label={'Select batch '+b.id} title={'Select batch '+b.id} className="h-4 w-4 cursor-pointer accent-emerald-700"/>}
<button className={btnGhost} onClick={()=>setOpen(open===b.id?null:b.id)}>{open===b.id?'Hide':'Inspect'}</button>
<button className={btnGhost} onClick={()=>redownload(b.id)}>Download file again</button>
{b.status==='Exported'&&<button className={btn} onClick={()=>setStatus(b.id,'Confirmed')}>Confirm POS Import</button>}
{(b.status==='Draft'||b.status==='Exported')&&<button className={btnGhost} onClick={()=>setStatus(b.id,'Cancelled')}>Cancel</button>}
</div>}>
<div className="text-sm">Period {b.reporting_period} · {new Date(b.created_at).toLocaleString()} · {b.filename} · {b.entries.length} customers · {cad(b.total_net_sales)} net · {cad(b.total_reward_value)} rewards · {b.total_points} pts · settings {b.settings.reward_pct}% × {b.settings.points_per_dollar}ppd ({b.settings.rounding})</div>
{open===b.id&&(<div className="mt-2 overflow-x-auto"><table className="w-full border-collapse text-sm"><thead><tr><th className="thx">Customer</th><th className="thx">Phone</th><th className="thx">Net</th><th className="thx">%</th><th className="thx">$</th><th className="thx">ppd</th><th className="thx">Pts</th><th className="thx">Override</th></tr></thead>
<tbody>{b.entries.map((e)=>(<tr key={e.customer_id}><td className="tdx">{e.customer_name}<div className="font-mono text-xs">{e.customer_id} · {e.originating_location}</div></td><td className="tdx font-mono text-xs">{e.referral_phone}</td><td className="tdx">{cad(e.net_sales)}</td><td className="tdx">{e.reward_pct}%</td><td className="tdx">{cad(e.reward_value)}</td><td className="tdx">{e.points_per_dollar}</td><td className="tdx">{e.points}</td><td className="tdx text-xs">{e.override_status??'—'}</td></tr>))}</tbody></table></div>)}
</Card>))}
<Card title={'Point adjustments ('+store.adjustments.length+')'}><div className="max-h-64 overflow-auto text-sm">{store.adjustments.slice(0,100).map((a)=>(<div key={a.id} className="border-b py-1">{new Date(a.confirmed_at).toLocaleString()} · {a.batch_id} · {a.customer_id}: +{a.points_added} ({a.balance_before} → {a.balance_after})</div>))}</div></Card>
</div>); }
