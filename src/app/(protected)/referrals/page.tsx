'use client';
import { useMemo, useState } from 'react';
import { Card, btn, btnGhost, input, useStore } from '../store-context';
import { buildWorkbook, downloadWorkbook, parseWorkbookFile } from '@/lib/excel';
import { buildPhoneIndex } from '@/lib/store';
import { normalizeSalesFieldMap, rowsToSales, validateSalesFieldMap } from '@/lib/sales-import';
import { cad, calcReward, currentPeriod, todayStamp } from '@/lib/utils';
import { customerDisplayName, originatingLocation, type ImportHistoryItem, type ReferralAggregate, type RewardBatch, type RewardEntry, type SalesFieldMap } from '@/lib/types';
const ALL_COLS = ['CustomerID', 'Points', 'MemberID', 'AR', 'StoreCredit'];
const FIELD_LABELS: { key: keyof SalesFieldMap; label: string }[] = [
  { key: 'phone', label: 'Phone field' },
  { key: 'net', label: 'Net sales field' },
  { key: 'txn', label: 'Transactions field' },
  { key: 'store', label: 'Store field' },
];
export default function ReferralsPage() {
  const { store, setStore, commitAndSave, cloud, cloudError, loaded } = useStore();
  const [period, setPeriod] = useState(() => currentPeriod());
  const [preview, setPreview] = useState<{ filename: string; rows: Record<string, unknown>[]; headers: string[] } | null>(null);
  const [fieldMap, setFieldMap] = useState<SalesFieldMap>({ phone: 'group2', net: 'Subtotal', txn: 'TotalTransactions', store: 'StoreName' });
  const [mapInit, setMapInit] = useState(false);
  const [mapMsg, setMapMsg] = useState<string | null>(null);
  const [salesSel, setSalesSel] = useState<string[]>([]);
  const [salesConfirm, setSalesConfirm] = useState(false);
  const [salesMsg, setSalesMsg] = useState<string | null>(null);
  const [ovOpen, setOvOpen] = useState<string | null>(null);
  const [ovCid, setOvCid] = useState('');
  const [ovReason, setOvReason] = useState('');
  const [ovOperator, setOvOperator] = useState('');
  const [ovAck, setOvAck] = useState(false);
  const [ovAllowUnknown, setOvAllowUnknown] = useState(false);
  if (!mapInit && store.settings.sales_field_map) { setFieldMap({ ...store.settings.sales_field_map }); setMapInit(true); }
  const [parsing, setParsing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  // Clear/reset workflow state (current calculation only — never saved history).
  const [resetConfirm, setResetConfirm] = useState(false);
  const [exportedBatch, setExportedBatch] = useState<{ id: string; filename: string; customers: number; points: number; merged: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  async function onFile(f: File) { setParsing(true); setMsg(null);
    try { const p = await parseWorkbookFile(f); setPreview({ filename: f.name, rows: p.rows, headers: p.headers }); setShowPreview(true); } catch (e) { setMsg('Parse failed: ' + (e instanceof Error ? e.message : String(e))); } finally { setParsing(false); } }
  function saveMappings() {
    const norm = normalizeSalesFieldMap(fieldMap);
    setFieldMap({ ...norm });
    setStore((st) => ({ ...st, settings: { ...st.settings, sales_field_map: { ...norm }, updated_at: new Date().toISOString() } }));
    setMapMsg('Mappings saved: ' + norm.phone + ' \u2192 phone, ' + norm.net + ' \u2192 net sales, ' + norm.txn + ' \u2192 transactions, ' + norm.store + ' \u2192 store. New uploads use these defaults; preview refreshed.');
  }
  const parsedSales = useMemo(() => preview ? rowsToSales(preview.rows, fieldMap) : null, [preview, fieldMap]);
  const mapValidation = useMemo(() => preview ? validateSalesFieldMap(preview.headers, normalizeSalesFieldMap(fieldMap)) : null, [preview, fieldMap]);
  const dupeWarn = useMemo(() => {
    if (!preview) return null;
    const sameFile = store.salesImports.find((h) => h.filename === preview.filename);
    const samePeriod = store.salesImports.filter((h) => h.reporting_period === period);
    return { sameFile, samePeriod };
  }, [preview, period, store.salesImports]);
  /**
   * Clear the CURRENT working calculation only: preview, calculator rows,
   * selections, totals, temporary matches/overrides, warnings and unsaved
   * form values. Saved sales-import history, exported reward batches,
   * customer records and point balances are never touched — and the saved
   * duplicate-period records stay in place, so duplicate warnings still
   * fire on the next import.
   */
  function clearWorkingCalculation() {
    setStore((st) => ({ ...st, referrals: [] }));
    setPreview(null);
    setShowPreview(false);
    setPeriod(currentPeriod());
    setSalesSel([]);
    setSalesConfirm(false);
    setSalesMsg(null);
    setOvOpen(null); setOvCid(''); setOvReason(''); setOvOperator(''); setOvAck(false); setOvAllowUnknown(false);
    setFieldMap(store.settings.sales_field_map ? { ...store.settings.sales_field_map } : { phone: 'group2', net: 'Subtotal', txn: 'TotalTransactions', store: 'StoreName' });
    setMsg(null);
    setMapMsg(null);
    setResetConfirm(false);
    setExportedBatch(null);
    setExportError(null);
  }
  function commitSalesImport() {
    if (!preview || !parsedSales) return;
    if (mapValidation && !mapValidation.ok) {
      setMsg('Cannot import: mapped column(s) missing: ' + mapValidation.missing.map((m) => m.column + ' (' + m.key + ')').join(', ') + '. Correct the mapping and click Save Mappings.');
      return;
    }
    const { data, skipped } = parsedSales;
    const byPhone = new Map<string, { raw: string; net: number; txn: number; stores: Set<string> }>();
    for (const r of data) {
      const e = byPhone.get(r.phoneNorm) ?? { raw: r.phoneRaw, net: 0, txn: 0, stores: new Set<string>() };
      e.net += r.net; e.txn += r.transactions ?? 0; if (r.store) e.stores.add(r.store); byPhone.set(r.phoneNorm, e);
    }
    const idx = buildPhoneIndex(store.customers);
    const importId = 'simp-' + Date.now();
    let matched = 0, ambiguous = 0, unmatched = 0;
    const aggs: ReferralAggregate[] = [];
    for (const [norm, v] of byPhone) {
      const cands = idx.get(norm) ?? [];
      const prior = store.referrals.find((x) => x.referral_phone_normalized === norm);
      const priorOverride = prior?.override ?? null;
      const status: ReferralAggregate['match_status'] = cands.length === 1 ? 'matched' : cands.length > 1 ? 'ambiguous' : 'unmatched';
      if (status === 'matched') matched++; else if (status === 'ambiguous') ambiguous++; else unmatched++;
      const chosen = cands.length === 1 ? cands[0] : (prior?.selected_customer_id ? cands.find((c) => c.customer_id === prior.selected_customer_id) ?? null : null);
      const rw = calcReward(v.net, store.settings.reward_pct, store.settings.points_per_dollar, store.settings.rounding);
      const keepOverride = priorOverride && priorOverride.source_phone_raw === v.raw ? priorOverride : null;
      aggs.push({
        id: importId + '-' + norm, sales_import_id: importId, reporting_period: period, referral_phone_raw: v.raw, referral_phone_normalized: norm,
        matched_customer_id: chosen ? chosen.customer_id : (cands[0]?.customer_id ?? null),
        matched_customer_name: chosen ? customerDisplayName(chosen) : (cands[0] ? customerDisplayName(cands[0]) : null),
        match_status: status, candidates: cands,
        selected_customer_id: chosen ? chosen.customer_id : null, net_sales: Math.round(v.net * 100) / 100, transaction_count: v.txn || null,
        referred_count_label: 'unavailable', reward_pct: store.settings.reward_pct, reward_value: rw.rewardValue,
        points_per_dollar: store.settings.points_per_dollar, points: rw.points,
        reward_status: status === 'matched' ? 'eligible' : 'needs_review', store_names: Array.from(v.stores), included: status === 'matched',
        custom_reward_pct: null, custom_points_per_dollar: null, override: keepOverride,
      });
    }
    const mapUsed = normalizeSalesFieldMap(fieldMap);
    const rec: ImportHistoryItem = {
      id: importId, kind: 'sales', filename: preview.filename, imported_at: new Date().toISOString(),
      records_processed: data.length, added: aggs.length, updated: 0, unchanged: 0, skipped: skipped.length, failed: 0,
      errors: skipped.slice(0, 50), reporting_period: period,
      extra: { column_mapping: mapUsed, matched, ambiguous, unmatched },
    };
    setStore((st) => {
      const others = st.referrals.filter((r) => r.reporting_period !== period);
      return { ...st, referrals: [...aggs, ...others], salesImports: [rec, ...st.salesImports] };
    });
    setMsg('Imported ' + data.length + ' sales rows into ' + aggs.length + ' referrers for ' + period + ' (' + matched + ' matched, ' + ambiguous + ' ambiguous, ' + unmatched + ' unmatched). ' + skipped.length + ' rows skipped (summaries/blank).');
    setPreview(null); setShowPreview(false);
    setExportedBatch(null); setExportError(null);
  }
  const rows = store.referrals;
  function recalc(id: string, patch: Partial<ReferralAggregate>) {
    setStore((st) => ({
      ...st, referrals: st.referrals.map((r) => {
        if (r.id !== id) return r;
        const n = { ...r, ...patch };
        const pct = n.custom_reward_pct ?? n.reward_pct; const ppd = n.custom_points_per_dollar ?? n.points_per_dollar;
        const rw = calcReward(n.net_sales, pct, ppd, st.settings.rounding);
        return { ...n, reward_pct: patch.reward_pct ?? n.reward_pct, points_per_dollar: patch.points_per_dollar ?? n.points_per_dollar, reward_value: rw.rewardValue, points: rw.points };
      }),
    }));
  }
  function isExportable(r: ReferralAggregate): boolean {
    if (r.match_status === 'matched') return true;
    if (r.override && (r.selected_customer_id || r.matched_customer_id)) return true;
    return false;
  }
  function toggle(id: string) {
    const r = rows.find((x) => x.id === id); if (!r) return;
    if (!r.included && !isExportable(r)) { setMsg('Resolve shared/unmatched phone before including (or approve a Manual Override).'); return; }
    recalc(id, { included: !r.included, reward_status: !r.included ? 'eligible' : r.reward_status });
  }
  function toggleAll(v: boolean) {
    setStore((st) => ({
      ...st, referrals: st.referrals.map((r) => {
        const ok = r.match_status === 'matched' || Boolean(r.override && (r.selected_customer_id || r.matched_customer_id));
        return ok ? { ...r, included: v } : r;
      }),
    }));
  }
  function resolve(id: string, cid: string) {
    const r = rows.find((x) => x.id === id); if (!r) return;
    const c = (r.candidates ?? []).find((x) => x.customer_id === cid) ?? store.customers.find((x) => x.customer_id === cid);
    setStore((st) => ({
      ...st, referrals: st.referrals.map((x) => x.id === id ? {
        ...x, selected_customer_id: cid, matched_customer_id: cid,
        matched_customer_name: c ? customerDisplayName(c) : x.matched_customer_name,
        match_status: 'matched' as const, reward_status: 'eligible' as const, included: true,
      } : x),
    }));
  }
  function openOverride(id: string) {
    const r = rows.find((x) => x.id === id); if (!r) return;
    setOvOpen(id);
    setOvCid(r.selected_customer_id || r.matched_customer_id || '');
    setOvReason(r.override?.reason || '');
    setOvOperator(r.override?.operator || '');
    setOvAck(false);
    setOvAllowUnknown(false);
  }
  function confirmOverride() {
    if (!ovOpen) return;
    const r = rows.find((x) => x.id === ovOpen); if (!r) return;
    const cid = ovCid.trim();
    if (!cid) { setMsg('Enter or select a Customer ID for the override.'); return; }
    if (!ovReason.trim()) { setMsg('Enter a reason for the override (audit trail).'); return; }
    if (!ovOperator.trim()) { setMsg('Enter the operator name for the override (audit trail).'); return; }
    if (!ovAck) { setMsg('Confirm you verified the recipient in Amber POS before overriding.'); return; }
    const cust = store.customers.find((c) => c.customer_id === cid);
    if (!cust && !ovAllowUnknown) {
      setMsg('No customer found for ID ' + cid + '. Tick the explicit unknown-recipient confirmation to proceed, or correct the ID.');
      return;
    }
    const verified = Boolean(cust);
    const status = verified ? 'Manual Override — Verified' as const : 'Manual Override — Unmatched Recipient' as const;
    const name = cust ? customerDisplayName(cust) : (r.matched_customer_name || '(unmatched recipient: ' + cid + ')');
    setStore((st) => ({
      ...st, referrals: st.referrals.map((x) => x.id === ovOpen ? {
        ...x, selected_customer_id: cid, matched_customer_id: cid, matched_customer_name: name,
        candidates: verified && !(x.candidates ?? []).some((c) => c.customer_id === cid) ? [...(x.candidates ?? []), cust as NonNullable<typeof cust>] : x.candidates,
        reward_status: 'eligible' as const, included: true,
        override: {
          customer_id: cid, verified, status, reason: ovReason.trim(), operator: ovOperator.trim(),
          at: new Date().toISOString(), allow_unknown_customer: !verified, source_phone_raw: x.referral_phone_raw,
        },
      } : x),
    }));
    setOvOpen(null);
    setMsg(verified ? 'Override approved for ' + cid + ' (Manual Override — Verified). Row is now exportable.' : 'Override approved for ' + cid + ' (Manual Override — Unmatched Recipient). Row is now exportable.');
  }
  function clearOverride(id: string) {
    const r = rows.find((x) => x.id === id); if (!r) return;
    const idx = buildPhoneIndex(store.customers);
    const cands = idx.get(r.referral_phone_normalized) ?? [];
    const auto: ReferralAggregate['match_status'] = cands.length === 1 ? 'matched' : cands.length > 1 ? 'ambiguous' : 'unmatched';
    const chosen = cands.length === 1 ? cands[0] : null;
    setStore((st) => ({
      ...st, referrals: st.referrals.map((x) => x.id === id ? {
        ...x, selected_customer_id: chosen ? chosen.customer_id : null,
        matched_customer_id: chosen ? chosen.customer_id : (cands[0]?.customer_id ?? null),
        matched_customer_name: chosen ? customerDisplayName(chosen) : (cands[0] ? customerDisplayName(cands[0]) : null),
        match_status: auto, reward_status: auto === 'matched' ? 'eligible' : 'needs_review',
        included: auto === 'matched', candidates: cands, override: null,
      } : x),
    }));
    setMsg('Manual override removed; automatic matching restored for ' + r.referral_phone_raw + '.');
  }
  const sel = rows.filter((r) => r.included && isExportable(r));
  const tNet = sel.reduce((a, r) => a + r.net_sales, 0); const tVal = sel.reduce((a, r) => a + r.reward_value, 0); const tPts = sel.reduce((a, r) => a + r.points, 0);
  const warnDup = useMemo(() => {
    const pend = store.batches.filter((b) => b.status === 'Exported' || b.status === 'Draft');
    const ids = new Set(sel.map((r) => (r.selected_customer_id || r.matched_customer_id) + '|' + r.reporting_period));
    return pend.filter((b) => b.entries.some((e) => ids.has(e.customer_id + '|' + b.reporting_period))).map((b) => b.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.batches, rows]);
  function mergeByCustomer(list: ReferralAggregate[]): RewardEntry[] {
    const byCid = new Map<string, RewardEntry>();
    for (const r of list) {
      const cid = r.selected_customer_id || r.matched_customer_id || '';
      if (!cid) continue;
      const cust = store.customers.find((c) => c.customer_id === cid);
      const row: RewardEntry = {
        customer_id: cid, customer_name: r.matched_customer_name || cust ? (r.matched_customer_name || (cust ? customerDisplayName(cust) : cid)) : cid,
        referral_phone: r.referral_phone_raw, referral_phones: [r.referral_phone_raw],
        net_sales: r.net_sales, reward_pct: r.custom_reward_pct ?? r.reward_pct, reward_value: r.reward_value,
        points_per_dollar: r.custom_points_per_dollar ?? r.points_per_dollar, points: r.points,
        member_id: cust?.member_id, ar: cust?.ar ?? null, store_credit: cust?.store_credit ?? null,
        originating_location: originatingLocation(cid),
        override_status: r.override?.status ?? null, override_reason: r.override?.reason ?? null,
        override_operator: r.override?.operator ?? null, override_at: r.override?.at ?? null,
        override_verified: r.override ? r.override.verified : null,
      };
      const prev = byCid.get(cid);
      if (!prev) { byCid.set(cid, row); continue; }
      prev.net_sales = Math.round((prev.net_sales + row.net_sales) * 100) / 100;
      prev.reward_value = Math.round((prev.reward_value + row.reward_value) * 100) / 100;
      prev.points += row.points;
      const phones = new Set([...(prev.referral_phones ?? [prev.referral_phone]), ...(row.referral_phones ?? [row.referral_phone])]);
      prev.referral_phones = Array.from(phones);
      prev.referral_phone = prev.referral_phones.join('; ');
      if (row.override_status && !prev.override_status) {
        prev.override_status = row.override_status; prev.override_reason = row.override_reason;
        prev.override_operator = row.override_operator; prev.override_at = row.override_at;
        prev.override_verified = row.override_verified;
      } else if (row.override_status && prev.override_status) {
        prev.override_reason = [prev.override_reason, row.override_reason].filter(Boolean).join(' | ');
      }
    }
    return Array.from(byCid.values());
  }
  async function doExport() {
    if (!sel.length) { setMsg('Select at least one matched or override-approved row.'); return; }
    const unresolved = sel.filter((r) => !(r.selected_customer_id || r.matched_customer_id));
    if (unresolved.length) { setMsg('Resolve every selected row to a Customer ID first.'); return; }
    setExportError(null);
    const cols = ['CustomerID', 'Points', ...store.settings.optional_columns.filter((c) => ALL_COLS.includes(c))];
    const entries = mergeByCustomer(sel);
    const headers = cols;
    const body = entries.map((e) => cols.map((c) => c === 'CustomerID' ? e.customer_id : c === 'Points' ? e.points : c === 'MemberID' ? (e.member_id ?? '') : c === 'AR' ? (e.ar ?? '') : c === 'StoreCredit' ? (e.store_credit ?? '') : ''));
    const wb = buildWorkbook(headers, body as (string | number)[][], ['CustomerID']);
    const batchId = 'RB-' + todayStamp() + '-' + String(store.batches.length + 1).padStart(3, '0');
    const filename = batchId + '-rewards.xlsx';
    // 1) Generate and download the correct Excel file.
    downloadWorkbook(wb, filename);
    const mergedCount = sel.length - entries.length;
    const batch: RewardBatch = {
      id: batchId, reporting_period: period, sales_import_id: sel[0]?.sales_import_id, created_at: new Date().toISOString(),
      filename, entries, settings: { reward_pct: store.settings.reward_pct, points_per_dollar: store.settings.points_per_dollar, rounding: store.settings.rounding, optional_columns: cols.slice(2), optional_defaults: {} },
      status: 'Exported', total_net_sales: tNet, total_reward_value: tVal, total_points: tPts, columns: cols, applied_to_balances: false,
      kind: 'referral', origin: 'Referral rewards',
    };
    // 2) Save the batch BEFORE treating the export as completed. If the save
    //    fails, the page keeps its current state and the user is warned —
    //    nothing is auto-cleared.
    try {
      await commitAndSave((st) => ({ ...st, batches: [batch, ...st.batches] }));
    } catch (e) {
      setExportError('The Excel file was downloaded, but batch ' + batchId + ' could NOT be saved to the shared database'
        + (e instanceof Error ? ' (' + e.message + ')' : '')
        + '. Do not import it into Amber POS — check the connection and export again.');
      return;
    }
    setMsg(null);
    setExportedBatch({ id: batchId, filename, customers: entries.length, points: tPts, merged: mergedCount });
  }
  function deleteSalesImports(ids: string[]) {
    if (!ids.length) return;
    setStore((st) => ({ ...st, salesImports: st.salesImports.filter((h) => !ids.includes(h.id)) }));
    setSalesSel([]);
    setSalesConfirm(false);
    setSalesMsg('Deleted ' + ids.length + ' sales import-history entr' + (ids.length === 1 ? 'y' : 'ies') + '. Customer records, referral rows, reward batches, and point adjustments were preserved.');
  }
  const salesRefInfo = (id: string) => {
    const batches = store.batches.filter((b) => b.sales_import_id === id);
    const referrals = store.referrals.filter((r) => r.sales_import_id === id);
    return { batches, referrals };
  };
  return (<div className="space-y-4"><h1 className="text-2xl font-bold">Referral Sales</h1>
    {!loaded && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Loading shared database…</div>}
    {loaded && cloud !== 'shared' && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{cloudError ?? 'Shared database unavailable.'} Changes cannot be saved until the connection is restored.</div>}
    {exportedBatch && (<div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm">
      <div className="font-semibold">Batch {exportedBatch.id} exported and saved — {exportedBatch.filename} ({exportedBatch.customers} customer(s), {exportedBatch.points} pts).{exportedBatch.merged > 0 ? ` ${exportedBatch.merged} referral row(s) merged by Customer ID.` : ''}</div>
      <div className="mt-1 text-xs">Status: Exported / Pending POS Import — confirm on the History page after importing into Amber POS.</div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className={btnGhost} onClick={() => { setExportedBatch(null); setMsg('Keep working with an already-exported calculation — duplicate warnings are active for overlapping rows. Use Clear All / Reset when finished.'); }}>Keep Working</button>
        <button className={btn} onClick={() => { setExportedBatch(null); clearWorkingCalculation(); }}>Clear Current Calculation</button>
      </div>
    </div>)}
    {exportError && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{exportError}</div>}
    {resetConfirm && (<div className="rounded border border-red-300 bg-red-50 p-3 text-sm">
      <div className="font-semibold">Clear the current working calculation?</div>
      <p className="mt-1">This clears the imported report preview, reward calculator rows and selections, totals, temporary customer matches/overrides, and messages on this page.</p>
      <p className="mt-1 text-xs">Saved history is NOT affected: sales-import history, exported reward batches, customer records, and point balances stay unchanged in the shared database. Duplicate-period warnings will still work on your next import.</p>
      <div className="mt-2 flex gap-2"><button className={btnGhost} onClick={() => setResetConfirm(false)}>Cancel</button><button className={btn} onClick={clearWorkingCalculation}>Clear Current Calculation</button></div>
    </div>)}
    <Card title="Import sales summary from Amber POS">
      <div className="grid gap-2 md:grid-cols-4">
        <div><label className="text-xs">Reporting period (you control this)</label><input className={input} value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-10 or 2026-Q3" /></div>
        <div className="md:col-span-3"><label className="text-xs">Sales file (.xlsx/.csv)</label><input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} className="block text-sm" />{parsing && <span className="text-sm">Parsing…</span>}</div>
      </div>
      <div className="mt-2 grid gap-2 text-xs md:grid-cols-4">
        {FIELD_LABELS.map((f) => (
          <label key={f.key}>{f.label}<input className={input} value={fieldMap[f.key]} onChange={(e) => { setFieldMap({ ...fieldMap, [f.key]: e.target.value }); setMapMsg(null); }} /></label>
        ))}
      </div>
      <p className="mt-1 text-xs text-stone-500">Auto-mapped: {fieldMap.phone} → phone, {fieldMap.net} → net sales, {fieldMap.txn} → transactions, {fieldMap.store} → store. Summary rows ignored. Review/correct mappings, then click Save Mappings — the saved mapping drives parsing, validation, preview, and import.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className={btn} onClick={saveMappings}>Save Mappings</button>
        {mapMsg && <span className="text-xs text-emerald-700">{mapMsg}</span>}
      </div>
      {preview && parsedSales && showPreview && mapValidation && (<div className="mt-2 rounded border p-2 text-sm">
        <div className="font-semibold">{preview.filename}: {parsedSales.data.length} data rows, {parsedSales.skipped.length} skipped</div>
        {!mapValidation.ok && (<div className="mt-1 rounded bg-red-50 p-2 text-xs text-red-800">Mapped column missing: {mapValidation.missing.map((m) => m.column + ' (' + m.key + ')').join(', ')}. Available columns: {preview.headers.join(', ') || '(none)'}. Correct the field above and click Save Mappings.</div>)}
        {dupeWarn?.sameFile && <div className="text-amber-700">Warning: this filename was already imported ({new Date(dupeWarn.sameFile.imported_at).toLocaleString()}).</div>}
        {!!dupeWarn?.samePeriod.length && <div className="text-amber-700">Warning: period {period} already has {dupeWarn.samePeriod.length} import(s). Re-importing replaces that period view.</div>}
        <div className="max-h-40 overflow-auto text-xs">{parsedSales.skipped.slice(0, 10).map((s, i) => <div key={i}>{s}</div>)}</div>
        <div className="mt-2 flex gap-2"><button className={btn} disabled={!mapValidation.ok} onClick={commitSalesImport}>Confirm &amp; import for {period}</button><button className={btnGhost} onClick={() => { setPreview(null); setShowPreview(false); }}>Discard</button></div>
      </div>)}
      {msg && <div className="mt-2 rounded bg-emerald-50 p-2 text-sm text-emerald-900">{msg}</div>}
    </Card>
    <Card title={'Reward calculator (' + rows.length + ' referrers) — selected ' + cad(tNet) + ' · ' + cad(tVal) + ' · ' + tPts + ' pts'} right={<div className="flex flex-wrap gap-2"><button className={btnGhost} onClick={() => toggleAll(true)}>Select all eligible</button><button className={btnGhost} onClick={() => toggleAll(false)}>Clear</button><button className={btn} onClick={() => void doExport()}>Export Rewards (.xlsx)</button><button className={btnGhost} onClick={() => setResetConfirm(true)}>Clear All / Reset Current Calculation</button></div>}>
      <p className="mb-2 text-xs text-stone-600">Reward Value = Net Sales × Reward Rate. Points to Award = Reward Value × Points per $1.</p>
      {!rows.length && !preview && <p className="rounded border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">No sales report loaded. Import a sales report above to begin a new calculation.</p>}
      {!!warnDup.length && <div className="mb-2 rounded bg-amber-50 p-2 text-sm">Duplicate-period warning: {warnDup.join(', ')}.</div>}
      <div className="overflow-x-auto"><table className="w-full border-collapse text-sm"><thead><tr><th className="thx">Sel</th><th className="thx">Phone</th><th className="thx">Referrer</th><th className="thx">Net Sales</th><th className="thx">Reward Rate (%)</th><th className="thx">Reward Value ($)</th><th className="thx">Points per $1</th><th className="thx">Points to Award</th><th className="thx">Status</th></tr></thead><tbody>
        {rows.map((r) => {
          const pctNow = r.custom_reward_pct ?? r.reward_pct;
          const ppdNow = r.custom_points_per_dollar ?? r.points_per_dollar;
          return (<tr key={r.id}><td className="tdx"><input type="checkbox" checked={r.included} onChange={() => toggle(r.id)} /></td>
            <td className="tdx font-mono">{r.referral_phone_raw}</td>
            <td className="tdx"><div className="font-medium">{r.matched_customer_name ?? 'unmatched'}</div>
              <div className="font-mono text-xs">{r.selected_customer_id || r.matched_customer_id || ''}</div>
              {r.override && <div className="mt-1 text-xs font-semibold text-violet-900">{r.override.status}</div>}
              {r.match_status === 'ambiguous' && <div className="mt-1 rounded bg-amber-50 p-1 text-xs">Shared phone — select account:{(r.candidates ?? []).map((c) => (<label key={c.customer_id} className="block"><input type="radio" name={r.id} checked={(r.selected_customer_id || '') === c.customer_id} onChange={() => resolve(r.id, c.customer_id)} /> {customerDisplayName(c)} · {c.customer_id} · {originatingLocation(c.customer_id)}</label>))}</div>}
              {r.match_status === 'unmatched' && !r.override && <div className="text-xs text-red-700">Unmatched — investigate manually</div>}
              {(r.match_status !== 'matched') && (<div className="mt-1 flex gap-1">
                {!r.override && <button className={btnGhost} onClick={() => openOverride(r.id)}>Allow Export Override</button>}
                {r.override && <button className={btnGhost} onClick={() => openOverride(r.id)}>Edit Override</button>}
                {r.override && <button className={btnGhost} onClick={() => clearOverride(r.id)}>Remove Override</button>}
              </div>)}
            </td>
            <td className="tdx">{cad(r.net_sales)}</td>
            <td className="tdx"><input className={input} style={{ width: 72 }} type="number" value={pctNow} onChange={(e) => recalc(r.id, { custom_reward_pct: Number(e.target.value) })} /></td>
            <td className="tdx">{cad(r.reward_value)}</td>
            <td className="tdx"><input className={input} style={{ width: 72 }} type="number" value={ppdNow} onChange={(e) => recalc(r.id, { custom_points_per_dollar: Number(e.target.value) })} /></td>
            <td className="tdx">{r.points} pts</td>
            <td className="tdx text-xs">{r.match_status} / {r.reward_status}</td></tr>);
        })}</tbody></table></div>
    </Card>
    {ovOpen && (() => {
      const r = rows.find((x) => x.id === ovOpen);
      if (!r) return null;
      const cid = ovCid.trim();
      const cust = cid ? store.customers.find((c) => c.customer_id === cid) : undefined;
      return (<div className="rounded-lg border border-violet-300 bg-violet-50 p-3 text-sm">
        <div className="font-semibold">Allow Export Override — {r.referral_phone_raw} ({r.match_status})</div>
        <p className="mt-1 text-xs text-violet-900">This phone could not be uniquely matched. You are responsible for verifying the correct recipient in Amber POS. Override, Customer ID, operator, timestamp, and reason are recorded in the batch history.</p>
        {(r.candidates ?? []).length > 0 && (<div className="mt-2"><div className="text-xs font-semibold">Candidate accounts:</div>{(r.candidates ?? []).map((c) => (<label key={c.customer_id} className="block text-xs"><input type="radio" name={'ov-' + r.id} checked={ovCid === c.customer_id} onChange={() => setOvCid(c.customer_id)} /> {customerDisplayName(c)} · {c.customer_id} · {originatingLocation(c.customer_id)} · {c.points} pts</label>))}</div>)}
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <label className="text-xs">Recipient Customer ID<input className={input} value={ovCid} onChange={(e) => setOvCid(e.target.value)} placeholder="e.g. 2-12345" /></label>
          <label className="text-xs">Operator<input className={input} value={ovOperator} onChange={(e) => setOvOperator(e.target.value)} placeholder="Staff initials" /></label>
        </div>
        <label className="mt-2 block text-xs">Reason<textarea className={input} value={ovReason} onChange={(e) => setOvReason(e.target.value)} placeholder="Verified in Amber POS…" /></label>
        {cid && !cust && (<div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-800">No customer for {cid} — will record Unmatched Recipient.<label className="mt-1 block"><input type="checkbox" checked={ovAllowUnknown} onChange={(e) => setOvAllowUnknown(e.target.checked)} /> I understand and still want to export this ID.</label></div>)}
        {cust && (<div className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-800">Matched: {customerDisplayName(cust)} · {cust.customer_id} · {cust.points} pts — will record Verified.</div>)}
        <label className="mt-2 block text-xs"><input type="checkbox" checked={ovAck} onChange={(e) => setOvAck(e.target.checked)} /> I verified the recipient in Amber POS and accept responsibility.</label>
        <div className="mt-2 flex gap-2"><button className={btn} onClick={confirmOverride}>Confirm Override &amp; Include</button><button className={btnGhost} onClick={() => setOvOpen(null)}>Cancel</button></div>
      </div>);
    })()}
    <Card title="Sales import history">
      {!store.salesImports.length && <p className="text-sm text-stone-500">No sales imports yet.</p>}
      {store.salesImports.length > 0 && (<div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1"><input type="checkbox" checked={salesSel.length > 0 && salesSel.length === Math.min(20, store.salesImports.length)} onChange={(e) => setSalesSel(e.target.checked ? store.salesImports.slice(0, 20).map((h) => h.id) : [])} /> Select all (page)</label>
        <span>{salesSel.length} selected</span>
        <button className={btnGhost} disabled={!salesSel.length} onClick={() => setSalesConfirm(true)}>Delete Selected</button>
        {salesMsg && <span className="text-emerald-700">{salesMsg}</span>}
      </div>)}
      {store.salesImports.slice(0, 20).map((h) => (<div key={h.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={salesSel.includes(h.id)} onChange={(e) => setSalesSel(e.target.checked ? [...salesSel, h.id] : salesSel.filter((x) => x !== h.id))} />
          <span>{h.filename} · period {h.reporting_period} · {new Date(h.imported_at).toLocaleString()}</span></label>
        <span className="text-stone-600">{h.records_processed} rows</span>
      </div>))}
      {salesConfirm && (<div className="mt-2 rounded border border-red-300 bg-red-50 p-3 text-sm">
        <div className="font-semibold">Confirm deletion of {salesSel.length} import-history record(s)?</div>
        <ul className="mt-1 list-disc pl-5 text-xs">{salesSel.map((id) => { const h = store.salesImports.find((x) => x.id === id); if (!h) return null; const ref = salesRefInfo(id); return (<li key={id}>{h.filename} · {h.reporting_period} · batches: {ref.batches.length} · referral rows: {ref.referrals.length}</li>); })}</ul>
        <p className="mt-1 text-xs">History entries only — customers, batches, and adjustments are never deleted. Referenced imports are blocked.</p>
        <div className="mt-2 flex gap-2"><button className={btnGhost} onClick={() => setSalesConfirm(false)}>Cancel</button>
          <button className={btn} onClick={() => {
            const blocked = salesSel.filter((id) => salesRefInfo(id).batches.length > 0);
            if (blocked.length) { setSalesMsg('Blocked: ' + blocked.length + ' import(s) referenced by reward batches. Delete the batch first or keep the history.'); setSalesConfirm(false); return; }
            deleteSalesImports(salesSel);
          }}>Confirm Delete</button></div>
      </div>)}
    </Card>
  </div>);
}
