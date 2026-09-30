import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCrediMatchChargeback, normalizeCrediMatchChargebacks, paymentFingerprintsFromShopify } from '../lib/credimatch-matching.ts';

const chargeback = (overrides = {}) => ({
  id: 'credimatch-21893735', tenantId: 'tenant-primary', discrepancyId: '21893735', receivedAt: '2026-09-29T12:00:00Z',
  dealTime: '2026-09-28T10:01:00Z', originalAmount: 349.9, currency: 'ILS', last4Digits: '4242', confirmationNumber: 'AUTH-77',
  settlements: [], ...overrides,
});

const order = (overrides = {}) => ({
  storeId: 'store-1', storeName: 'Strongful', shopifyOrderId: 'gid://shopify/Order/123', orderNumber: '#123',
  customer: 'ישראל ישראלי', email: 'buyer@example.com', amount: 349.9, currency: 'ILS', createdAt: '2026-09-28T10:00:00Z',
  payments: [{ amount: 349.9, currency: 'ILS', processedAt: '2026-09-28T10:00:30Z', last4: '4242', confirmationNumber: 'AUTH77' }],
  ...overrides,
});

test('extracts a safe Shopify payment fingerprint from receipt data', () => {
  assert.deepEqual(paymentFingerprintsFromShopify([{
    id: 'gid://shopify/OrderTransaction/1', gateway: 'PayPlus', account_number: '•••• 4242', amount: '349.90', processed_at: '2026-09-28T10:00:30Z',
    receipt: JSON.stringify({ authorization_code: 'AUTH-77', voucher_number: 9988, terminal_id: '42' }),
  }], 'ILS'), [{
    transactionId: 'gid://shopify/OrderTransaction/1', gateway: 'PayPlus', amount: 349.9, currency: 'ILS', processedAt: '2026-09-28T10:00:30Z',
    last4: '4242', confirmationNumber: 'AUTH-77', voucherNumber: '9988', terminalNumber: '42', sessionNumber: undefined,
  }]);
});

test('prefers the Shopify authorization code without retaining the raw receipt', () => {
  const [payment] = paymentFingerprintsFromShopify([{
    id: 'gid://shopify/OrderTransaction/2', amount: '445', authorization_code: 'DIRECT-42',
    receipt: { authorization_code: 'RECEIPT-99', sensitive_blob: 'not retained' },
  }], 'ILS');
  assert.equal(payment.confirmationNumber, 'DIRECT-42');
  assert.equal('receipt' in payment, false);
  assert.equal('sensitive_blob' in payment, false);
});

test('normalizes CrediMatch discrepancy and transaction responses without inventing fields', () => {
  const result = normalizeCrediMatchChargebacks({
    tenantId: 'tenant-primary', discrepancyId: '21893735', receivedAt: '2026-09-29T12:00:00Z',
    discrepancyPayload: { discrepancies: [{ id: 21893735, dealTime: '2026-09-28T10:01:00Z', originalAmount: 349.9, last4Digits: '4242', transactionId: 55, discrepancyType: { description: 'הכחשה' } }] },
    transactionPayloads: [{ transactions: [{ id: 55, grossAmount: 349.9, currency: { translatedCurrencyType: 'ILS' }, creditAndDebits: [{ expectedNetAmount: 330 }] }] }],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].discrepancyId, '21893735');
  assert.equal(result[0].type, 'הכחשה');
  assert.equal(result[0].currency, 'ILS');
  assert.equal(result[0].settlements[0].expectedNetAmount, 330);
});

test('links an exact chargeback using authorization and amount', () => {
  const match = matchCrediMatchChargeback(chargeback(), [order()]);
  assert.equal(match.confidence, 'exact');
  assert.equal(match.orderNumber, '#123');
  assert.ok(match.reasons.includes('מספר אישור זהה'));
  assert.ok(match.comparisons.find((item) => item.key === 'amount')?.matched);
});

test('marks an amount-and-time-only candidate for manual verification', () => {
  const candidate = order({ payments: [], amount: 349.9, createdAt: '2026-09-28T10:20:00Z' });
  const match = matchCrediMatchChargeback(chargeback({ confirmationNumber: undefined, last4Digits: undefined }), [candidate]);
  assert.equal(match.confidence, 'possible');
  assert.equal(match.orderNumber, '#123');
});

test('does not auto-confirm when two candidates score almost equally', () => {
  const first = order();
  const second = order({ shopifyOrderId: 'gid://shopify/Order/124', orderNumber: '#124' });
  assert.equal(matchCrediMatchChargeback(chargeback(), [first, second]).confidence, 'possible');
});
