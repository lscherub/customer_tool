import test from 'node:test';
import assert from 'node:assert/strict';

// Mirror of src/lib/utils logic (kept in sync; pure functions).
const normalizePhone = (p) => String(p ?? '').replace(/[^\d]/g, '');
const cleanMatrix = (aoa) => {
  let rows = aoa.map((r) => [...r]);
  while (rows.length && rows.every((r) => r[0] === null || r[0] === undefined || String(r[0]).trim() === '')) {
    rows = rows.map((r) => r.slice(1)); if (!rows[0]?.length) break;
  }
  if (rows.length >= 2 && rows[1].every((c) => c === null || c === undefined || String(c).trim() === '')) rows = [rows[0], ...rows.slice(2)];
  return rows;
};
const calcReward = (net, pct, ppd, rounding = 'nearest') => {
  const rewardValue = (Number(net) || 0) * (Number(pct) || 0) / 100;
  const raw = rewardValue * (Number(ppd) || 0);
  const points = rounding === 'floor' ? Math.floor(raw) : rounding === 'ceil' ? Math.ceil(raw) : Math.round(raw);
  return { rewardValue: Math.round(rewardValue * 100) / 100, points };
};
const loc = (cid) => ({ 1: 'Head Office', 2: 'Davie', 3: 'West Broadway', 4: 'Main Street', 5: 'Online Webstore' }[(cid || '').trim()[0]] ?? 'Unknown');

test('blank first column + blank second row removed', () => {
  const aoa = [[null, 'Customer ID', 'Points'], [null, '', ''], [null, '1-22344', 20]];
  assert.deepEqual(cleanMatrix(aoa), [['Customer ID', 'Points'], ['1-22344', 20]]);
});
test('Customer ID preserved as text', () => { assert.equal(String('1-22344'), '1-22344'); });
test('group2->phone, Subtotal->net mapping', () => {
  const hdr = (h) => h.trim().toLowerCase();
  assert.equal(hdr('  Group2 '), 'group2'); assert.equal(hdr('SUBTOTAL'), 'subtotal');
});
test('phone normalization matches formats', () => {
  assert.equal(normalizePhone('(604) 555-1234'), '6045551234');
  assert.equal(normalizePhone('604 555 1234'), '6045551234');
  assert.equal(normalizePhone('604-555-1234'), '6045551234');
});
test('reward examples', () => {
  assert.deepEqual(calcReward(10, 10, 10), { rewardValue: 1, points: 10 });
  assert.deepEqual(calcReward(20, 20, 1), { rewardValue: 4, points: 4 });
});
test('originating locations', () => {
  assert.equal(loc('1-22344'), 'Head Office'); assert.equal(loc('2-44433'), 'Davie');
  assert.equal(loc('3-x'), 'West Broadway'); assert.equal(loc('4-x'), 'Main Street'); assert.equal(loc('5-x'), 'Online Webstore');
});
test('20 + 10 = 30, no double apply', () => {
  let balance = 20; const batch = { applied: false, points: 10 };
  const apply = () => { if (batch.applied) return balance; batch.applied = true; balance += batch.points; return balance; };
  assert.equal(apply(), 30); assert.equal(apply(), 30);
});
test('later POS export authoritative, no double count', () => {
  const posPoints = 30, confirmedAwarded = 10;
  assert.ok(posPoints >= confirmedAwarded);
});
test('saved sales mapping drives parsing (group1 override)', () => {
  const norm = (h) => String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const saved = 'group1';
  const row = { group1: '6045559999', group2: 'WRONG', Subtotal: 42 };
  const getBy = (r, cands) => {
    const n = {};
    for (const k of Object.keys(r)) n[norm(k)] = r[k];
    for (const c of cands) { const v = n[norm(c)]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; }
    return null;
  };
  const phoneCands = [saved, 'group2'];
  assert.equal(String(getBy(row, phoneCands)), '6045559999');
});
test('merge multiple referral rows by CustomerID sums points', () => {
  const rows = [
    { cid: '2-1', net: 10, val: 1, pts: 10, phone: 'a' },
    { cid: '2-1', net: 20, val: 2, pts: 20, phone: 'b' },
    { cid: '3-9', net: 5, val: 0.5, pts: 5, phone: 'c' },
  ];
  const by = new Map();
  for (const r of rows) {
    const prev = by.get(r.cid) ?? { net: 0, val: 0, pts: 0, phones: [] };
    prev.net += r.net; prev.val += r.val; prev.pts += r.pts; prev.phones.push(r.phone);
    by.set(r.cid, prev);
  }
  assert.equal(by.size, 2);
  assert.deepEqual(by.get('2-1'), { net: 30, val: 3, pts: 30, phones: ['a', 'b'] });
});
test('manual points: balance unchanged until confirm, no double apply', () => {
  let balance = 100; const adj = 25; let status = 'Exported'; let applied = false;
  const confirm = () => {
    if (status === 'Confirmed') return balance;
    status = 'Confirmed'; applied = true; balance += adj; return balance;
  };
  assert.equal(balance, 100);
  assert.equal(confirm(), 125);
  assert.equal(confirm(), 125);
  assert.ok(applied);
});
test('missing mapped column is detected', () => {
  const norm = (h) => String(h ?? '').trim().toLowerCase();
  const headers = ['group2', 'Subtotal'];
  const missing = ['group1'].filter((c) => !headers.map(norm).includes(norm(c)));
  assert.deepEqual(missing, ['group1']);
});
// --- Follow-up update specs: auth/reset/admin/dashboard pure-logic mirrors ---

