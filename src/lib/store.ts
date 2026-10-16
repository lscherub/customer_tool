import { supabaseBrowser, lsGet, lsSet, isSupabaseConfigured } from './data';
import type { AppSettings, Customer, ImportHistoryItem, PointAdjustment, ReferralAggregate, RewardBatch } from './types';
import { normalizePhone } from './utils';

export const DEFAULT_SETTINGS: AppSettings = {
  reward_pct: 10,
  points_per_dollar: 10,
  rounding: 'nearest',
  optional_columns: [],
  optional_defaults: {},
  updated_at: new Date().toISOString(),
};

export interface StoreShape {
  customers: Customer[];
  customerImports: ImportHistoryItem[];
  salesImports: ImportHistoryItem[];
  referrals: ReferralAggregate[];
  batches: RewardBatch[];
  adjustments: PointAdjustment[];
  settings: AppSettings;
}

export function loadStore(): StoreShape {
  return {
    customers: lsGet<Customer[]>('customers', []),
    customerImports: lsGet<ImportHistoryItem[]>('customerImports', []),
    salesImports: lsGet<ImportHistoryItem[]>('salesImports', []),
    referrals: lsGet<ReferralAggregate[]>('referrals', []),
    batches: lsGet<RewardBatch[]>('batches', []),
    adjustments: lsGet<PointAdjustment[]>('adjustments', []),
    settings: lsGet<AppSettings>('settings', DEFAULT_SETTINGS),
  };
}

export function saveStore(s: StoreShape): void {
  lsSet('customers', s.customers);
  lsSet('customerImports', s.customerImports);
  lsSet('salesImports', s.salesImports);
  lsSet('referrals', s.referrals);
  lsSet('batches', s.batches);
  lsSet('adjustments', s.adjustments);
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
