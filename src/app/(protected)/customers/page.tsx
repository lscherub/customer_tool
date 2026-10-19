'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, btn, btnDanger, btnGhost, input, useStore } from '../store-context';
import { parseWorkbookFile } from '@/lib/excel';
import { simpleHash } from '@/lib/utils';
import { customersEqual, rowToCustomer } from '@/lib/customer-import';
import { archiveAllCustomers, CLEAR_CONFIRM_PHRASE, clearCustomerDatabase, deleteCustomersByIds, fetchIsAdmin, restoreCustomer, type AdminOpResult } from '@/lib/admin';
import { customerDisplayName, originatingLocation, type Customer, type ImportHistoryItem } from '@/lib/types';
/** Column configuration for the customers table. Each column's data type decides
 *  which Excel-like sort options its header offers: text columns A↔Z, numeric
 *  columns smallest↔largest, dates oldest↔newest. Customer IDs and phones are
 *  TEXT so leading zeros and formatting are preserved. Sorting only reorders an
 *  in-memory copy of the rows — customer data in the database is never changed. */
type SortColType = 'text' | 'number' | 'date';
type SortColumn = { key: string; label: string; type: SortColType; value: (c: Customer) => string | number | null | undefined };

const COLUMNS: SortColumn[] = [
  { key: 'name', label: 'Name', type: 'text', value: (c) => customerDisplayName(c) },
  { key: 'customer_id', label: 'Customer ID', type: 'text', value: (c) => c.customer_id },
  { key: 'phones', label: 'Phones', type: 'text', value: (c) => [c.phone1, c.phone2, c.cell_phone].filter(Boolean).join(' · ') },
  { key: 'points', label: 'Points', type: 'number', value: (c) => c.points },
  { key: 'referral', label: 'Referral', type: 'text', value: (c) => c.referral ?? '' },
  { key: 'customer_type', label: 'Type', type: 'text', value: (c) => c.customer_type ?? '' },
  { key: 'origin', label: 'Origin*', type: 'text', value: (c) => originatingLocation(c.customer_id) },
];

const isBlankSortValue = (v: unknown): boolean => v === null || v === undefined || v === '';

/** Pure comparator: numbers sort numerically, dates chronologically, everything
 *  else alphabetically as text. Blanks stay last in both directions (Excel-like). */
function compareSortValues(a: unknown, b: unknown, type: SortColType, dir: 1 | -1): number {
  const aBlank = isBlankSortValue(a); const bBlank = isBlankSortValue(b);
  if (aBlank || bBlank) return aBlank === bBlank ? 0 : aBlank ? 1 : -1;
  if (type === 'number') return ((Number(a) || 0) - (Number(b) || 0)) * dir;
  if (type === 'date') {
    const ta = Date.parse(String(a)); const tb = Date.parse(String(b));
    if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.isNaN(ta) === Number.isNaN(tb) ? 0 : Number.isNaN(ta) ? 1 : -1;
    return (ta - tb) * dir;
  }
  return String(a).localeCompare(String(b)) * dir;
}

/** Checkbox with an indeterminate state — one per row plus the Select All header. */
function RowCheckbox({ checked, indeterminate = false, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: (checked: boolean) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} title={label} className="h-4 w-4 cursor-pointer accent-emerald-700" />;
}