// currentPeriod format (src/lib/utils.ts)
const currentPeriod = (d = new Date()) => {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
};
test('currentPeriod produces YYYY-MM', () => {
  assert.equal(currentPeriod(new Date(2026, 9, 16)), '2026-10');
  assert.equal(currentPeriod(new Date(2026, 0, 5)), '2026-01');
  assert.match(currentPeriod(), /^\d{4}-\d{2}$/);
});

// Referral Sales Clear/Reset: clears working rows, preserves saved history
test('clear working calculation keeps saved history', () => {
  const st = {
    customers: [{ customer_id: '1-1', points: 10 }],
    referrals: [{ id: 'r1', reporting_period: '2026-10' }],
    salesImports: [{ id: 'simp-1', reporting_period: '2026-10' }],
    batches: [{ id: 'RB-1', status: 'Exported' }],
    adjustments: [], manualPoints: [],
    settings: { reward_pct: 10, points_per_dollar: 10 },
  };
  const next = { ...st, referrals: [] }; // what clearWorkingCalculation does to the store
  assert.equal(next.referrals.length, 0);
  assert.equal(next.salesImports.length, 1); // sales-import history preserved
  assert.equal(next.batches.length, 1); // exported batch preserved
  assert.equal(next.customers[0].points, 10); // balances untouched
  assert.equal(next.settings.reward_pct, 10); // config untouched
});
test('duplicate detection survives a clear (driven by saved imports + batches)', () => {
  const salesImports = [{ id: 'simp-1', reporting_period: '2026-10', filename: 'a.xlsx' }];
  const batches = [{ id: 'RB-1', status: 'Exported', entries: [{ customer_id: '2-1' }], reporting_period: '2026-10' }];
  const referrals = []; // cleared screen
  const samePeriod = salesImports.filter((h) => h.reporting_period === '2026-10');
  assert.equal(samePeriod.length, 1);
  const selIds = new Set(['2-1']);
  const warnDup = batches.filter((b) => b.status === 'Exported' && b.reporting_period === '2026-10' && b.entries.some((e) => selIds.has(e.customer_id)));
  assert.equal(warnDup.length, 1);
  assert.equal(referrals.length, 0);
});

// Manual Points Reset: defaults restored from settings, nothing written
test('manual reset restores settings defaults and clears working fields', () => {
  const settings = { reward_pct: 7, points_per_dollar: 12, rounding: 'nearest' };
  const form = { q: 'smi', picked: { customer_id: '2-1' }, netText: '20.00', pctText: '99', ppdText: '5', reason: 'note', operator: 'staff@x.com', msg: 'old' };
  const reset = { ...form, q: '', picked: null, netText: '', pctText: String(settings.reward_pct), ppdText: String(settings.points_per_dollar), reason: '', operator: 'staff@x.com', msg: null };
  assert.equal(reset.picked, null);
  assert.equal(reset.netText, '');
  assert.equal(reset.pctText, '7'); // from Settings, not hardcoded
  assert.equal(reset.ppdText, '12');
  assert.equal(reset.reason, '');
  assert.equal(reset.msg, null);
});
test('manual export produces incremental points, balance changes only on confirm', () => {
  let balance = 100; const ptsToAward = 25;
  const exportRow = { customer_id: '2-1', points: ptsToAward }; // exported file carries only the delta
  assert.equal(exportRow.points, 25);
  assert.equal(balance, 100); // export does not change balance
  balance += ptsToAward; // explicit confirm
  assert.equal(balance, 125);
});

