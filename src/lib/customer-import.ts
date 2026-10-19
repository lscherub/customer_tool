import { getByHeaders } from './excel';
import { parseNumber, parsePoints } from './utils';
import type { Customer } from './types';

export const FIELD_CANDIDATES: Record<string, string[]> = {
  company: ['Company', 'Company Name'],
  first_name: ['First Name', 'FirstName'],
  last_name: ['Last Name', 'LastName'],
  phone1: ['Phone 1', 'Phone1'],
  phone2: ['Phone 2', 'Phone2'],
  cell_phone: ['Cell Phone', 'CellPhone', 'Cell'],
  email: ['Email', 'E-mail'],
  customer_id: ['Customer ID', 'CustomerID', 'Customer Id'],
  member_id: ['Member ID', 'MemberID'],
  customer_type: ['Customer Type', 'CustomerType', 'Type'],
  ar: ['AR'],
  store_credit: ['Store Credit', 'StoreCredit'],
  points: ['Points', 'Point'],
  deposit: ['Deposit'],
  referral: ['REFERRAL', 'Referral'],
  customer_code: ['Customer Code', 'CustomerCode'],
  date_added: ['Date Added', 'DateAdded'],
  address1: ['Address 1', 'Address1', 'Address', 'Street'],
  address2: ['Address 2', 'Address2'],
  city: ['City'],
  province: ['Province', 'State', 'Prov'],
  postal: ['Postal', 'Postal Code', 'Zip', 'ZIP'],
  country: ['Country'],
};

export function rowToCustomer(row: Record<string, unknown>): { customer: Customer | null; error?: string } {
  const cidRaw = getByHeaders(row, FIELD_CANDIDATES.customer_id);
  const cid = cidRaw === null ? '' : String(cidRaw).trim();
  if (!cid) return { customer: null, error: 'Missing Customer ID' };
  const str = (k: string) => {
    const v = getByHeaders(row, FIELD_CANDIDATES[k]);
    return v === null ? '' : String(v).trim();
  };
  const c: Customer = {
    customer_id: cid,
    company: str('company'),
    first_name: str('first_name'), last_name: str('last_name'),
    phone1: str('phone1'), phone2: str('phone2'), cell_phone: str('cell_phone'),
    email: str('email'), member_id: str('member_id'), customer_type: str('customer_type'),
    ar: parseNumber(getByHeaders(row, FIELD_CANDIDATES.ar)),
    store_credit: parseNumber(getByHeaders(row, FIELD_CANDIDATES.store_credit)),
    points: parsePoints(getByHeaders(row, FIELD_CANDIDATES.points)),
    deposit: parseNumber(getByHeaders(row, FIELD_CANDIDATES.deposit)),
    referral: str('referral'), customer_code: str('customer_code'),
    date_added: str('date_added'),
    address1: str('address1'), address2: str('address2'), city: str('city'),
    province: str('province'), postal: str('postal'), country: str('country'),
    raw: row, updated_at: new Date().toISOString(),
  };
  return { customer: c };
}

export function customersEqual(a: Customer, b: Customer): boolean {
  // Archive state (active/deactivated_at) is app-managed, not part of the POS
  // export file — comparing it would mark every row "updated" on re-import
  // and silently un-archive customers.
  const strip = (c: Customer) => ({ ...c, raw: undefined, updated_at: undefined, active: undefined, deactivated_at: undefined });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}
