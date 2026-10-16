'use client';
import { useMemo, useState } from 'react';
import { Card, btn, btnGhost, input, useStore } from '../store-context';
import { buildWorkbook, downloadWorkbook, parseWorkbookFile } from '@/lib/excel';
import { buildPhoneIndex } from '@/lib/store';
import { rowsToSales } from '@/lib/sales-import';
import { cad, calcReward, todayStamp } from '@/lib/utils';
import { customerDisplayName, originatingLocation, type ImportHistoryItem, type ReferralAggregate, type RewardBatch, type RewardEntry } from '@/lib/types';
const ALL_COLS = ['CustomerID', 'Points', 'MemberID', 'AR', 'StoreCredit'];
export default function ReferralsPage() {
const { store, setStore } = useStore();
const [period, setPeriod] = useState('2026-10');
const [preview, setPreview] = useState<{ filename: string; rows: Record<string, unknown>[]; headers: string[] } | null>(null);
const [fieldMap, setFieldMap] = useState({ phone: 'group2', net: 'Subtotal', txn: 'TotalTransactions', store: 'StoreName' });
const [parsing, setParsing] = useState(false);
const [msg, setMsg] = useState<string | null>(null);
const [showPreview, setShowPreview] = useState(false);
async function onFile(f: File) { setParsing(true); setMsg(null);
try { const p = await parseWorkbookFile(f); setPreview({ filename: f.name, rows: p.rows, headers: p.headers }); setShowPreview(true); } catch (e) { setMsg('Parse failed: ' + (e instanceof Error ? e.message : String(e))); } finally { setParsing(false); } }
// (import helpers above)
const parsedSales = useMemo(() => preview ? rowsToSales(preview.rows) : null, [preview]);
const dupeWarn = useMemo(() => {
if (!preview) return null;
const sameFile = store.salesImports.find((h) => h.filename === preview.filename);
const samePeriod = store.salesImports.filter((h) => h.reporting_period === period);
return { sameFile, samePeriod };
}, [preview, period, store.salesImports]);
function commitSalesImport() {
if (!preview || !parsedSales) return;
const { data, skipped } = parsedSales;
const byPhone = new Map<string, { raw: string; net: number; txn: number; stores: Set<string> }>();
for (const r of data) { const e = byPhone.get(r.phoneNorm) ?? { raw: r.phoneRaw, net: 0, txn: 0, stores: new Set<string>() };
e.net += r.net; e.txn += r.transactions ?? 0; if (r.store) e.stores.add(r.store); byPhone.set(r.phoneNorm, e); }
const idx = buildPhoneIndex(store.customers);
const importId = 'simp-' + Date.now();
let matched = 0, ambiguous = 0, unmatched = 0;
const aggs: ReferralAggregate[] = [];
for (const [norm, v] of byPhone) {
const cands = idx.get(norm) ?? [];
const prior = store.referrals.find((x) => x.referral_phone_normalized === norm);
const status: ReferralAggregate['match_status'] = cands.length === 1 ? 'matched' : cands.length > 1 ? 'ambiguous' : 'unmatched';
if (status === 'matched') matched++; else if (status === 'ambiguous') ambiguous++; else unmatched++;
const chosen = cands.length === 1 ? cands[0] : (prior?.selected_customer_id ? cands.find((c) => c.customer_id === prior.selected_customer_id) ?? null : null);
const rw = calcReward(v.net, store.settings.reward_pct, store.settings.points_per_dollar, store.settings.rounding);
aggs.push({ id: importId + '-' + norm, sales_import_id: importId, reporting_period: period, referral_phone_raw: v.raw, referral_phone_normalized: norm,
matched_customer_id: chosen ? chosen.customer_id : (cands[0]?.customer_id ?? null),
matched_customer_name: chosen ? customerDisplayName(chosen) : (cands[0] ? customerDisplayName(cands[0]) : null),
match_status: chosen && status === 'ambiguous' ? 'ambiguous' : status, candidates: cands,
selected_customer_id: chosen ? chosen.customer_id : null, net_sales: Math.round(v.net * 100) / 100, transaction_count: v.txn || null,
referred_count_label: 'unavailable', reward_pct: store.settings.reward_pct, reward_value: rw.rewardValue,
points_per_dollar: store.settings.points_per_dollar, points: rw.points,
reward_status: status === 'matched' ? 'eligible' : 'needs_review', store_names: Array.from(v.stores), included: status === 'matched',
custom_reward_pct: null, custom_points_per_dollar: null });
}
const rec: ImportHistoryItem = { id: importId, kind: 'sales', filename: preview.filename, imported_at: new Date().toISOString(),
records_processed: data.length, added: aggs.length, updated: 0, unchanged: 0, skipped: skipped.length, failed: 0,
errors: skipped.slice(0, 50), reporting_period: period };
setStore((st) => { const others = st.referrals.filter((r) => r.reporting_period !== period);
return { ...st, referrals: [...aggs, ...others], salesImports: [rec, ...st.salesImports] }; });
setMsg('Imported ' + data.length + ' sales rows into ' + aggs.length + ' referrers for ' + period + ' (' + matched + ' matched, ' + ambiguous + ' ambiguous, ' + unmatched + ' unmatched). ' + skipped.length + ' rows skipped (summaries/blank).');
setPreview(null); setShowPreview(false);
}
// PART3
const rows = store.referrals;
function recalc(id: string, patch: Partial<ReferralAggregate>) {
setStore((st) => ({ ...st, referrals: st.referrals.map((r) => {
if (r.id !== id) return r;
const n = { ...r, ...patch };
const pct = n.custom_reward_pct ?? n.reward_pct; const ppd = n.custom_points_per_dollar ?? n.points_per_dollar;
const rw = calcReward(n.net_sales, pct, ppd, st.settings.rounding);
return { ...n, reward_pct: patch.reward_pct ?? n.reward_pct, points_per_dollar: patch.points_per_dollar ?? n.points_per_dollar, reward_value: rw.rewardValue, points: rw.points };
}) })); }
function toggle(id: string) { const r = rows.find((x) => x.id === id); if (!r) return;
if (!r.included && r.match_status !== 'matched') { setMsg('Resolve shared/unmatched phone before including.'); return; }
recalc(id, { included: !r.included, reward_status: !r.included ? 'eligible' : r.reward_status }); }
function toggleAll(v: boolean) { setStore((st) => ({ ...st, referrals: st.referrals.map((r) => (r.match_status === 'matched' ? { ...r, included: v } : r)) })); }
function resolve(id: string, cid: string) { const r = rows.find((x) => x.id === id); if (!r) return;
const c = (r.candidates ?? []).find((x) => x.customer_id === cid);
setStore((st) => ({ ...st, referrals: st.referrals.map((x) => x.id === id ? { ...x, selected_customer_id: cid, matched_customer_id: cid, matched_customer_name: c ? customerDisplayName(c) : x.matched_customer_name, match_status: 'matched' as const, reward_status: 'eligible' as const, included: true } : x) })); }
const sel = rows.filter((r) => r.included && r.match_status === 'matched');
const tNet = sel.reduce((a, r) => a + r.net_sales, 0); const tVal = sel.reduce((a, r) => a + r.reward_value, 0); const tPts = sel.reduce((a, r) => a + r.points, 0);
const warnDup = useMemo(() => { const pend = store.batches.filter((b) => b.status === 'Exported' || b.status === 'Draft');
const ids = new Set(sel.map((r) => (r.selected_customer_id || r.matched_customer_id) + '|' + r.reporting_period));
return pend.filter((b) => b.entries.some((e) => ids.has(e.customer_id + '|' + b.reporting_period))).map((b) => b.id); }, [store.batches, sel]);
function doExport() {
if (!sel.length) { setMsg('Select at least one matched row.'); return; }
const cols = ['CustomerID', 'Points', ...store.settings.optional_columns.filter((c) => ALL_COLS.includes(c))];
const entries: RewardEntry[] = sel.map((r) => { const cid = r.selected_customer_id || r.matched_customer_id || '';
const cust = store.customers.find((c) => c.customer_id === cid);
return { customer_id: cid, customer_name: r.matched_customer_name || '', referral_phone: r.referral_phone_raw, net_sales: r.net_sales,
reward_pct: r.custom_reward_pct ?? r.reward_pct, reward_value: r.reward_value, points_per_dollar: r.custom_points_per_dollar ?? r.points_per_dollar,
points: r.points, member_id: cust?.member_id, ar: cust?.ar ?? null, store_credit: cust?.store_credit ?? null, originating_location: originatingLocation(cid) }; });
const headers = cols;
const body = entries.map((e) => cols.map((c) => c === 'CustomerID' ? e.customer_id : c === 'Points' ? e.points : c === 'MemberID' ? (e.member_id ?? '') : c === 'AR' ? (e.ar ?? '') : c === 'StoreCredit' ? (e.store_credit ?? '') : ''));
const wb = buildWorkbook(headers, body as (string|number)[][], ['CustomerID']);
const batchId = 'RB-' + todayStamp() + '-' + String(store.batches.length + 1).padStart(3, '0');
const filename = batchId + '-rewards.xlsx';
downloadWorkbook(wb, filename);
const batch: RewardBatch = { id: batchId, reporting_period: period, sales_import_id: sel[0]?.sales_import_id, created_at: new Date().toISOString(),
filename, entries, settings: { reward_pct: store.settings.reward_pct, points_per_dollar: store.settings.points_per_dollar, rounding: store.settings.rounding, optional_columns: cols.slice(2), optional_defaults: {} },
status: 'Exported', total_net_sales: tNet, total_reward_value: tVal, total_points: tPts, columns: cols, applied_to_balances: false };
setStore((st) => ({ ...st, batches: [batch, ...st.batches] }));
setMsg('Exported ' + filename + ' with ' + entries.length + ' customers (' + tPts + ' pts). Status: Exported / Pending POS Import — confirm on History page after Amber POS import.');
}
// PART4
return (<div className="space-y-4"><h1 className="text-2xl font-bold">Referral Sales</h1>
<Card title="Import sales summary from Amber POS">
<div className="grid gap-2 md:grid-cols-4">
<div><label className="text-xs">Reporting period (you control this)</label><input className={input} value={period} onChange={(e)=>setPeriod(e.target.value)} placeholder="2026-10 or 2026-Q3"/></div>
<div className="md:col-span-3"><label className="text-xs">Sales file (.xlsx/.csv)</label><input type="file" accept=".xlsx,.xls,.csv" onChange={(e)=>{const f=e.target.files?.[0]; if(f) void onFile(f);}} className="block text-sm"/>{parsing&&<span className="text-sm">Parsing…</span>}</div>
</div>
<div className="mt-2 grid gap-2 text-xs md:grid-cols-4">
<label>Phone field<input className={input} value={fieldMap.phone} onChange={(e)=>setFieldMap({...fieldMap,phone:e.target.value})}/></label>
<label>Net sales field<input className={input} value={fieldMap.net} onChange={(e)=>setFieldMap({...fieldMap,net:e.target.value})}/></label>
<label>Transactions field<input className={input} value={fieldMap.txn} onChange={(e)=>setFieldMap({...fieldMap,txn:e.target.value})}/></label>
<label>Store field<input className={input} value={fieldMap.store} onChange={(e)=>setFieldMap({...fieldMap,store:e.target.value})}/></label>
</div>
<p className="mt-1 text-xs text-stone-500">Auto-mapped: group2 → phone, Subtotal → net sales, TotalTransactions → count, StoreName → store. Summary rows ignored. Review/correct mappings before import.</p>
{preview&&parsedSales&&showPreview&&(<div className="mt-2 rounded border p-2 text-sm">
<div className="font-semibold">{preview.filename}: {parsedSales.data.length} data rows, {parsedSales.skipped.length} skipped</div>
{dupeWarn?.sameFile&&<div className="text-amber-700">Warning: this filename was already imported ({new Date(dupeWarn.sameFile.imported_at).toLocaleString()}).</div>}
{!!dupeWarn?.samePeriod.length&&<div className="text-amber-700">Warning: period {period} already has {dupeWarn.samePeriod.length} import(s). Re-importing replaces that period view.</div>}
<div className="max-h-40 overflow-auto text-xs">{parsedSales.skipped.slice(0,10).map((s,i)=><div key={i}>{s}</div>)}</div>
<div className="mt-2 flex gap-2"><button className={btn} onClick={commitSalesImport}>Confirm & import for {period}</button><button className={btnGhost} onClick={()=>{setPreview(null); setShowPreview(false);}}>Discard</button></div>
</div>)}
{msg&&<div className="mt-2 rounded bg-emerald-50 p-2 text-sm text-emerald-900">{msg}</div>}
</Card>
<Card title={'Reward calculator ('+rows.length+' referrers) — selected '+cad(tNet)+' · '+cad(tVal)+' · '+tPts+' pts'} right={<div className="flex gap-2"><button className={btnGhost} onClick={()=>toggleAll(true)}>Select all eligible</button><button className={btnGhost} onClick={()=>toggleAll(false)}>Clear</button><button className={btn} onClick={doExport}>Export Rewards (.xlsx)</button></div>}>
{!!warnDup.length&&<div className="mb-2 rounded bg-amber-50 p-2 text-sm">Duplicate-period warning: selected customers already in pending batch(es) {warnDup.join(', ')}. Review before exporting — legitimate future-period rewards are allowed.</div>}
<div className="overflow-x-auto"><table className="w-full border-collapse text-sm"><thead><tr><th className="thx">✓</th><th className="thx">Phone</th><th className="thx">Referrer / Customer ID / Origin</th><th className="thx">Net</th><th className="thx">% / $ / ppd / pts</th><th className="thx">Status</th></tr></thead><tbody>
{rows.map((r)=>(<tr key={r.id}><td className="tdx"><input type="checkbox" checked={r.included} onChange={()=>toggle(r.id)}/></td>
<td className="tdx font-mono">{r.referral_phone_raw}</td>
<td className="tdx"><div className="font-medium">{r.matched_customer_name ?? '— unmatched —'}</div><div className="font-mono text-xs">{r.selected_customer_id||r.matched_customer_id||''} · {originatingLocation(r.selected_customer_id||r.matched_customer_id||'')}</div>
{r.match_status==='ambiguous'&&<div className="mt-1 rounded bg-amber-50 p-1 text-xs">Shared phone — select account:{(r.candidates??[]).map((c)=>(<label key={c.customer_id} className="block"><input type="radio" name={r.id} checked={(r.selected_customer_id||'')===c.customer_id} onChange={()=>resolve(r.id,c.customer_id)}/> {customerDisplayName(c)} · {c.customer_id} · {originatingLocation(c.customer_id)}</label>))}</div>}
{r.match_status==='unmatched'&&<div className="text-xs text-red-700">Unmatched — investigate manually</div>}
<div className="text-xs text-stone-500">Referred count: {r.referred_count_label}</div></td>
<td className="tdx">{cad(r.net_sales)}</td>
<td className="tdx"><div className="flex flex-wrap gap-1">
<input className={input} style={{width:64}} type="number" value={r.custom_reward_pct ?? r.reward_pct} onChange={(e)=>recalc(r.id,{custom_reward_pct:Number(e.target.value)})} title="Reward % override"/>
<input className={input} style={{width:64}} type="number" value={r.custom_points_per_dollar ?? r.points_per_dollar} onChange={(e)=>recalc(r.id,{custom_points_per_dollar:Number(e.target.value)})} title="Points/$ override"/>
</div><div className="text-xs">{cad(r.reward_value)} · {r.points} pts</div></td>
<td className="tdx text-xs">{r.match_status} / {r.reward_status}</td></tr>))}</tbody></table></div>
</Card>
<Card title="Sales import history">{!store.salesImports.length&&<p className="text-sm text-stone-500">No sales imports yet.</p>}{store.salesImports.slice(0,20).map((h)=>(<div key={h.id} className="flex flex-wrap justify-between gap-2 border-b py-1.5 text-sm"><span>{h.filename} · period {h.reporting_period} · {new Date(h.imported_at).toLocaleString()}</span><span className="text-stone-600">{h.records_processed} rows → {h.added} referrers, {h.skipped} skipped</span></div>))}</Card>
</div>);}