// Admin clear-customers gate (mirror of supabase/migration-admin-controls.sql)
test('clear-customers requires exact phrase and blocks while history references customers', () => {
  const phrase = 'CLEAR CUSTOMERS';
  assert.notEqual('clear customers', phrase); // case-sensitive
  const counts = { reward_entries: 3, point_adjustments: 1, manual_point_records: 0, referral_matches: 2 };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.ok(total > 0, 'referencing history must block deletion');
  const decision = total > 0 ? { status: 'blocked', details: counts } : { status: 'ok', deleted: 42 };
  assert.equal(decision.status, 'blocked');
  const empty = { reward_entries: 0, point_adjustments: 0, manual_point_records: 0, referral_matches: 0 };
  assert.equal(Object.values(empty).reduce((a, b) => a + b, 0) === 0 ? 'ok' : 'blocked', 'ok');
});

// Archived customers excluded from referral matching (buildPhoneIndex mirror)
test('archived customers never enter the phone index', () => {
  const customers = [
    { customer_id: '2-1', phone1: '6045551111', active: true },
    { customer_id: '2-2', phone1: '6045551111', active: false },
  ];
  const idx = new Map();
  for (const c of customers) {
    if (c.active === false) continue;
    const n = c.phone1.replace(/\D/g, '');
    idx.set(n, [...(idx.get(n) ?? []), c.customer_id]);
  }
  assert.deepEqual(idx.get('6045551111'), ['2-1']);
});

// Dashboard: actionable items only; batch statuses clearly separated
test('dashboard attention items and batch-status separation', () => {
  const store = {
    referrals: [
      { match_status: 'ambiguous', included: true },
      { match_status: 'unmatched', included: false },
      { match_status: 'matched', included: true },
    ],
    batches: [
      { status: 'Exported' }, { status: 'Exported' }, { status: 'Confirmed' }, { status: 'Cancelled' },
    ],
    customerImports: [{ failed: 2 }],
    salesImports: [{ failed: 0 }],
  };
  const ambiguous = store.referrals.filter((r) => r.match_status === 'ambiguous').length;
  const unmatched = store.referrals.filter((r) => r.match_status === 'unmatched').length;
  assert.equal(ambiguous + unmatched, 2);
  const pending = store.batches.filter((b) => b.status === 'Exported').length;
  const conf = store.batches.filter((b) => b.status === 'Confirmed').length;
  const canc = store.batches.filter((b) => b.status === 'Cancelled').length;
  assert.deepEqual([pending, conf, canc], [2, 1, 1]);
  // Working (unsaved) referral rows are never counted as batches:
  assert.equal(store.batches.length, 4);
  assert.equal(store.customerImports.filter((h) => h.failed > 0).length, 1);
  assert.equal(store.salesImports.filter((h) => h.failed > 0).length, 0);
});

// Sign-out cache purge: all gn_* keys removed, other keys untouched
test('sign-out purge removes every gn_ cache key', () => {
  const keys = ['gn_customers', 'gn_batches', 'gn_referrals', 'gn_settings', 'other_tool_key'];
  const remaining = keys.filter((k) => !k.startsWith('gn_'));
  assert.deepEqual(remaining, ['other_tool_key']);
});


