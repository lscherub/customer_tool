import { getByHeaders } from './excel';
import { isSummaryRowText, normalizeHeader, normalizePhone, parseNumber } from './utils';
import { DEFAULT_SALES_FIELD_MAP, type SalesFieldMap } from './types';

export const SALES_FIELDS = {
  phone: ['group2', 'referral phone', 'referral', 'phone'],
  net: ['subtotal', 'net sales', 'netsales'],
  transactions: ['totaltransactions', 'transactions', 'txn'],
  store: ['storename', 'store', 'location'],
  group2name: ['group2name'],
  group1: ['group1'],
};

export function normalizeSalesFieldMap(partial?: Partial<SalesFieldMap> | null): SalesFieldMap {
  return {
    phone: (partial?.phone ?? DEFAULT_SALES_FIELD_MAP.phone).trim() || DEFAULT_SALES_FIELD_MAP.phone,
    net: (partial?.net ?? DEFAULT_SALES_FIELD_MAP.net).trim() || DEFAULT_SALES_FIELD_MAP.net,
    txn: (partial?.txn ?? DEFAULT_SALES_FIELD_MAP.txn).trim() || DEFAULT_SALES_FIELD_MAP.txn,
    store: (partial?.store ?? DEFAULT_SALES_FIELD_MAP.store).trim() || DEFAULT_SALES_FIELD_MAP.store,
  };
}

/** Saved mapping takes priority; built-in candidates are fallbacks. */
function candidatesFor(saved: string, fallbacks: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (c: string) => {
    const k = normalizeHeader(c);
    if (!seen.has(k)) { seen.add(k); out.push(c); }
  };
  if (saved.trim()) push(saved.trim());
  for (const f of fallbacks) push(f);
  return out;
}

export interface SalesRow {
  phoneRaw: string;
  phoneNorm: string;
  net: number;
  transactions: number | null;
  store: string;
  group1: string;
  group2name: string;
  raw: Record<string, unknown>;
}

function headerSet(rows: Record<string, unknown>[]): Set<string> {
  const s = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) s.add(normalizeHeader(k));
  return s;
}

/** Validate the saved mapping against the uploaded file headers. */
export function validateSalesFieldMap(
  headers: string[] | Record<string, unknown>[],
  fieldMap: SalesFieldMap,
): { ok: boolean; missing: { key: keyof SalesFieldMap; column: string }[]; available: string[] } {
  const available = Array.isArray(headers) && headers.length && typeof headers[0] === 'string'
    ? (headers as string[])
    : [];
  const norm = new Set<string>();
  if (available.length) {
    for (const h of available) norm.add(normalizeHeader(h));
  } else {
    for (const k of headerSet(headers as Record<string, unknown>[])) norm.add(k);
  }
  const missing: { key: keyof SalesFieldMap; column: string }[] = [];
  (Object.keys(fieldMap) as (keyof SalesFieldMap)[]).forEach((k) => {
    const col = (fieldMap[k] ?? '').trim();
    if (!col) return;
    if (!norm.has(normalizeHeader(col))) missing.push({ key: k, column: col });
  });
  return { ok: missing.length === 0, missing, available };
}

export function rowsToSales(
  rows: Record<string, unknown>[],
  fieldMap?: Partial<SalesFieldMap> | null,
): { data: SalesRow[]; skipped: string[] } {
  const map = normalizeSalesFieldMap(fieldMap);
  const phoneCands = candidatesFor(map.phone, SALES_FIELDS.phone);
  const netCands = candidatesFor(map.net, SALES_FIELDS.net);
  const txnCands = candidatesFor(map.txn, SALES_FIELDS.transactions);
  const storeCands = candidatesFor(map.store, SALES_FIELDS.store);
  const data: SalesRow[] = []; const skipped: string[] = [];
  rows.forEach((r, i) => {
    const phoneRaw = String(getByHeaders(r, phoneCands) ?? '').trim();
    const g2n = String(getByHeaders(r, SALES_FIELDS.group2name) ?? '');
    const g1 = String(getByHeaders(r, SALES_FIELDS.group1) ?? '');
    if (!phoneRaw) {
      if (isSummaryRowText(g1) || isSummaryRowText(g2n) || isSummaryRowText(phoneRaw)) skipped.push(`Row ${i + 1}: summary row ignored`);
      else skipped.push(`Row ${i + 1}: empty referral phone`);
      return;
    }
    if (/total|summary|grand/i.test(g2n) && !/\d{3,}/.test(phoneRaw)) { skipped.push(`Row ${i + 1}: aggregate summary ignored`); return; }
    const norm = normalizePhone(phoneRaw);
    if (!norm || norm.length < 7) { skipped.push(`Row ${i + 1}: invalid phone ${phoneRaw}`); return; }
    const net = parseNumber(getByHeaders(r, netCands)) ?? 0;
    const txn = parseNumber(getByHeaders(r, txnCands));
    data.push({ phoneRaw, phoneNorm: norm, net, transactions: txn === null ? null : Math.round(txn), store: String(getByHeaders(r, storeCands) ?? ''), group1: g1, group2name: g2n, raw: r });
  });
  return { data, skipped };
}
