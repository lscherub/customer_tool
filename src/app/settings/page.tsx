'use client';
import { useState } from 'react';
import { Card, btn, input, useStore } from '../store-context';
import { normalizeSalesFieldMap } from '@/lib/sales-import';
export default function SettingsPage() {
const { store, setStore } = useStore();
const [s, setS] = useState(store.settings);
const [mapMsg, setMapMsg] = useState<string|null>(null);
const [msg, setMsg] = useState<string|null>(null);
function toggleCol(c: string) { setS((p)=>({ ...p, optional_columns: p.optional_columns.includes(c) ? p.optional_columns.filter((x)=>x!==c) : [...p.optional_columns, c] })); }
function save() { setStore((st)=>({ ...st, settings: { ...s, updated_at: new Date().toISOString() } })); setMsg('Defaults saved. Past batches keep their own settings — nothing was recalculated.'); }
return (<div className="space-y-4"><h1 className="text-2xl font-bold">Settings</h1>
<Card title="Default reward rules (defaults only — never hardcoded)">
<div className="grid gap-3 md:grid-cols-3">
<label className="text-sm">Default reward %<input className={input} type="number" value={s.reward_pct} onChange={(e)=>setS({...s,reward_pct:Number(e.target.value)})}/></label>
<label className="text-sm">Default points per dollar<input className={input} type="number" value={s.points_per_dollar} onChange={(e)=>setS({...s,points_per_dollar:Number(e.target.value)})}/></label>
<label className="text-sm">Rounding<select className={input} value={s.rounding} onChange={(e)=>setS({...s,rounding:e.target.value as 'nearest'|'floor'|'ceil'})}><option value="nearest">Nearest whole point</option><option value="floor">Round down</option><option value="ceil">Round up</option></select></label>
</div>
<div className="mt-3 text-sm"><div className="font-medium">Optional POS export columns (default export is CustomerID + Points only)</div>
{['MemberID','AR','StoreCredit'].map((c)=>(<label key={c} className="mr-4"><input type="checkbox" checked={s.optional_columns.includes(c)} onChange={()=>toggleCol(c)}/> {c}</label>))}
<p className="mt-1 text-xs text-stone-500">When enabled, values pull from the customer record. Omit disabled columns entirely.</p></div>
<div className="mt-3"><button className={btn} onClick={save}>Save defaults</button>{msg&&<span className="ml-2 text-sm text-emerald-700">{msg}</span>}</div>
</Card>
<Card title="Referral sales column mappings (saved defaults)">
<p className="mb-2 text-sm text-stone-600">Saved mappings drive parsing, validation, preview, and import.</p>
<div className="grid gap-3 md:grid-cols-4">
<label className="text-sm">Phone field<input className={input} value={s.sales_field_map.phone} onChange={(e)=>setS({...s,sales_field_map:{...s.sales_field_map,phone:e.target.value}})}/></label>
<label className="text-sm">Net sales field<input className={input} value={s.sales_field_map.net} onChange={(e)=>setS({...s,sales_field_map:{...s.sales_field_map,net:e.target.value}})}/></label>
<label className="text-sm">Transactions field<input className={input} value={s.sales_field_map.txn} onChange={(e)=>setS({...s,sales_field_map:{...s.sales_field_map,txn:e.target.value}})}/></label>
<label className="text-sm">Store field<input className={input} value={s.sales_field_map.store} onChange={(e)=>setS({...s,sales_field_map:{...s.sales_field_map,store:e.target.value}})}/></label>
</div>
<div className="mt-3"><button className={btn} onClick={()=>{const m=normalizeSalesFieldMap(s.sales_field_map); setStore((st)=>({...st,settings:{...s,sales_field_map:m,updated_at:new Date().toISOString()}})); setMapMsg("saved");}}>Save Mappings</button>{mapMsg&&<span className="ml-2 text-sm text-emerald-700">Mappings saved.</span>}</div>
</Card>
<Card title="How points sync safely">
<ol className="list-decimal pl-5 text-sm"><li>Import current customer balances from Amber POS.</li><li>Calculate rewards and export .xlsx (batch = Exported / Pending POS Import).</li><li>Manually import the file into Amber POS (POS adds points to existing balance: 20 + 10 = 30).</li><li>Click Confirm POS Import on the History page — only then are points added to the app balance with an audit record.</li><li>The same batch can never apply twice. A later customer export is authoritative and never double-adds confirmed rewards.</li></ol>
</Card></div>); }
