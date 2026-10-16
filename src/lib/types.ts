// Shared types for Genesis Nutrition operations tool.
export type MatchStatus = 'matched' | 'ambiguous' | 'unmatched';
export type RewardStatus = 'eligible' | 'needs_review' | 'excluded';
export type BatchStatus = 'Draft' | 'Exported' | 'Confirmed' | 'Cancelled';
export type BatchKind = 'referral' | 'manual';
export type OverrideStatus = 'Manual Override — Verified' | 'Manual Override — Unmatched Recipient';

export interface SalesFieldMap {
  phone: string;
  net: string;
  txn: string;
  store: string;
}

export const DEFAULT_SALES_FIELD_MAP: SalesFieldMap = {
  phone: 'group2',
  net: 'Subtotal',
  txn: 'TotalTransactions',
  store: 'StoreName',
};

export interface ManualOverrideInfo {
  customer_id: string;
  /** true when the ID was validated against the customer DB */
  verified: boolean;
  status: OverrideStatus;
  reason: string;
  operator: string;
  at: string;
  /** true when operator confirmed proceeding with an unknown customer ID */
  allow_unknown_customer: boolean;
  source_phone_raw: string;
}

export interface Customer {
  customer_id: string;
  company?: string;
  first_name?: string;
  last_name?: string;
  phone1?: string;
  phone2?: string;
  cell_phone?: string;
  email?: string;
  member_id?: string;
  customer_type?: string;
  ar?: number | null;
  store_credit?: number | null;
  points: number;
  deposit?: number | null;
  referral?: string;
  customer_code?: string;
  date_added?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  postal?: string;
  country?: string;
  raw?: Record<string, unknown>;
  updated_at: string;
}

export interface ImportHistoryItem {
  id: string;
  kind: 'customers' | 'sales';
  filename: string;
  imported_at: string;
  records_processed: number;
  added: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  errors: string[];
  reporting_period?: string;
  file_hash?: string;
  extra?: Record<string, unknown>;
}

export interface ReferralAggregate {
  id: string;
  sales_import_id: string;
  reporting_period: string;
  referral_phone_raw: string;
  referral_phone_normalized: string;
  matched_customer_id?: string | null;
  matched_customer_name?: string | null;
  match_status: MatchStatus;
  candidates?: Customer[];
  selected_customer_id?: string | null;
  net_sales: number;
  transaction_count?: number | null;
  referred_count_label: string;
  reward_pct: number;
  reward_value: number;
  points_per_dollar: number;
  points: number;
  reward_status: RewardStatus;
  store_names?: string[];
  included: boolean;
  custom_reward_pct?: number | null;
  custom_points_per_dollar?: number | null;
  override?: ManualOverrideInfo | null;
}

export interface RewardEntry {
  customer_id: string;
  customer_name: string;
  referral_phone: string;
  /** All referral phones combined into this CustomerID row (merged rows) */
  referral_phones?: string[];
  net_sales: number;
  reward_pct: number;
  reward_value: number;
  points_per_dollar: number;
  points: number;
  member_id?: string;
  ar?: number | null;
  store_credit?: number | null;
  originating_location: string;
  override_status?: OverrideStatus | null;
  override_reason?: string | null;
  override_operator?: string | null;
  override_at?: string | null;
  override_verified?: boolean | null;
}

export interface RewardBatch {
  id: string;
  reporting_period: string;
  sales_import_id?: string;
  created_at: string;
  filename: string;
  entries: RewardEntry[];
  settings: BatchSettings;
  status: BatchStatus;
  total_net_sales: number;
  total_reward_value: number;
  total_points: number;
  columns: string[];
  applied_to_balances: boolean;
  kind: BatchKind;
  /** Human-readable origin, e.g. "Referral rewards" vs "Manual points adjustment" */
  origin?: string;
}

export interface BatchSettings {
  reward_pct: number;
  points_per_dollar: number;
  rounding: 'nearest' | 'floor' | 'ceil';
  optional_columns: string[];
  optional_defaults: Record<string, string | number>;
}

export interface AppSettings extends BatchSettings {
  sales_field_map: SalesFieldMap;
  updated_at: string;
}

export const DEFAULT_APP_SALES_FIELD_MAP: SalesFieldMap = { ...DEFAULT_SALES_FIELD_MAP };

export interface PointAdjustment {
  id: string;
  batch_id: string;
  customer_id: string;
  points_added: number;
  balance_before: number;
  balance_after: number;
  confirmed_at: string;
  note: string;
}

export interface ManualPointRecord {
  id: string;
  batch_id: string | null;
  customer_id: string;
  customer_name: string;
  originating_location: string;
  balance_before: number;
  points_adjustment: number;
  balance_after: number;
  reward_amount_dollars: number | null;
  points_per_dollar: number | null;
  reason: string;
  operator: string;
  created_at: string;
  exported_at: string | null;
  filename: string | null;
  status: 'Draft' | 'Exported' | 'Confirmed' | 'Cancelled';
  confirmed_at: string | null;
}

export const LOCATION_BY_PREFIX: Record<string, string> = {
  '1': 'Head Office',
  '2': 'Davie',
  '3': 'West Broadway',
  '4': 'Main Street',
  '5': 'Online Webstore',
};

export function originatingLocation(customerId: string): string {
  const m = /^(\d)-/.exec((customerId || '').trim());
  if (!m) return 'Unknown';
  return LOCATION_BY_PREFIX[m[1]] ?? 'Unknown';
}

export function customerDisplayName(c: Pick<Customer, 'company' | 'first_name' | 'last_name'>): string {
  const person = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  if (c.company && person) return `${c.company} — ${person}`;
  return c.company || person || '(no name)';
}
