import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const api = await import('../lib/operational-store.ts');
const clean = api.exportOperationalState();

test('only the untouched duplicate critical amount rule is removed', () => {
  api.connectShopifyStore({ tenantId: 'amount-rule-test', name: 'Test', domain: 'amount-test.myshopify.com', accessToken: 'test', clientSecret: 'test', expiresIn: 10000 });
  const baseline = api.getDashboardSnapshot('amount-rule-test').rules;
  const high = baseline.find((rule) => rule.id === 'recommended-order-high');
  assert.ok(high);
  const critical = {
    ...structuredClone(high), id: 'recommended-order-critical', label: 'סכום הזמנה קיצוני',
    conditions: [{ id: 'order-critical', field: 'order_amount', operator: 'gt', value: 15000 }],
    action: { severity: 'critical', openCase: true, emailOwner: true },
  };
  const snapshot = api.exportOperationalState();
  snapshot.rulesByTenant = [['amount-rule-test', [high, critical, { ...critical, id: 'custom-critical', label: 'כלל שערכתי' }]]];
  api.restoreOperationalState(snapshot);
  const rules = api.getDashboardSnapshot('amount-rule-test').rules;
  assert.equal(rules.some((rule) => rule.id === 'recommended-order-critical'), false);
  assert.equal(rules.find((rule) => rule.id === 'recommended-order-high')?.label, 'סכום הזמנה גבוה');
  assert.equal(rules.some((rule) => rule.id === 'custom-critical'), true);
  api.restoreOperationalState(clean);
});
