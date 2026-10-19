import type { AppSettings, Customer, ImportHistoryItem, ManualPointRecord, PointAdjustment, ReferralAggregate, RewardBatch, SalesFieldMap } from './types';
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
  dashboard_show_summaries: false,
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
    dashboard_show_summaries: r.dashboard_show_summaries === true,
  };
}

/**
 * In-memory store shape. Supabase is the single source of truth: state starts
 * empty and is populated from the shared database after authentication.
 * No browser-local cache of business data is kept (cleared on sign-out too).
 */
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

/** Fresh, empty store — never seeded from any local cache. */
export function emptyStore(): StoreShape {
  const base = { ...DEFAULT_SETTINGS, sales_field_map: { ...DEFAULT_SETTINGS.sales_field_map } };
  return {
    customers: [], customerImports: [], salesImports: [], referrals: [],
    batches: [], adjustments: [], manualPoints: [], settings: base,
  };
}

/** Build phone -> customers index for referral matching. Archived customers are excluded. */
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
    if (c.active === false) continue; // archived/deactivated customers never match
    if (c.phone1) push(c.phone1, c);
    if (c.phone2) push(c.phone2, c);
    if (c.cell_phone) push(c.cell_phone, c);
  }
  return idx;
}
