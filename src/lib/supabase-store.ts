// Shared-database sync engine: Supabase is the single source of truth —
// there is no browser-local cache of business data. Writes are diffed so a
// 20k-customer database is never re-uploaded on every keystroke.
import { supabaseBrowser, selectAll } from './data';
import { normalizeStoredSettings, DEFAULT_SETTINGS, type StoreShape } from './store';
import { normalizePhone } from './utils';
import type { Customer, ImportHistoryItem, ManualPointRecord, PointAdjustment, ReferralAggregate, RewardBatch } from './types';

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const num = (v: unknown, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

function customerToRow(c: Customer) {
  return {
    customer_id: c.customer_id,
    company: c.company ?? null,
    first_name: c.first_name ?? null,
    last_name: c.last_name ?? null,
    phone1: c.phone1 ?? null,
    phone2: c.phone2 ?? null,
    cell_phone: c.cell_phone ?? null,
    phone1_normalized: normalizePhone(c.phone1 ?? '') || null,
    phone2_normalized: normalizePhone(c.phone2 ?? '') || null,
    cell_normalized: normalizePhone(c.cell_phone ?? '') || null,
    email: c.email ?? null,
    member_id: c.member_id ?? null,
    customer_type: c.customer_type ?? null,
    ar: c.ar ?? null,
    store_credit: c.store_credit ?? null,
    points: Math.round(num(c.points)),
    deposit: c.deposit ?? null,
    referral: c.referral ?? null,
    customer_code: c.customer_code ?? null,
    date_added: c.date_added || null,
    address1: c.address1 ?? null,
    address2: c.address2 ?? null,
    city: c.city ?? null,
    province: c.province ?? null,
    postal: c.postal ?? null,
    country: c.country ?? null,
    raw: (c.raw ?? {}) as Record<string, unknown>,
    active: c.active !== false,
    deactivated_at: c.deactivated_at ?? null,
    updated_at: c.updated_at ?? new Date().toISOString(),
  };
}

function rowToCustomer(r: Record<string, unknown>): Customer {
  const s = (k: string) => (r[k] === null || r[k] === undefined ? '' : String(r[k]));
  const n = (k: string) => (r[k] === null || r[k] === undefined || r[k] === '' ? null : Number(r[k]));
  return {
    customer_id: String(r.customer_id ?? ''),
    company: s('company'), first_name: s('first_name'), last_name: s('last_name'),
    phone1: s('phone1'), phone2: s('phone2'), cell_phone: s('cell_phone'),
    email: s('email'), member_id: s('member_id'), customer_type: s('customer_type'),
    ar: n('ar'), store_credit: n('store_credit'),
    points: Math.round(num(r.points)),
    deposit: n('deposit'), referral: s('referral'), customer_code: s('customer_code'),
    date_added: s('date_added'),
    address1: s('address1'), address2: s('address2'), city: s('city'),
    province: s('province'), postal: s('postal'), country: s('country'),
    raw: (r.raw as Record<string, unknown>) ?? {},
    active: r.active === false ? false : true,
    deactivated_at: typeof r.deactivated_at === 'string' ? (r.deactivated_at as string) : null,
    updated_at: typeof r.updated_at === 'string' ? (r.updated_at as string) : new Date().toISOString(),
  };
}
function importToCustomerRow(h: ImportHistoryItem) {
  return {
    client_id: h.id, filename: h.filename, imported_at: h.imported_at,
    records_processed: h.records_processed, added: h.added, updated: h.updated,
    unchanged: h.unchanged, skipped: h.skipped, failed: h.failed,
    errors: h.errors ?? [], file_hash: h.file_hash ?? null, data: { ...h },
  };
}

function importToSalesRow(h: ImportHistoryItem) {
  const extra = (h.extra ?? {}) as Record<string, unknown>;
  return {
    client_id: h.id, filename: h.filename, imported_at: h.imported_at,
    reporting_period: h.reporting_period ?? '',
    records_processed: h.records_processed,
    referrer_count: num((extra as Record<string, unknown>).referrer_count ?? h.added),
    total_net_sales: num((extra as Record<string, unknown>).total_net_sales),
    matched: num((extra as Record<string, unknown>).matched),
    ambiguous: num((extra as Record<string, unknown>).ambiguous),
    unmatched: num((extra as Record<string, unknown>).unmatched),
    errors: h.errors ?? [], file_hash: h.file_hash ?? `${h.id}`,
    column_mapping: (extra as Record<string, unknown>).column_mapping ?? {},
    data: { ...h },
  };
}

function rowToImport(r: Record<string, unknown>, kind: 'customers' | 'sales'): ImportHistoryItem {
  const d = (r.data ?? {}) as Record<string, unknown>;
  const pick = (key: string, fb: unknown) => (d[key] !== undefined ? d[key] : (r[key] ?? fb));
  return {
    id: String(r.client_id ?? r.id ?? `imp-${Date.now()}`),
    kind,
    filename: String(pick('filename', r.filename ?? 'import')),
    imported_at: String(pick('imported_at', r.imported_at ?? new Date().toISOString())),
    records_processed: num(pick('records_processed', 0)),
    added: num(pick('added', 0)), updated: num(pick('updated', 0)),
    unchanged: num(pick('unchanged', 0)), skipped: num(pick('skipped', 0)),
    failed: num(pick('failed', 0)),
    errors: (pick('errors', []) as unknown[]) as string[],
    reporting_period: kind === 'sales' ? String(pick('reporting_period', r.reporting_period ?? '')) : undefined,
    file_hash: (r.file_hash as string) ?? (d.file_hash as string),
    extra: (d.extra as Record<string, unknown>) ?? {},
  };
}

function entryToRow(batchId: string, e: RewardBatch['entries'][number]) {
  return {
    batch_id: batchId, customer_id: e.customer_id, customer_name: e.customer_name,
    referral_phone: e.referral_phone,
    referral_phones: e.referral_phones ?? [e.referral_phone],
    net_sales: e.net_sales, reward_pct: e.reward_pct, reward_value: e.reward_value,
    points_per_dollar: e.points_per_dollar, points: e.points,
    member_id: e.member_id ?? null, ar: e.ar ?? null, store_credit: e.store_credit ?? null,
    override_status: e.override_status ?? null, override_reason: e.override_reason ?? null,
    override_operator: e.override_operator ?? null, override_at: e.override_at ?? null,
    override_verified: e.override_verified ?? null,
  };
}

function manualToRow(m: ManualPointRecord) {
  return {
    client_id: m.id, batch_id: m.batch_id, customer_id: m.customer_id,
    customer_name: m.customer_name, originating_location: m.originating_location,
    balance_before: m.balance_before, points_adjustment: m.points_adjustment,
    balance_after: m.balance_after,
    reward_amount_dollars: m.reward_amount_dollars ?? m.reward_value ?? null,
    points_per_dollar: m.points_per_dollar,
    net_sales: m.net_sales ?? null, reward_pct: m.reward_pct ?? null,
    reward_value: m.reward_value ?? m.reward_amount_dollars ?? null,
    projected_balance: m.projected_balance ?? m.balance_after ?? null,
    reason: m.reason, operator: m.operator, created_at: m.created_at,
    exported_at: m.exported_at, filename: m.filename,
    status: m.status, confirmed_at: m.confirmed_at,
  };
}
export async function fetchSharedStore(): Promise<StoreShape> {
  const sb = supabaseBrowser();
  if (!sb) throw new Error('Supabase is not configured.');
  const { data: sess } = await sb.auth.getSession();
  if (!sess?.session) throw new Error('AUTH_REQUIRED');
  const [custRows, cimpRows, simpRows, aggRows, batchRows, entryRows, adjRows, manRows, setRes] = await Promise.all([
    selectAll<Record<string, unknown>>('customers', { column: 'customer_id', ascending: true }, 1000),
    selectAll<Record<string, unknown>>('customer_imports', { column: 'imported_at', ascending: false }, 500),
    selectAll<Record<string, unknown>>('sales_imports', { column: 'imported_at', ascending: false }, 500),
    selectAll<Record<string, unknown>>('referral_aggregates', undefined, 1000).catch(() => [] as Record<string, unknown>[]),
    selectAll<Record<string, unknown>>('reward_batches', { column: 'created_at', ascending: false }, 500),
    selectAll<Record<string, unknown>>('reward_entries', undefined, 1000),
    selectAll<Record<string, unknown>>('point_adjustments', { column: 'confirmed_at', ascending: false }, 1000),
    selectAll<Record<string, unknown>>('manual_point_records', { column: 'created_at', ascending: false }, 500).catch(() => [] as Record<string, unknown>[]),
    sb.from('app_settings').select('*').eq('id', 1).maybeSingle(),
  ]);
  const salesUuidToClient = new Map<string, string>();
  for (const r of simpRows) {
    if (r.id && r.client_id) salesUuidToClient.set(String(r.id), String(r.client_id));
  }
  const { originatingLocation } = await import('./types');
  const entriesByBatch = new Map<string, RewardBatch['entries'][number][]>();
  for (const r of entryRows) {
    const b = String(r.batch_id ?? '');
    const arr = entriesByBatch.get(b) ?? [];
    arr.push({
      customer_id: String(r.customer_id ?? ''),
      customer_name: String(r.customer_name ?? ''),
      referral_phone: String(r.referral_phone ?? ''),
      referral_phones: Array.isArray(r.referral_phones) ? (r.referral_phones as string[]) : undefined,
      net_sales: num(r.net_sales), reward_pct: num(r.reward_pct),
      reward_value: num(r.reward_value), points_per_dollar: num(r.points_per_dollar),
      points: Math.round(num(r.points)),
      member_id: (r.member_id as string) ?? undefined,
      ar: (r.ar as number) ?? null, store_credit: (r.store_credit as number) ?? null,
      originating_location: 'Unknown',
      override_status: (r.override_status as RewardBatch['entries'][number]['override_status']) ?? null,
      override_reason: (r.override_reason as string) ?? null,
      override_operator: (r.override_operator as string) ?? null,
      override_at: (r.override_at as string) ?? null,
      override_verified: typeof r.override_verified === 'boolean' ? r.override_verified : null,
    });
    entriesByBatch.set(b, arr);
  }
  const batches: RewardBatch[] = batchRows.map((r) => {
    const entries = (entriesByBatch.get(String(r.id)) ?? []).map((e) => ({
      ...e, originating_location: originatingLocation(e.customer_id),
    }));
    const settings = (r.settings ?? {}) as RewardBatch['settings'];
    return {
      id: String(r.id), reporting_period: String(r.reporting_period ?? ''),
      sales_import_id: (r.sales_client_id as string) ?? (r.sales_import_id ? salesUuidToClient.get(String(r.sales_import_id)) : undefined),
      created_at: String(r.created_at ?? new Date().toISOString()),
      filename: String(r.filename ?? 'batch.xlsx'), entries,
      settings: {
        reward_pct: num(settings.reward_pct, 10),
        points_per_dollar: num(settings.points_per_dollar, 10),
        rounding: settings.rounding === 'floor' || settings.rounding === 'ceil' ? settings.rounding : 'nearest',
        optional_columns: Array.isArray(settings.optional_columns) ? (settings.optional_columns as string[]) : [],
        optional_defaults: (settings.optional_defaults ?? {}) as Record<string, string | number>,
      },
      status: (r.status as RewardBatch['status']) ?? 'Exported',
      total_net_sales: num(r.total_net_sales), total_reward_value: num(r.total_reward_value),
      total_points: Math.round(num(r.total_points)),
      columns: Array.isArray(r.columns) ? (r.columns as string[]) : ['CustomerID', 'Points'],
      applied_to_balances: Boolean(r.applied_to_balances),
      kind: r.kind === 'manual' ? 'manual' : 'referral',
      origin: (r.origin as string) ?? undefined,
    };
  });
  const referrals: ReferralAggregate[] = aggRows
    .map((r) => ((r.data ?? {}) as unknown) as ReferralAggregate)
    .filter((x) => x && typeof x === 'object' && (x as ReferralAggregate).id);
  const adjustments: PointAdjustment[] = adjRows.map((r) => ({
    id: String(r.id), batch_id: String(r.batch_id ?? ''), customer_id: String(r.customer_id ?? ''),
    points_added: Math.round(num(r.points_added)), balance_before: Math.round(num(r.balance_before)),
    balance_after: Math.round(num(r.balance_after)),
    confirmed_at: String(r.confirmed_at ?? new Date().toISOString()),
    note: String(r.note ?? ''),
  }));
  const manualPoints: ManualPointRecord[] = manRows.map((r) => ({
    id: String(r.client_id ?? r.id), batch_id: (r.batch_id as string) ?? null,
    customer_id: String(r.customer_id ?? ''), customer_name: String(r.customer_name ?? ''),
    originating_location: String(r.originating_location ?? 'Unknown'),
    balance_before: Math.round(num(r.balance_before)),
    points_adjustment: Math.round(num(r.points_adjustment)),
    balance_after: Math.round(num(r.balance_after)),
    reward_amount_dollars: r.reward_amount_dollars != null ? num(r.reward_amount_dollars) : null,
    points_per_dollar: r.points_per_dollar != null ? num(r.points_per_dollar) : null,
    net_sales: r.net_sales != null ? num(r.net_sales) : null,
    reward_pct: r.reward_pct != null ? num(r.reward_pct) : null,
    reward_value: r.reward_value != null ? num(r.reward_value) : null,
    projected_balance: r.projected_balance != null ? Math.round(num(r.projected_balance)) : null,
    reason: String(r.reason ?? ''), operator: String(r.operator ?? ''),
    created_at: String(r.created_at ?? new Date().toISOString()),
    exported_at: (r.exported_at as string) ?? null, filename: (r.filename as string) ?? null,
    status: (r.status as ManualPointRecord['status']) ?? 'Exported',
    confirmed_at: (r.confirmed_at as string) ?? null,
  }));
  const setData = (setRes as unknown as { data?: { data?: unknown } } | null)?.data?.data;
  return {
    customers: custRows.map(rowToCustomer),
    customerImports: cimpRows.map((r) => rowToImport(r, 'customers')),
    salesImports: simpRows.map((r) => rowToImport(r, 'sales')),
    referrals, batches, adjustments, manualPoints,
    settings: normalizeStoredSettings(setData ?? DEFAULT_SETTINGS),
  };
}
function json(a: unknown) { return JSON.stringify(a); }

/** Diffed write-through: only changed/new records hit Supabase. */
export async function persistStoreDiff(prev: StoreShape | null, next: StoreShape): Promise<void> {
  const sb = supabaseBrowser();
  if (!sb) return;
  const { data: sess } = await sb.auth.getSession();
  if (!sess?.session) return;
  const prevCust = new Map((prev?.customers ?? []).map((c) => [c.customer_id, json(c)]));
  const changedCust = next.customers.filter((c) => prevCust.get(c.customer_id) !== json(c));
  for (const ch of chunk(changedCust, 500)) {
    if (!ch.length) break;
    const { error } = await sb.from('customers').upsert(ch.map(customerToRow), { onConflict: 'customer_id' });
    if (error) {
      if (/column .* does not exist|schema cache/i.test(error.message)) {
        throw new Error('Customer sync failed: run supabase/migration-admin-controls.sql in the Supabase SQL Editor, then retry. (' + error.message + ')');
      }
      throw new Error('customers sync failed: ' + error.message);
    }
  }
  const idSet = (list: { id: string }[]) => new Set((list ?? []).map((x) => x.id));
  const prevCImp = idSet(prev?.customerImports ?? []);
  const newCImp = next.customerImports.filter((h) => !prevCImp.has(h.id));
  for (const ch of chunk(newCImp, 200)) {
    if (!ch.length) break;
    const { error } = await sb.from('customer_imports').upsert(ch.map(importToCustomerRow), { onConflict: 'client_id' });
    if (error) throw new Error('customer history sync failed: ' + error.message);
  }
  const prevSImp = idSet(prev?.salesImports ?? []);
  const newSImp = next.salesImports.filter((h) => !prevSImp.has(h.id));
  for (const ch of chunk(newSImp, 200)) {
    if (!ch.length) break;
    const { error } = await sb.from('sales_imports').upsert(ch.map(importToSalesRow), { onConflict: 'client_id' });
    if (error) throw new Error('sales history sync failed: ' + error.message);
  }
  const prevRef = new Map((prev?.referrals ?? []).map((r) => [r.id, json(r)]));
  const changedRef = next.referrals.filter((r) => prevRef.get(r.id) !== json(r));
  for (const ch of chunk(changedRef, 300)) {
    if (!ch.length) break;
    const { error } = await sb.from('referral_aggregates').upsert(
      ch.map((r) => ({ id: r.id, sales_client_id: r.sales_import_id ?? null, reporting_period: r.reporting_period ?? '', referral_phone_normalized: r.referral_phone_normalized ?? '', data: r })),
      { onConflict: 'id' },
    );
    if (error) {
      if (/referral_aggregates|relation .* does not exist|schema cache/i.test(error.message)) return;
      throw new Error('referral sync failed: ' + error.message);
    }
  }
  if (prev) {
    const nextRefIds = new Set(next.referrals.map((r) => r.id));
    const stale = (prev.referrals ?? []).map((r) => r.id).filter((id) => !nextRefIds.has(id));
    for (const ch of chunk(stale, 300)) {
      if (!ch.length) break;
      await sb.from('referral_aggregates').delete().in('id', ch);
    }
  }
  const prevBatchJson = new Map((prev?.batches ?? []).map((b) => [b.id, json(b)]));
  const changedBatch = next.batches.filter((b) => prevBatchJson.get(b.id) !== json(b));
  if (changedBatch.length) {
    const { data: simpMap } = await sb.from('sales_imports').select('id,client_id');
    const uuidByClient = new Map((simpMap ?? []).map((r: { id: string; client_id: string }) => [r.client_id, r.id]));
    for (const ch of chunk(changedBatch, 100)) {
      const { error } = await sb.from('reward_batches').upsert(ch.map((b) => ({
        id: b.id, reporting_period: b.reporting_period,
        sales_import_id: (b.sales_import_id && uuidByClient.get(b.sales_import_id)) || null,
        sales_client_id: b.sales_import_id ?? null,
        created_at: b.created_at, filename: b.filename, settings: b.settings,
        columns: b.columns, status: b.status,
        total_net_sales: b.total_net_sales, total_reward_value: b.total_reward_value,
        total_points: b.total_points, applied_to_balances: b.applied_to_balances,
        kind: b.kind ?? 'referral', origin: b.origin ?? null,
      })), { onConflict: 'id' });
      if (error) throw new Error('batch sync failed: ' + error.message);
      const entryRows = ch.flatMap((b) => b.entries.map((e) => entryToRow(b.id, e)));
      for (const ech of chunk(entryRows, 300)) {
        if (!ech.length) break;
        const { error: eerr } = await sb.from('reward_entries').upsert(ech, { onConflict: 'batch_id,customer_id' });
        if (eerr) throw new Error('batch entries sync failed: ' + eerr.message);
      }
    }
  }
  const prevAdj = idSet(prev?.adjustments ?? []);
  const newAdj = next.adjustments.filter((a) => !prevAdj.has(a.id));
  for (const ch of chunk(newAdj, 200)) {
    if (!ch.length) break;
    const { error } = await sb.from('point_adjustments').upsert(
      ch.map((a) => ({ batch_id: a.batch_id, customer_id: a.customer_id, points_added: a.points_added, balance_before: a.balance_before, balance_after: a.balance_after, confirmed_at: a.confirmed_at, note: a.note })),
      { onConflict: 'batch_id,customer_id' },
    );
    if (error) throw new Error('adjustments sync failed: ' + error.message);
  }
  const prevMan = new Map((prev?.manualPoints ?? []).map((m) => [m.id, json(m)]));
  const changedMan = next.manualPoints.filter((m) => prevMan.get(m.id) !== json(m));
  for (const ch of chunk(changedMan, 200)) {
    if (!ch.length) break;
    const { error } = await sb.from('manual_point_records').upsert(ch.map(manualToRow), { onConflict: 'client_id' });
    if (error) {
      if (/net_sales|reward_pct|projected_balance|column .* does not exist|schema cache/i.test(error.message)) {
        throw new Error('manual rewards sync failed: run supabase/migration-shared-db.sql in Supabase SQL Editor, then retry. (' + error.message + ')');
      }
      throw new Error('manual rewards sync failed: ' + error.message);
    }
  }
  if (!prev || json(prev.settings) !== json(next.settings)) {
    const { error } = await sb.from('app_settings').upsert({ id: 1, data: next.settings });
    if (error) throw new Error('settings sync failed: ' + error.message);
  }
  if (prev) {
    const nextC = new Set(next.customerImports.map((h) => h.id));
    const delC = prev.customerImports.map((h) => h.id).filter((id) => !nextC.has(id));
    if (delC.length) await sb.from('customer_imports').delete().in('client_id', delC);
    const nextS = new Set(next.salesImports.map((h) => h.id));
    const delS = prev.salesImports.map((h) => h.id).filter((id) => !nextS.has(id));
    if (delS.length) await sb.from('sales_imports').delete().in('client_id', delS);
  }
}
