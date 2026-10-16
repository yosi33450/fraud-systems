import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { evaluateRisk, applyCombinedRisk } = await import('../lib/risk-engine.ts');
const { customerHistory } = await import('../lib/customer-history.ts');
const { groupChargebacks } = await import('../lib/chargeback-groups.ts');
const signals = { ordersByEmailLastHour: 4, ordersByIpLastTwoHours: 4, giftCardOrdersByIpLastTwoHours: 0, emailsByIpLastTwoHours: 1, identitiesByPhoneLastDay: 0, orderAmount: 2000, averageOrderValue: 100, giftCardValue: 0, giftCardBaseline: 0, linkedGiftCard: false, paymentFailures: 0, billingShippingMismatch: false, shopifyRisk: 'low', employeeMatch: false, refundAfterFulfillment: false, blacklist: {} };
const condition = (field, value = 3) => ({ id: field, field, operator: 'gt', value });
const rule = (id, conditions, severity = 'high') => ({ id, label: id, description: id, category: 'behavior', enabled: true, logic: 'any', conditions, action: { openCase: true, severity } });
test('two distinct high signals in one or multiple rules become critical', () => {
  for (const rules of [[rule('both', [condition('orders_by_email'), condition('orders_by_ip')])], [rule('a', [condition('orders_by_email')]), rule('b', [condition('orders_by_ip')])]]) {
    const result = evaluateRisk(signals, new Date(), rules);
    assert.equal(result.severity, 'critical'); assert.ok(result.score >= 92);
  }
});
test('duplicate rules and unmatched conditions never create critical escalation', () => {
  const result = evaluateRisk(signals, new Date(), [rule('a', [condition('orders_by_email'), condition('orders_by_ip', 100)]), rule('duplicate', [condition('orders_by_email')])]);
  assert.equal(result.severity, 'high');
  assert.ok(!result.evidence[0].description.includes('כתובת IP'));
});
test('medium supplemental conditions do not count as high', () => {
  assert.equal(evaluateRisk(signals, new Date(), [rule('a', [condition('orders_by_email')]), rule('b', [condition('orders_by_ip')], 'medium')]).severity, 'high');
});
test('employee high finding combines with high internal rule', () => {
  const result = evaluateRisk(signals, new Date(), [rule('a', [condition('orders_by_email')])]);
  result.evidence.push({ id: 'employee', label: 'employee', source: 'employee', delta: 72, riskSeverity: 'high', riskKeys: ['employee:address'] });
  assert.equal(applyCombinedRisk(result).severity, 'critical');
});
test('customer history includes old clean orders and excludes other stores and IP-only identities', () => {
  const source = { tenantId: 't', storeId: 's', shopifyOrderId: '1', email: 'buyer@example.com', createdAt: '2026-10-15', amount: 5 };
  const rows = [source, { ...source, shopifyOrderId: '2', createdAt: '2026-09-01' }, { ...source, shopifyOrderId: '3', storeId: 'other' }, { ...source, shopifyOrderId: '4', email: 'other@example.com' }];
  assert.deepEqual(customerHistory(source, rows).map((row) => row.shopifyOrderId), ['1', '2']);
});
const chargeback = (id, email, extra = {}) => ({ id, tenantId: 't', receivedAt: '2026-10-10', last4Digits: '1234', match: { confidence: 'exact', storeId: 's', email }, ...extra });
test('chargebacks group verified email case-insensitively but never card suffix alone', () => {
  const groups = groupChargebacks([chargeback('a', 'Buyer@example.com'), chargeback('b', 'buyer@example.com'), chargeback('c', 'other@example.com'), chargeback('d', 'buyer@example.com', { tenantId: 'other' })]);
  assert.deepEqual(groups.map((group) => group.length).sort(), [1, 1, 2]);
});
