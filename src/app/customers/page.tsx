'use client';
import { useMemo, useState } from 'react';
import { Card, btn, btnGhost, input, useStore } from '../store-context';
import { parseWorkbookFile } from '@/lib/excel';
import { simpleHash } from '@/lib/utils';
import { customersEqual, rowToCustomer } from '@/lib/customer-import';
import { customerDisplayName, originatingLocation, type Customer, type ImportHistoryItem } from '@/lib/types';
export default function CustomersPage() {
const { store, setStore, cloud, cloudError, loaded } = useStore();
const [preview, setPreview] = useState<{ filename: string; rows: Record<string, unknown>[] } | null>(null);
const [parsing, setParsing] = useState(false);
const [committing, setCommitting] = useState(false);
const [result, setResult] = useState<string|null>(null);
const [q, setQ] = useState(''); const [fType, setFType] = useState(''); const [fLoc, setFLoc] = useState('');
const [sortKey, setSortKey] = useState('name'); const [sortDir, setSortDir] = useState<1|-1>(1);
const [page, setPage] = useState(0); const PAGE_SIZE = 50;
  const [histSel, setHistSel] = useState<string[]>([]);
  const [histConfirm, setHistConfirm] = useState(false);
  const [histMsg, setHistMsg] = useState<string|null>(null);
async function onFile(f: File) { setParsing(true); setResult(null);
try { const p = await parseWorkbookFile(f); setPreview({ filename: f.name, rows: p.rows }); }
catch(e){ setResult('Parse failed: '+(e instanceof Error?e.message:String(e))); } finally { setParsing(false); } }
const validation = useMemo(()=>{ if(!preview) return null;
const seen=new Set<string>(); let ok=0; const errs:string[]=[]; const dupes:string[]=[];
preview.rows.forEach((r,i)=>{ const v=rowToCustomer(r);
if(!v.customer){ errs.push('Row '+(i+1)+': '+v.error); return; }
if(seen.has(v.customer.customer_id)){ dupes.push(v.customer.customer_id); return; }
seen.add(v.customer.customer_id); ok++; });
return { ok, errs: errs.slice(0,20), dupes: dupes.slice(0,20), total: preview.rows.length, errN: errs.length, dupeN: dupes.length }; },[preview]);
async function commitImport(){ if(!preview) return; setCommitting(true);
try{ const nextById=new Map<string,Customer>(store.customers.map((c)=>[c.customer_id,c]));
let added=0,updated=0,unchanged=0,skipped=0,failed=0; const errors:string[]=[]; const seen=new Set<string>();
for(let s=0;s<preview.rows.length;s+=2000){
for(const r of preview.rows.slice(s,s+2000)){ const v=rowToCustomer(r);
if(!v.customer){ failed++; if(errors.length<100) errors.push(v.error??'Invalid row'); continue; }
if(seen.has(v.customer.customer_id)){ skipped++; continue; } seen.add(v.customer.customer_id);
const prev=nextById.get(v.customer.customer_id);
if(!prev){ nextById.set(v.customer.customer_id,v.customer); added++; }
else if(customersEqual(prev,v.customer)) unchanged++; else { nextById.set(v.customer.customer_id,v.customer); updated++; } }
await new Promise((res)=>setTimeout(res,0)); }
const rec:ImportHistoryItem={ id:'cimp-'+Date.now(), kind:'customers', filename:preview.filename, imported_at:new Date().toISOString(), records_processed:preview.rows.length, added, updated, unchanged, skipped, failed, errors, file_hash:simpleHash(preview.filename+preview.rows.length) };
setStore((st)=>({ ...st, customers:Array.from(nextById.values()), customerImports:[rec,...st.customerImports] }));
setResult('Imported '+preview.rows.length+': +'+added+' added, ~'+updated+' updated, ='+unchanged+' unchanged, '+skipped+' dupes, '+failed+' failed. Missing customers NOT deleted.');
setPreview(null); } finally { setCommitting(false); } }
const filtered = useMemo(()=>{ const needle=q.trim().toLowerCase(); let arr=store.customers;
if(needle) arr=arr.filter((c)=>[c.customer_id,c.company,c.first_name,c.last_name,c.email,c.phone1,c.phone2,c.cell_phone,c.referral,c.member_id].filter(Boolean).join(' ').toLowerCase().includes(needle));
if(fType) arr=arr.filter((c)=>(c.customer_type||'')===fType);
if(fLoc) arr=arr.filter((c)=>originatingLocation(c.customer_id)===fLoc);
const d=sortDir; return [...arr].sort((a,b)=> sortKey==='points' ? (a.points-b.points)*d : sortKey==='customer_id' ? a.customer_id.localeCompare(b.customer_id)*d : customerDisplayName(a).localeCompare(customerDisplayName(b))*d); },[store.customers,q,fType,fLoc,sortKey,sortDir]);
const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
const pageRows=filtered.slice(page*PAGE_SIZE,page*PAGE_SIZE+PAGE_SIZE);
const types=useMemo(()=>Array.from(new Set(store.customers.map((c)=>c.customer_type||'').filter(Boolean))).slice(0,50),[store.customers]);
const last=store.customerImports[0];
return (<div className="space-y-4"><h1 className="text-2xl font-bold">All Customers</h1>
{!loaded&&<div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Loading shared database…</div>}
{loaded&&cloud!=='shared'&&<div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{cloudError ?? 'Shared database unavailable — showing offline cache.'} Imports made now stay on this device until you sign in.</div>}
{loaded&&cloud==='shared'&&!store.customers.length&&<div className="rounded-lg bg-stone-100 p-3 text-sm text-stone-600">Shared database is empty — import a customer export to populate it for all devices.</div>}
<Card title="Import customer export from Amber POS" right={last?<span className="text-xs text-stone-500">Last: {last.filename}</span>:undefined}>
<p className="mb-2 text-sm text-stone-600">Blank first column + blank second row removed automatically. Header-name detection. Customer ID kept as text.</p>
<div className="flex items-center gap-2"><input type="file" accept=".xlsx,.xls,.csv" onChange={(e)=>{const f=e.target.files?.[0]; if(f) void onFile(f);}} className="text-sm"/>{parsing&&<span className="text-sm">Parsing…</span>}</div>
{preview&&validation&&(<div className="mt-3 rounded-lg border p-3 text-sm"><div className="font-semibold">{preview.filename} — {validation.total} rows</div>
<div>Valid {validation.ok} · Missing ID {validation.errN} · Dupes {validation.dupeN}</div>
<div className="mt-2 flex gap-2"><button className={btn} disabled={committing} onClick={commitImport}>{committing?'Importing…':'Confirm & import'}</button><button className={btnGhost} onClick={()=>setPreview(null)}>Discard</button></div></div>)}
{result&&<div className="mt-2 rounded bg-emerald-50 p-2 text-sm text-emerald-900">{result}</div>}
</Card>
<Card title={'Customers ('+filtered.length+')'}>
<div className="mb-2 grid gap-2 md:grid-cols-4">
<input className={input} placeholder="Search name, ID, phone, email…" value={q} onChange={(e)=>{setQ(e.target.value); setPage(0);}}/>
<select className={input} value={fType} onChange={(e)=>{setFType(e.target.value); setPage(0);}}><option value="">All types</option>{types.map((t)=><option key={t} value={t}>{t}</option>)}</select>
<select className={input} value={fLoc} onChange={(e)=>{setFLoc(e.target.value); setPage(0);}}><option value="">All origins</option>{['Head Office','Davie','West Broadway','Main Street','Online Webstore','Unknown'].map((l)=><option key={l} value={l}>{l}</option>)}</select>
<select className={input} value={sortKey+':'+sortDir} onChange={(e)=>{const[k,d]=e.target.value.split(':'); setSortKey(k); setSortDir(Number(d) as 1|-1);}}><option value="name:1">Name A-Z</option><option value="name:-1">Name Z-A</option><option value="customer_id:1">ID up</option><option value="customer_id:-1">ID down</option><option value="points:-1">Points down</option><option value="points:1">Points up</option></select>
</div>
<div className="overflow-x-auto"><table className="w-full border-collapse"><thead><tr><th className="thx">Name</th><th className="thx">Customer ID</th><th className="thx">Phones</th><th className="thx">Points</th><th className="thx">Referral</th><th className="thx">Type</th><th className="thx">Origin*</th></tr></thead>
<tbody>{pageRows.map((c)=>(<tr key={c.customer_id}><td className="tdx">{customerDisplayName(c)}<div className="text-xs text-stone-500">{c.email}</div></td><td className="tdx font-mono">{c.customer_id}</td><td className="tdx text-xs">{[c.phone1,c.phone2,c.cell_phone].filter(Boolean).join(' · ')}</td><td className="tdx">{c.points}</td><td className="tdx text-xs">{c.referral}</td><td className="tdx text-xs">{c.customer_type}</td><td className="tdx text-xs">{originatingLocation(c.customer_id)}</td></tr>))}</tbody></table></div>
<div className="mt-2 flex items-center justify-between text-sm"><span>Page {page+1} / {pages}</span><div className="flex gap-2"><button className={btnGhost} disabled={page===0} onClick={()=>setPage((p)=>Math.max(0,p-1))}>Prev</button><button className={btnGhost} disabled={page+1>=pages} onClick={()=>setPage((p)=>p+1)}>Next</button></div></div>
</Card>
<Card title="Customer import history">
      {!store.customerImports.length&&<p className="text-sm text-stone-500">No imports yet.</p>}
      {store.customerImports.length>0&&(<div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1"><input type="checkbox" checked={histSel.length>0&&histSel.length===Math.min(20,store.customerImports.length)} onChange={(e)=>setHistSel(e.target.checked?store.customerImports.slice(0,20).map((h)=>h.id):[])} /> Select all (page)</label>
        <span>{histSel.length} selected</span>
        <button className={btnGhost} disabled={!histSel.length} onClick={()=>setHistConfirm(true)}>Delete Selected</button>
        {histMsg&&<span className="text-emerald-700">{histMsg}</span>}
      </div>)}
      {store.customerImports.slice(0,20).map((h)=>(<div key={h.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={histSel.includes(h.id)} onChange={(e)=>setHistSel(e.target.checked?[...histSel,h.id]:histSel.filter((x)=>x!==h.id))} /><span>{h.filename} · {new Date(h.imported_at).toLocaleString()}</span></label><span className="text-stone-600">proc {h.records_processed} · +{h.added} ~{h.updated} ={h.unchanged} skip {h.skipped} fail {h.failed}</span></div>))}
      {histConfirm&&(<div className="mt-2 rounded border border-red-300 bg-red-50 p-3 text-sm">
        <div className="font-semibold">Confirm deletion of {histSel.length} customer import-history record(s)?</div>
        <ul className="mt-1 list-disc pl-5 text-xs">{histSel.map((id)=>{const h=store.customerImports.find((x)=>x.id===id); return h?(<li key={id}>{h.filename} · {new Date(h.imported_at).toLocaleString()} · +{h.added} ~{h.updated}</li>):null;})}</ul>
        <p className="mt-1 text-xs">History entries only — customer records, reward batches, and point adjustments are never deleted. Customer imports are not referenced by reward batches, so unreferenced entries can be removed safely.</p>
        <div className="mt-2 flex gap-2"><button className={btnGhost} onClick={()=>setHistConfirm(false)}>Cancel</button><button className={btn} onClick={()=>{setStore((st)=>({...st,customerImports:st.customerImports.filter((h)=>!histSel.includes(h.id))})); setHistMsg('Deleted '+histSel.length+' customer import-history entr'+(histSel.length===1?'y':'ies')+'. Customer records preserved.'); setHistSel([]); setHistConfirm(false);}}>Confirm Delete</button></div>
      </div>)}
      </Card>
</div>);
}
