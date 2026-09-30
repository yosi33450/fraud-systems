import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCrediMatchChargeback, normalizeCrediMatchChargebacks, paymentFingerprintsFromShopify, shopifyChargebackSearchQuery } from '../lib/credimatch-matching.ts';

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
    paymentId: undefined, gatewayReference: undefined, last4: '4242', confirmationNumber: 'AUTH-77', voucherNumber: '9988', terminalNumber: '42', sessionNumber: undefined,
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

test('extracts the last four digits from Shopify card payment details when accountNumber is empty', () => {
  const [payment] = paymentFingerprintsFromShopify([{
    id: 'gid://shopify/OrderTransaction/3', amount: '445', payment_details: { number: '•••• •••• •••• 1944' },
  }], 'ILS');
  assert.equal(payment.last4, '1944');
  assert.equal('payment_details' in payment, false);
});

test('uses a Shopify tender gateway reference as an exact confirmation match', () => {
  const [payment] = paymentFingerprintsFromShopify([{
    gateway_reference: '0084173', amount: '445', processed_at: '2026-09-28T10:00:30Z',
    payment_details: { number: '•••• •••• •••• 1944' },
  }], 'ILS');
  const match = matchCrediMatchChargeback(chargeback({ originalAmount: 445, last4Digits: '1944', confirmationNumber: '84173' }), [
    order({ amount: 445, payments: [payment] }),
  ]);
  assert.equal(match.confidence, 'exact');
  assert.equal(match.orderNumber, '#123');
});

test('builds a targeted Shopify search for known chargeback amounts', () => {
  const query = shopifyChargebackSearchQuery({
    since: '2026-01-01T00:00:00.000Z', until: '2026-09-30T00:00:00.000Z',
    chargebacks: [{ originalAmount: 445 }, { originalAmount: 445 }, { grossAmount: -314.5 }],
  });
  assert.match(query, /current_total_price:445\.00 OR current_total_price:314\.50/);
  assert.equal((query.match(/current_total_price:445\.00/g) ?? []).length, 1);
});

test('normalizes CrediMatch discrepancy and transaction responses without inventing fields', () => {
  const result = normalizeCrediMatchChargebacks({
    tenantId: 'tenant-primary', discrepancyId: '21893735', receivedAt: '2026-09-29T12:00:00Z',
    discrepancyPayload: { discrepancies: [{ id: 21893735, dealTime: '2026-09-28T10:01:00Z', originalAmount: 349.9, last4Digits: '4242', transactionId: 55, discrepancyType: { description: 'הכחשה' } }] },
    transactionPayloads: [{ transactions: [{ id: 55, uid: 'provider-uid-55', grossAmount: 349.9, currency: { translatedCurrencyType: 'ILS' }, creditAndDebits: [{ expectedNetAmount: 330 }] }] }],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].discrepancyId, '21893735');
  assert.equal(result[0].type, 'הכחשה');
  assert.equal(result[0].currency, 'ILS');
  assert.equal(result[0].providerUid, 'provider-uid-55');
  assert.equal(result[0].settlements[0].expectedNetAmount, 330);
});

test('links an exact chargeback using the shared provider uid even when Shopify hides card details', () => {
  const match = matchCrediMatchChargeback(chargeback({
    providerUid: 'payplus-uid-123', last4Digits: '1944', confirmationNumber: undefined,
  }), [order({
    amount: 349.9,
    payments: [{ paymentId: 'payplus-uid-123', amount: 349.9, currency: 'ILS', processedAt: '2026-09-28T10:00:30Z' }],
  })]);
  assert.equal(match.confidence, 'exact');
  assert.equal(match.orderNumber, '#123');
  assert.ok(match.reasons.includes('מזהה עסקה זהה'));
});

test('links an exact chargeback using authorization and amount', () => {
  const match = matchCrediMatchChargeback(chargeback(), [order()]);
  assert.equal(match.confidence, 'exact');
  assert.equal(match.orderNumber, '#123');
  assert.ok(match.reasons.includes('מספר אישור זהה'));
  assert.ok(match.comparisons.find((item) => item.key === 'amount')?.matched);
});

test('rejects an amount-and-time-only candidate when the card suffix is unavailable', () => {
  const candidate = order({ payments: [], amount: 349.9, createdAt: '2026-09-28T10:20:00Z' });
  const match = matchCrediMatchChargeback(chargeback({ confirmationNumber: undefined }), [candidate]);
  assert.equal(match.confidence, 'unmatched');
  assert.equal(match.orderNumber, undefined);
});

test('rejects a candidate when amount and authorization match but last four digits differ', () => {
  const candidate = order({ payments: [{ amount: 349.9, currency: 'ILS', processedAt: '2026-09-28T10:00:30Z', last4: '9999', confirmationNumber: 'AUTH77' }] });
  const match = matchCrediMatchChargeback(chargeback(), [candidate]);
  assert.equal(match.confidence, 'unmatched');
});

test('keeps a same-card same-amount candidate for manual verification', () => {
  const candidate = order({ payments: [{ amount: 349.9, currency: 'ILS', processedAt: '2026-09-30T10:00:30Z', last4: '4242' }] });
  const match = matchCrediMatchChargeback(chargeback({ confirmationNumber: undefined }), [candidate]);
  assert.equal(match.confidence, 'possible');
  assert.equal(match.orderNumber, '#123');
});

test('does not auto-confirm when two candidates score almost equally', () => {
  const first = order();
  const second = order({ shopifyOrderId: 'gid://shopify/Order/124', orderNumber: '#124' });
  assert.equal(matchCrediMatchChargeback(chargeback(), [first, second]).confidence, 'possible');
});