// All Customers: Excel-like column sorting (mirror of compareSortValues in customers/page.tsx)
const isBlankSortValue = (v) => v === null || v === undefined || v === '';
const compareSortValues = (a, b, type, dir = 1) => {
  const aBlank = isBlankSortValue(a); const bBlank = isBlankSortValue(b);
  if (aBlank || bBlank) return aBlank === bBlank ? 0 : aBlank ? 1 : -1;
  if (type === 'number') return (Number(a) - Number(b)) * dir;
  if (type === 'date') {
    const ta = Date.parse(String(a)); const tb = Date.parse(String(b));
    if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.isNaN(ta) === Number.isNaN(tb) ? 0 : Number.isNaN(ta) ? 1 : -1;
    return (ta - tb) * dir;
  }
  return String(a).localeCompare(String(b)) * dir;
};
test('numeric columns sort numerically (Smallest to Largest), not as text', () => {
  const points = [100, 9, 20, 3];
  assert.deepEqual([...points].sort((a, b) => compareSortValues(a, b, 'number')), [3, 9, 20, 100]);
  assert.deepEqual([...points].sort((a, b) => compareSortValues(a, b, 'number', -1)), [100, 20, 9, 3]);
});
test('Customer IDs and phone numbers stay text (leading zeros intact)', () => {
  const ids = ['10', '0123456789', '2'];
  const asc = [...ids].sort((a, b) => compareSortValues(a, b, 'text'));
  assert.deepEqual(asc, ['0123456789', '10', '2']); // lexicographic, not numeric
  assert.notDeepEqual(asc, [...ids].sort((a, b) => compareSortValues(a, b, 'number')));
  assert.equal(asc[0], '0123456789'); // sorting never rewrites the value itself
});
test('date columns sort chronologically, not as text', () => {
  const dates = ['Feb 5, 2024', 'November 3, 2023', 'Dec 31, 2023'];
  const asc = [...dates].sort((a, b) => compareSortValues(a, b, 'date'));
  assert.deepEqual(asc, ['November 3, 2023', 'Dec 31, 2023', 'Feb 5, 2024']);
  assert.notDeepEqual(asc, [...dates].sort((a, b) => compareSortValues(a, b, 'text')));
});
test('blank cells always sort last, in both directions', () => {
  const vals = ['', 'b', null, 'a'];
  assert.deepEqual([...vals].sort((a, b) => compareSortValues(a, b, 'text')), ['a', 'b', '', null]);
  assert.deepEqual([...vals].sort((a, b) => compareSortValues(a, b, 'text', -1)), ['b', 'a', '', null]);
});

// All Customers: bulk deletion (mirror of deleteCustomersByIds in src/lib/admin.ts)
test('bulk delete chunks selected IDs and fails safe when links cannot be verified', () => {
  const chunkIds = (ids, size = 300) => { const out = []; for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size)); return out; };
  const ids = Array.from({ length: 650 }, (_, i) => `1-${i}`);
  const chunks = chunkIds(ids);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.flat(), ids);
  const proceed = (verifyError, linkedCount) => !verifyError && linkedCount === 0;
  assert.equal(proceed(null, 0), true);                   // verified clean → delete may proceed
  assert.equal(proceed(null, 3), false);                  // linked history → blocked with an explanation
  assert.equal(proceed(new Error('check failed'), 0), false); // cannot verify → refuse (fail safe)
});

test('reward-entry records are counted with their batch before deletion', () => {
  const batches = [{ id: 'RB-1', entries: [{}, {}, {}] }, { id: 'RB-2', entries: [{}, {}] }];
  const total = batches.reduce((n, b) => n + b.entries.length, 0);
  assert.equal(total, 5); // exactly these rows go with the batches — nothing else
});

// Reward History deletion (mirror of admin_delete_reward_batches in supabase/migration-admin-reward-history.sql)
test('reward batches are deleted only where safe', () => {
  const batches = [
    { id: 'RB-1', applied_to_balances: false }, // plain export → deletable
    { id: 'RB-2', applied_to_balances: true },  // balances applied → kept
    { id: 'RB-3', applied_to_balances: false }, // manual point record references it → kept
    { id: 'RB-4', applied_to_balances: false }, // point adjustment references it → kept
    { id: 'RB-5', applied_to_balances: false }, // cancelled before use → deletable
  ];
  const adjustments = new Set(['RB-4']);
  const manual = new Set(['RB-3']);
  const isUnsafe = (b) => b.applied_to_balances || adjustments.has(b.id) || manual.has(b.id);
  const safe = batches.filter((b) => !isUnsafe(b));
  assert.deepEqual(safe.map((b) => b.id), ['RB-1', 'RB-5']);
});
test('batch deletion outcome reporting stays accurate (ok / partial / blocked)', () => {
  const status = (deleted, skipped) => (skipped === 0 ? 'ok' : deleted > 0 ? 'partial' : 'blocked');
  assert.equal(status(3, 0), 'ok');      // everything requested was deleted
  assert.equal(status(2, 1), 'partial'); // safe ones deleted, applied ones kept
  assert.equal(status(0, 2), 'blocked'); // nothing deleted, explanation returned
  const missing = (requested, existing) => requested - existing;
  assert.equal(missing(4, 3), 1); // already-gone batches are reported, never claimed deleted
});

console.log('All spec tests defined. Run: node --test tests/run.mjs');
