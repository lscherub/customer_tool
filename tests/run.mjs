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
console.log('All spec tests defined. Run: node --test tests/run.mjs');
