import { supabaseBrowser, lsGet, lsSet, isSupabaseConfigured } from './data';
import type { AppSettings, Customer, ImportHistoryItem, ManualPointRecord, PointAdjustment, ReferralAggregate, RewardBatch, RewardEntry, SalesFieldMap } from './types';
import { DEFAULT_SALES_FIELD_MAP } from './types';
import { normalizePhone } from './utils';

export const DEFAULT_SETTINGS: AppSettings = {
  reward_pct: 10,
  points_per_dollar: 10,
  rounding: 'nearest',
  optional_columns: [],
  optional_defaults: {},
  sales_field_map: { ...DEFAULT_SALES_FIELD_MAP },
  updated_at: new Date().toISOString(),
};

export function normalizeStoredSettings(raw: unknown): AppSettings {
  const base = { ...DEFAULT_SETTINGS, sales_field_map: { ...DEFAULT_SETTINGS.sales_field_map } };
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<AppSettings> & { sales_field_map?: Partial<SalesFieldMap> | null };
  const sm = (r.sales_field_map ?? {}) as Partial<SalesFieldMap>;
  const str = (v: unknown, fb: string) => (typeof v === 'string' && v.trim() ? v.trim() : fb);
  return {
    reward_pct: Number.isFinite(Number(r.reward_pct)) ? Number(r.reward_pct) : base.reward_pct,
    points_per_dollar: Number.isFinite(Number(r.points_per_dollar)) ? Number(r.points_per_dollar) : base.points_per_dollar,
    rounding: r.rounding === 'floor' || r.rounding === 'ceil' || r.rounding === 'nearest' ? r.rounding : base.rounding,
    optional_columns: Array.isArray(r.optional_columns) ? r.optional_columns.filter((x): x is string => typeof x === 'string') : [],
    optional_defaults: r.optional_defaults && typeof r.optional_defaults === 'object' ? (r.optional_defaults as Record<string, string | number>) : {},
    sales_field_map: {
      phone: str(sm.phone, base.sales_field_map.phone),
      net: str(sm.net, base.sales_field_map.net),
      txn: str(sm.txn, base.sales_field_map.txn),
      store: str(sm.store, base.sales_field_map.store),
    },
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : base.updated_at,
  };
}

export interface StoreShape {
  customers: Customer[];
  customerImports: ImportHistoryItem[];
  salesImports: ImportHistoryItem[];
  referrals: ReferralAggregate[];
  batches: RewardBatch[];
  adjustments: PointAdjustment[];
  manualPoints: ManualPointRecord[];
  settings: AppSettings;
}

function normalizeEntry(e: unknown): RewardEntry {
  const r = (e ?? {}) as Partial<RewardEntry>;
  return {
    customer_id: String(r.customer_id ?? ''),
    customer_name: String(r.customer_name ?? ''),
    referral_phone: String(r.referral_phone ?? ''),
    referral_phones: undefined,
    net_sales: Number(r.net_sales) || 0,
    reward_pct: Number(r.reward_pct) || 0,
    reward_value: Number(r.reward_value) || 0,
    points_per_dollar: Number(r.points_per_dollar) || 0,
    points: Math.round(Number(r.points) || 0),
    member_id: undefined,
    ar: null,
    store_credit: null,
    originating_location: 'Unknown',
    override_status: null,
    override_reason: null,
    override_operator: null,
    override_at: null,
    override_verified: null,
  };
}
export function loadStore(): StoreShape {
  const rawB = lsGet<unknown[]>('batches', []);
  const rawM = lsGet<unknown[]>('manualPoints', []);
  const storedB = Array.isArray(rawB) ? (rawB as unknown[]) : [];
  const batches: RewardBatch[] = storedB.map((b) => {
    const r = (b ?? {}) as Partial<RewardBatch>;
    const ents = Array.isArray(r.entries) ? r.entries.map(normalizeEntry) : [];
    return {
      id: String(r.id ?? 'batch'), reporting_period: String(r.reporting_period ?? ''),
      sales_import_id: typeof r.sales_import_id === 'string' ? r.sales_import_id : undefined,
      created_at: typeof r.created_at === 'string' ? r.created_at : new Date().toISOString(),
      filename: String(r.filename ?? 'batch.xlsx'), entries: ents,
      settings: {
        reward_pct: Number((r.settings as { reward_pct?: unknown } | undefined)?.reward_pct) || 10,
        points_per_dollar: Number((r.settings as { points_per_dollar?: unknown } | undefined)?.points_per_dollar) || 10,
        rounding: 'nearest' as const, optional_columns: [], optional_defaults: {},
      },
      status: (r.status as RewardBatch['status']) ?? 'Exported',
      total_net_sales: Number(r.total_net_sales) || 0,
      total_reward_value: Number(r.total_reward_value) || 0,
      total_points: Math.round(Number(r.total_points) || 0),
      columns: Array.isArray(r.columns) ? (r.columns as string[]) : ['CustomerID', 'Points'],
      applied_to_balances: Boolean(r.applied_to_balances),
      kind: r.kind === 'manual' ? 'manual' as const : 'referral' as const,
      origin: typeof r.origin === 'string' ? r.origin : undefined,
    };
  });
  const manualPoints: ManualPointRecord[] = Array.isArray(rawM) ? (rawM as ManualPointRecord[]) : [];
  return {
    customers: lsGet<Customer[]>('customers', []),
    customerImports: lsGet<ImportHistoryItem[]>('customerImports', []),
    salesImports: lsGet<ImportHistoryItem[]>('salesImports', []),
    referrals: lsGet<ReferralAggregate[]>('referrals', []),
    batches, adjustments: lsGet<PointAdjustment[]>('adjustments', []),
    manualPoints, settings: normalizeStoredSettings(lsGet<unknown>('settings', DEFAULT_SETTINGS)),
  };
}

export function saveStore(s: StoreShape): void {
  lsSet('customers', s.customers);
  lsSet('customerImports', s.customerImports);
  lsSet('salesImports', s.salesImports);
  lsSet('referrals', s.referrals);
  lsSet('batches', s.batches);
  lsSet('adjustments', s.adjustments);
  lsSet('manualPoints', s.manualPoints);
  lsSet('settings', s.settings);
  void syncToSupabase(s);
}

async function syncToSupabase(s: StoreShape): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const sb = supabaseBrowser();
    if (!sb) return;
    // Best-effort mirror: upsert settings + batches metadata. Full bulk sync
    // for 20k customers uses the SQL bulk route documented in README.
    await sb.from('app_settings').upsert({ id: 1, data: s.settings });
  } catch { /* offline-safe */ }
}

/** Build phone -> customers index for referral matching. */
export function buildPhoneIndex(customers: Customer[]): Map<string, Customer[]> {
  const idx = new Map<string, Customer[]>();
  const push = (phone: string, c: Customer) => {
    const n = normalizePhone(phone);
    if (!n) return;
    const arr = idx.get(n) ?? [];
    // avoid duplicate same customer listed twice for same normalized number
    if (!arr.some((x) => x.customer_id === c.customer_id)) arr.push(c);
    idx.set(n, arr);
  };
  for (const c of customers) {
    if (c.phone1) push(c.phone1, c);
    if (c.phone2) push(c.phone2, c);
    if (c.cell_phone) push(c.cell_phone, c);
  }
  return idx;
}
