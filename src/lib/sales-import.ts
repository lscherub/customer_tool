import { getByHeaders } from './excel';
import { isSummaryRowText, normalizePhone, parseNumber } from './utils';

export const SALES_FIELDS = {
  phone: ['group2', 'referral phone', 'referral', 'phone'],
  net: ['subtotal', 'net sales', 'netsales'],
  transactions: ['totaltransactions', 'transactions', 'txn'],
  store: ['storename', 'store', 'location'],
  group2name: ['group2name'],
  group1: ['group1'],
};

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

export function rowsToSales(rows: Record<string, unknown>[]): { data: SalesRow[]; skipped: string[] } {
  const data: SalesRow[] = []; const skipped: string[] = [];
  rows.forEach((r, i) => {
    const phoneRaw = String(getByHeaders(r, SALES_FIELDS.phone) ?? '').trim();
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
    const net = parseNumber(getByHeaders(r, SALES_FIELDS.net)) ?? 0;
    const txn = parseNumber(getByHeaders(r, SALES_FIELDS.transactions));
    data.push({ phoneRaw, phoneNorm: norm, net, transactions: txn === null ? null : Math.round(txn), store: String(getByHeaders(r, SALES_FIELDS.store) ?? ''), group1: g1, group2name: g2n, raw: r });
  });
  return { data, skipped };
}
