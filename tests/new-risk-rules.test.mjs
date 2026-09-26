import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const api = await import('../lib/operational-store.ts');
const initial = api.exportOperationalState();
function setup() {
  api.restoreOperationalState(initial);
  return api.connectShopifyStore({ tenantId: 'rules-test', name: 'Test', domain: 'risk-test.myshopify.com', accessToken: 'test', clientSecret: 'test', expiresIn: 10000 });
}
function order(store, id, at, extra = {}) {
  return api.ingestShopifyOrder({ storeId: store.id, webhookId: `event-${id}`, topic: 'HISTORICAL_SYNC', payload: { id: String(id), name: `#${id}`, created_at: at, email: 'buyer@example.com', total_price: 150, ...extra } });
}

test('external-order is excluded before storage and risk analysis', () => {
  const store = setup();
  const result = order(store, 1, '2026-09-25T12:00:00Z', { total_price: 20000, tags: ['external-order'] });
  assert.equal(result.case, null);
  assert.equal(api.exportOperationalState().orders.length, 0);
  assert.equal(api.exportOperationalState().cases.length, 0);
});

test('night hours add a small bonus but never create an alert alone', () => {
  const store = setup();
  const night = order(store, 1, '2026-09-24T22:00:00Z');
  assert.equal(night.case, null);
  const nightLarge = order(store, 2, '2026-09-24T22:05:00Z', { total_price: 2000, email: 'another@example.com' });
  const dayLarge = order(store, 3, '2026-09-25T10:00:00Z', { total_price: 2000, email: 'third@example.com' });
  assert.ok(nightLarge.case.score > dayLarge.case.score);
  assert.ok(nightLarge.case.evidence.some((entry) => entry.label === 'רכישה בשעות הלילה'));
});

test('repeated gift-card purchases above 100 match IP despite changed emails', () => {
  const store = setup();
  for (let n = 0; n < 2; n++) order(store, n, new Date(Date.parse('2026-09-25T12:00:00Z') + n * 60000).toISOString(), {
    email: `buyer${n}@example.com`, browser_ip: '203.0.113.5', total_price: 150,
    line_items: [{ title: 'Gift Card', gift_card: true, price: 150, quantity: 1 }],
  });
  const third = order(store, 3, '2026-09-25T12:02:00Z', {
    email: 'buyer3@example.com', browser_ip: '203.0.113.5', total_price: 150,
    line_items: [{ title: 'Gift Card', gift_card: true, price: 150, quantity: 1 }],
  });
  assert.equal(third.case?.severity, 'critical');
  assert.ok(third.case.evidence.some((entry) => entry.label.includes('מעל ₪100')));
});

test('Shopify high risk opens a case; medium augments an existing rule', () => {
  const store = setup();
  assert.equal(order(store, 1, '2026-09-25T12:00:00Z', { risk_level: 'high' }).case?.severity, 'high');
  const medium = order(store, 2, '2026-09-25T12:01:00Z', { email: 'different@example.com', total_price: 2000, risk_level: 'medium', shopify_risk_facts: ['Multiple payment attempts'] });
  assert.ok(medium.case.evidence.some((entry) => entry.label.includes('סיכון בינוני')));
  assert.ok(medium.case.evidence.some((entry) => entry.description.includes('Multiple payment attempts')));
  assert.deepEqual(medium.case.context.riskFacts, ['Multiple payment attempts']);
});

test('employee zero-value purchase is investigated separately from general velocity rules', () => {
  const store = setup();
  api.addEmployee('rules-test', { name: 'Worker', email: 'worker@example.com', privateEmail: 'private@example.com', address: 'Test street 1', couponCodes: ['oved30'], department: 'Sales' });
  const zero = order(store, 1, '2026-09-25T12:00:00Z', { email: 'private@example.com', total_price: 0 });
  assert.equal(zero.case?.severity, 'high');
  assert.equal(zero.case?.evidence[0].source, 'employee');
});

test('employee coupon matching and a fulfilled refund remain attached to the same order', () => {
  const store = setup();
  const employee = api.addEmployee('rules-test', { name: 'Worker', email: 'worker@example.com', couponCodes: ['oved30'], department: 'Sales' });
  const created = order(store, 1, '2026-09-25T12:00:00Z', { email: 'buyer@example.com', discount_codes: ['oved30'] });
  assert.equal(created.case, null);
  assert.equal(api.exportOperationalState().employees.find((entry) => entry.id === employee.id).purchases, 1);
  api.ingestShopifyOrder({ storeId: store.id, webhookId: 'refund-1', topic: 'refunds/create', payload: {
    id: '1', name: '#1', created_at: '2026-09-25T12:00:00Z', email: 'buyer@example.com', discount_codes: ['oved30'], total_price: 150, refund_after_fulfillment: true,
  } });
  const state = api.exportOperationalState();
  assert.equal(state.orders.length, 1);
  assert.equal(state.employees.find((entry) => entry.id === employee.id).refunded, 1);
});

test('live Shopify discount-code objects are normalized like historical codes', () => {
  const store = setup();
  const employee = api.addEmployee('rules-test', { name: 'Worker', email: 'worker@example.com', couponCodes: ['oved30'], department: 'Sales' });
  order(store, 1, '2026-09-25T12:00:00Z', { discount_codes: [{ code: 'OVED30', amount: '30.00', type: 'percentage' }] });
  assert.deepEqual(api.exportOperationalState().orders[0].couponCodes, ['oved30']);
  assert.equal(api.exportOperationalState().employees.find((entry) => entry.id === employee.id).purchases, 1);
});
