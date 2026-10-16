// Shared types for Genesis Nutrition operations tool.
export type MatchStatus = 'matched' | 'ambiguous' | 'unmatched';
export type RewardStatus = 'eligible' | 'needs_review' | 'excluded';
export type BatchStatus = 'Draft' | 'Exported' | 'Confirmed' | 'Cancelled';

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
}

export interface RewardEntry {
  customer_id: string;
  customer_name: string;
  referral_phone: string;
  net_sales: number;
  reward_pct: number;
  reward_value: number;
  points_per_dollar: number;
  points: number;
  member_id?: string;
  ar?: number | null;
  store_credit?: number | null;
  originating_location: string;
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
}

export interface BatchSettings {
  reward_pct: number;
  points_per_dollar: number;
  rounding: 'nearest' | 'floor' | 'ceil';
  optional_columns: string[];
  optional_defaults: Record<string, string | number>;
}

export interface AppSettings extends BatchSettings {
  updated_at: string;
}

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