/** Excel-like sort dropdown in a column header (A↔Z / smallest↔largest / dates). */
function SortHeader({ col, active, dir, open, onOpenChange, onSort, alignRight }: {
  col: SortColumn; active: boolean; dir: 1 | -1; open: boolean;
  onOpenChange: (key: string | null) => void;
  onSort: (key: string, dir: 1 | -1) => void;
  alignRight?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(null); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onOpenChange]);
  const options: { dir: 1 | -1; label: string }[] = col.type === 'number'
    ? [{ dir: 1, label: 'Sort Smallest to Largest' }, { dir: -1, label: 'Sort Largest to Smallest' }]
    : col.type === 'date'
      ? [{ dir: 1, label: 'Sort Oldest to Newest' }, { dir: -1, label: 'Sort Newest to Oldest' }]
      : [{ dir: 1, label: 'Sort A to Z' }, { dir: -1, label: 'Sort Z to A' }];
  return (
    <th className="thx" scope="col">
      <div ref={ref} className="relative">
        <button type="button" aria-haspopup="menu" aria-expanded={open} title={'Sort by ' + col.label} onClick={() => onOpenChange(open ? null : col.key)} className="flex w-full items-center gap-1 hover:text-stone-900">
          <span>{col.label}</span>
          <span aria-hidden className={'text-[9px] ' + (active ? 'text-emerald-700' : 'text-stone-400')}>{active ? (dir === 1 ? '▲' : '▼') : '▾'}</span>
        </button>
        {open && (
          <div className={'absolute top-full z-30 mt-1 w-56 rounded-md border border-stone-300 bg-white py-1 text-xs font-normal normal-case tracking-normal text-stone-700 shadow-lg ' + (alignRight ? 'right-0' : 'left-0')}>
            {options.map((o) => (
              <button key={o.dir} type="button" onClick={() => { onSort(col.key, o.dir); onOpenChange(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-stone-100">
                <span aria-hidden className={'w-3 ' + (active && dir === o.dir ? 'text-emerald-700' : 'text-transparent')}>✓</span>
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </th>
  );
}
export default function CustomersPage() {
const { store, setStore, cloud, cloudError, loaded, refreshFromCloud } = useStore();
const [preview, setPreview] = useState<{ filename: string; rows: Record<string, unknown>[] } | null>(null);
const [parsing, setParsing] = useState(false);
const [committing, setCommitting] = useState(false);
const [result, setResult] = useState<string|null>(null);
const [q, setQ] = useState(''); const [fType, setFType] = useState(''); const [fLoc, setFLoc] = useState(''); const [fStatus, setFStatus] = useState('active');
const [sortKey, setSortKey] = useState('name'); const [sortDir, setSortDir] = useState<1|-1>(1);
const [sortMenu, setSortMenu] = useState<string|null>(null); // key of the open column-header sort dropdown
const [page, setPage] = useState(0); const PAGE_SIZE = 50;
  const [histSel, setHistSel] = useState<string[]>([]);
  const [histConfirm, setHistConfirm] = useState(false);
  const [histMsg, setHistMsg] = useState<string|null>(null);
  // Bulk row selection + deletion of customer records (this page only).
  const [sel, setSel] = useState<string[]>([]);
  const [delConfirm, setDelConfirm] = useState(false);
  const [delBusy, setDelBusy] = useState<null | 'checking' | 'deleting'>(null);
  const [delMsg, setDelMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Administrative destructive controls (admins only; server re-checks anyway).
  const [isAdmin, setIsAdmin] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearPhrase, setClearPhrase] = useState('');
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminResult, setAdminResult] = useState<AdminOpResult | null>(null);
  useEffect(() => {
    if (cloud !== 'shared') return;
    let live = true;
    void fetchIsAdmin().then((v) => { if (live) setIsAdmin(v); });
    return () => { live = false; };
  }, [cloud]);
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
else if(customersEqual(prev,v.customer)) unchanged++; else { nextById.set(v.customer.customer_id,{...v.customer,active:prev.active,deactivated_at:prev.deactivated_at}); updated++; } }
await new Promise((res)=>setTimeout(res,0)); }
const rec:ImportHistoryItem={ id:'cimp-'+Date.now(), kind:'customers', filename:preview.filename, imported_at:new Date().toISOString(), records_processed:preview.rows.length, added, updated, unchanged, skipped, failed, errors, file_hash:simpleHash(preview.filename+preview.rows.length) };
setStore((st)=>({ ...st, customers:Array.from(nextById.values()), customerImports:[rec,...st.customerImports] }));
setResult('Imported '+preview.rows.length+': +'+added+' added, ~'+updated+' updated, ='+unchanged+' unchanged, '+skipped+' dupes, '+failed+' failed. Missing customers NOT deleted.');
setPreview(null); } finally { setCommitting(false); } }
/** Run an admin RPC and report the DATABASE's answer verbatim — success is
 *  only ever claimed when the operation actually succeeded. */
async function runAdminOp(op: () => Promise<AdminOpResult>) {
  setAdminBusy(true); setAdminResult(null);
  const res = await op();
  setAdminResult(res);
  setAdminBusy(false);
  if (res.ok) { void refreshFromCloud(); setClearOpen(false); setClearPhrase(''); setArchiveConfirm(false); }
}
/** Bulk-delete the selected customers from the shared database.
 *  Deletion itself is enforced by the database (RLS: administrators only;
 *  foreign keys refuse to remove customers that history references — nothing is
 *  ever cascade-deleted). On success the table is refreshed and the selection
 *  cleared; on any refusal the exact reason is shown and the selection kept. */
async function runBulkDelete() {
  const ids = sel;
  if (!ids.length || delBusy) return;
  setDelMsg(null);
  if (cloud !== 'shared') {
    setDelMsg({ ok: false, text: 'Shared database unavailable — customer records cannot be deleted right now.' });
    setDelConfirm(false);
    return;
  }
  if (!isAdmin) {
    setDelMsg({ ok: false, text: 'Not authorized: administrator access is required to delete customer records — the database re-checks this on every delete. Ask an administrator, or archive the customers instead (keeps all history and is reversible per customer).' });
    setDelConfirm(false);
    return;
  }
  setDelBusy('checking');
  try {
    const res = await deleteCustomersByIds(ids, (p) => setDelBusy(p));
    setDelMsg({ ok: res.ok, text: res.message });
    if (res.ok) setSel([]); // successful deletion: selection cleared
    else if (res.deletedIds.length) {
      const deletedSet = new Set(res.deletedIds);
      setSel((s) => s.filter((id) => !deletedSet.has(id))); // keep only what is left
    }
    if (!res.blocked) { try { await refreshFromCloud(); } catch { /* the shared-database banner reports it */ } }
    setDelConfirm(false);
  } finally {
    setDelBusy(null);
  }
}
const filtered = useMemo(()=>{ const needle=q.trim().toLowerCase(); let arr=store.customers;
if(fStatus==='active') arr=arr.filter((c)=>c.active!==false); else if(fStatus==='archived') arr=arr.filter((c)=>c.active===false);
if(needle) arr=arr.filter((c)=>[c.customer_id,c.company,c.first_name,c.last_name,c.email,c.phone1,c.phone2,c.cell_phone,c.referral,c.member_id].filter(Boolean).join(' ').toLowerCase().includes(needle));
if(fType) arr=arr.filter((c)=>(c.customer_type||'')===fType);
if(fLoc) arr=arr.filter((c)=>originatingLocation(c.customer_id)===fLoc);
const col=COLUMNS.find((x)=>x.key===sortKey)??COLUMNS[0]; const d=sortDir;
return [...arr].sort((a,b)=>compareSortValues(col.value(a),col.value(b),col.type,d)); },[store.customers,q,fType,fLoc,fStatus,sortKey,sortDir]);
const selSet=useMemo(()=>new Set(sel),[sel]);
const filteredIdList=useMemo(()=>filtered.map((c)=>c.customer_id),[filtered]);
const filteredIdSet=useMemo(()=>new Set(filteredIdList),[filteredIdList]);
const allSelected=filteredIdList.length>0&&filteredIdList.every((id)=>selSet.has(id));
const someSelected=filteredIdList.some((id)=>selSet.has(id));
const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
const pageRows=filtered.slice(page*PAGE_SIZE,page*PAGE_SIZE+PAGE_SIZE);
const types=useMemo(()=>Array.from(new Set(store.customers.map((c)=>c.customer_type||'').filter(Boolean))).slice(0,50),[store.customers]);
const last=store.customerImports[0];
return (<div className="space-y-4"><h1 className="text-2xl font-bold">All Customers</h1>
{!loaded&&<div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Loading shared database…</div>}
{loaded&&cloud!=='shared'&&<div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{cloudError ?? 'Shared database unavailable.'} Imports cannot be saved until the connection is restored.</div>}
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
<select className={input} value={fStatus} onChange={(e)=>{setFStatus(e.target.value); setPage(0);}}><option value="active">Active customers</option><option value="archived">Archived customers</option><option value="all">All customers</option></select>
<select className={input} value={fType} onChange={(e)=>{setFType(e.target.value); setPage(0);}}><option value="">All types</option>{types.map((t)=><option key={t} value={t}>{t}</option>)}</select>
<select className={input} value={fLoc} onChange={(e)=>{setFLoc(e.target.value); setPage(0);}}><option value="">All origins</option>{['Head Office','Davie','West Broadway','Main Street','Online Webstore','Unknown'].map((l)=><option key={l} value={l}>{l}</option>)}</select>

</div>
<div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
  <span>{sel.length} selected</span>
  {sel.length>0&&<button className={btnGhost} disabled={!!delBusy} onClick={()=>{setSel([]); setDelConfirm(false);}}>Clear</button>}
  <button className={btnDanger} disabled={!sel.length||!!delBusy} onClick={()=>{setDelMsg(null); setDelConfirm(true);}}>Delete Selected</button>
</div>
{delMsg&&(<div className={'mb-2 rounded border p-2 text-sm '+(delMsg.ok?'border-emerald-300 bg-emerald-50 text-emerald-900':'border-red-300 bg-red-50 text-red-800')}>{delMsg.text}</div>)}
{delConfirm&&(<div className="mb-2 rounded border border-red-300 bg-red-50 p-3 text-sm">
  <div className="font-semibold text-red-900">Delete {sel.length} selected customer record(s)?</div>
  <p className="mt-1">This permanently removes {sel.length} customer record(s) from the shared database for all staff and devices.</p>
  <ul className="mt-1 list-disc pl-5 text-xs">
    <li>Reward history, sales imports, audit logs and point applications are never cascade-deleted.</li>
    <li>If any selected customer has linked records, nothing is deleted — the affected customers are listed instead.</li>
  </ul>
  <div className="mt-2 flex gap-2">
    <button className={btnGhost} disabled={!!delBusy} onClick={()=>setDelConfirm(false)}>Cancel</button>
    <button className={btnDanger} disabled={!sel.length||!!delBusy} onClick={()=>void runBulkDelete()}>{delBusy==='checking'?'Checking linked records…':delBusy==='deleting'?'Deleting…':'Confirm Delete ('+sel.length+')'}</button>
  </div>
</div>)}
<div className={sortMenu?'overflow-visible':'overflow-x-auto'}><table className="w-full border-collapse"><thead><tr>
<th className="thx"><RowCheckbox checked={allSelected} indeterminate={!allSelected&&someSelected} onChange={(on)=>{if(on){setSel((s)=>Array.from(new Set([...s,...filteredIdList])));}else{setSel((s)=>s.filter((id)=>!filteredIdSet.has(id)));}}} label="Select all customers (current view)"/></th>
{COLUMNS.map((col,i)=>(<SortHeader key={col.key} col={col} active={sortKey===col.key} dir={sortDir} open={sortMenu===col.key} onOpenChange={setSortMenu} onSort={(k,d)=>{setSortKey(k); setSortDir(d);}} alignRight={i===COLUMNS.length-1}/>))}
</tr></thead>
<tbody>{pageRows.map((c)=>(<tr key={c.customer_id} className={c.active===false?'opacity-70':''}><td className="tdx"><RowCheckbox checked={selSet.has(c.customer_id)} onChange={()=>setSel((s)=>s.includes(c.customer_id)?s.filter((x)=>x!==c.customer_id):[...s,c.customer_id])} label={'Select customer '+c.customer_id}/></td><td className="tdx">{customerDisplayName(c)}{c.active===false&&<span className="ml-1 rounded bg-stone-200 px-1 text-[10px] font-semibold uppercase text-stone-600">Archived</span>}<div className="text-xs text-stone-500">{c.email}</div>{c.active===false&&isAdmin&&<button className="mt-1 text-xs font-medium text-emerald-700 underline" onClick={()=>{void runAdminOp(()=>restoreCustomer(c.customer_id));}}>Restore</button>}</td><td className="tdx font-mono">{c.customer_id}</td><td className="tdx text-xs">{[c.phone1,c.phone2,c.cell_phone].filter(Boolean).join(' · ')}</td><td className="tdx">{c.points}</td><td className="tdx text-xs">{c.referral}</td><td className="tdx text-xs">{c.customer_type}</td><td className="tdx text-xs">{originatingLocation(c.customer_id)}</td></tr>))}</tbody></table></div>
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
{isAdmin&&(<Card title="Administration (administrators only)">
  <p className="text-sm text-stone-600">Destructive, shared-database operations. These affect customer records for <strong>all staff and devices</strong>. The database re-checks administrator rights on every call — hiding this panel is not the security boundary.</p>
  {adminResult&&(<div className={'mt-2 rounded border p-2 text-sm '+(adminResult.ok?'border-emerald-300 bg-emerald-50 text-emerald-900':adminResult.blocked?'border-amber-300 bg-amber-50 text-amber-900':'border-red-300 bg-red-50 text-red-800')}>
    <div className="font-semibold">{adminResult.ok?'Succeeded':adminResult.blocked?'Blocked by the database':'Failed'}</div>
    <div className="mt-1">{adminResult.message}</div>
    {adminResult.blocked&&adminResult.details&&(<ul className="mt-1 list-disc pl-5 text-xs">{Object.entries(adminResult.details).map(([k,v])=>(<li key={k}>{k}: {v}</li>))}</ul>)}
  </div>)}
  {!clearOpen&&!archiveConfirm&&(<div className="mt-2"><button className={btnDanger} disabled={adminBusy} onClick={()=>{setClearOpen(true); setAdminResult(null);}}>Clear Customer Database…</button></div>)}
  {clearOpen&&(<div className="mt-2 rounded border border-red-300 bg-red-50 p-3 text-sm">
    <div className="font-semibold text-red-900">Clear Customer Database — this deletes data for everyone</div>
    <p className="mt-1">Will be REMOVED from the shared database (all devices, all staff): every customer record (contact details, balances, notes).</p>
    <p className="mt-1">Will be RETAINED (never cascade-deleted): reward batches and entries, sales/customer import history, point adjustments, manual reward records, audit logs.</p>
    <p className="mt-1 text-xs">Because reward entries, point adjustments, manual reward records and referral matches reference Customer IDs, the database automatically <strong>blocks</strong> the hard delete while any such history exists and reports exactly what referenced customers. In that case use the safer Archive option instead — it keeps all history intact and is reversible per customer.</p>
    {!archiveConfirm&&(<label className="mt-2 block">Type <code className="rounded bg-red-100 px-1">{CLEAR_CONFIRM_PHRASE}</code> to enable deletion:
      <input className={input+' mt-1'} value={clearPhrase} onChange={(e)=>setClearPhrase(e.target.value)} placeholder={CLEAR_CONFIRM_PHRASE} autoComplete="off"/>
    </label>)}
    <div className="mt-2 flex flex-wrap gap-2">
      <button className={btnGhost} onClick={()=>{setClearOpen(false); setClearPhrase(''); setArchiveConfirm(false);}} disabled={adminBusy}>Cancel</button>
      {!archiveConfirm?(<>
        <button className={btnGhost} disabled={adminBusy} onClick={()=>setArchiveConfirm(true)}>Archive all customers (recommended)</button>
        <button className={btnDanger} disabled={adminBusy||clearPhrase!==CLEAR_CONFIRM_PHRASE} onClick={()=>void runAdminOp(()=>clearCustomerDatabase())}>{adminBusy?'Working…':'Delete all customers'}</button>
      </>):(<>
        <button className={btnDanger} disabled={adminBusy} onClick={()=>void runAdminOp(()=>archiveAllCustomers())}>{adminBusy?'Archiving…':'Confirm archive of ALL customers'}</button>
      </>)}
    </div>
    {archiveConfirm&&<p className="mt-1 text-xs">Archive marks every customer as inactive: they are hidden from search and referral matching but stay in the database with full history and can be restored individually.</p>}
  </div>)}
</Card>)}
</div>);
}
