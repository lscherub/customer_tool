'use client';
import { useState } from 'react';
import { Card, btn, btnGhost, input, useStore } from '../store-context';
import { buildWorkbook, downloadWorkbook } from '@/lib/excel';
import { cad } from '@/lib/utils';
import type { BatchStatus, PointAdjustment } from '@/lib/types';
export default function HistoryPage() {
const { store, setStore } = useStore();
const [open, setOpen] = useState<string|null>(null);
const [msg, setMsg] = useState<string|null>(null);
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
const pend = store.batches.filter((b)=>b.status==='Exported').length;
return (<div className="space-y-4"><h1 className="text-2xl font-bold">Reward History</h1>
<p className="text-sm text-stone-600">{store.batches.length} batches · {pend} pending POS import. Re-downloading never creates a new batch.</p>
{msg&&<div className="rounded bg-emerald-50 p-2 text-sm text-emerald-900">{msg}</div>}
{!store.batches.length&&<Card title="No batches yet"><p className="text-sm text-stone-500">Export rewards from the Referral Sales page.</p></Card>}
{store.batches.map((b)=>(<Card key={b.id} title={b.id+' · '+b.status} right={<div className="flex gap-2">
<button className={btnGhost} onClick={()=>setOpen(open===b.id?null:b.id)}>{open===b.id?'Hide':'Inspect'}</button>
<button className={btnGhost} onClick={()=>redownload(b.id)}>Download file again</button>
{b.status==='Exported'&&<button className={btn} onClick={()=>setStatus(b.id,'Confirmed')}>Confirm POS Import</button>}
{(b.status==='Draft'||b.status==='Exported')&&<button className={btnGhost} onClick={()=>setStatus(b.id,'Cancelled')}>Cancel</button>}
</div>}>
<div className="text-sm">Period {b.reporting_period} · {new Date(b.created_at).toLocaleString()} · {b.filename} · {b.entries.length} customers · {cad(b.total_net_sales)} net · {cad(b.total_reward_value)} rewards · {b.total_points} pts · settings {b.settings.reward_pct}% × {b.settings.points_per_dollar}ppd ({b.settings.rounding})</div>
{open===b.id&&(<div className="mt-2 overflow-x-auto"><table className="w-full border-collapse text-sm"><thead><tr><th className="thx">Customer</th><th className="thx">Phone</th><th className="thx">Net</th><th className="thx">%</th><th className="thx">$</th><th className="thx">ppd</th><th className="thx">Pts</th></tr></thead>
<tbody>{b.entries.map((e)=>(<tr key={e.customer_id}><td className="tdx">{e.customer_name}<div className="font-mono text-xs">{e.customer_id} · {e.originating_location}</div></td><td className="tdx font-mono text-xs">{e.referral_phone}</td><td className="tdx">{cad(e.net_sales)}</td><td className="tdx">{e.reward_pct}%</td><td className="tdx">{cad(e.reward_value)}</td><td className="tdx">{e.points_per_dollar}</td><td className="tdx">{e.points}</td></tr>))}</tbody></table></div>)}
</Card>))}
<Card title={'Point adjustments ('+store.adjustments.length+')'}><div className="max-h-64 overflow-auto text-sm">{store.adjustments.slice(0,100).map((a)=>(<div key={a.id} className="border-b py-1">{new Date(a.confirmed_at).toLocaleString()} · {a.batch_id} · {a.customer_id}: +{a.points_added} ({a.balance_before} → {a.balance_after})</div>))}</div></Card>
</div>); }
