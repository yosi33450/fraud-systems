import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCrediMatchChargeback, normalizeCrediMatchChargebacks, paymentFingerprintsFromShopify, shopifyChargebackSearchQuery } from '../lib/credimatch-matching.ts';
import { normalizePayPlusPayload } from '../lib/payplus.server.ts';

const chargeback = (overrides = {}) => ({
  id: 'credimatch-21893735', tenantId: 'tenant-primary', discrepancyId: '21893735', receivedAt: '2026-09-29T12:00:00Z',
  dealTime: '2026-09-28T10:01:00Z', dealTimePrecise: true, originalAmount: 349.9, currency: 'ILS', last4Digits: '4242', confirmationNumber: 'AUTH-77',
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
    merchantReference: undefined,
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
    transactionPayloads: [{ transactions: [{ id: 55, uid: 'provider-uid-55', transactionDate: '2026-09-28T10:02:00Z', grossAmount: 349.9, currency: { translatedCurrencyType: 'ILS' }, creditAndDebits: [{ expectedNetAmount: 330 }] }] }],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].discrepancyId, '21893735');
  assert.equal(result[0].type, 'הכחשה');
  assert.equal(result[0].currency, 'ILS');
  assert.equal(result[0].providerUid, 'provider-uid-55');
  assert.equal(result[0].dealTime, '2026-09-28T10:02:00Z');
  assert.equal(result[0].dealTimePrecise, true);
  assert.equal(result[0].settlements[0].expectedNetAmount, 330);
});

test('links only a unique PayPlus more_info reference', () => {
  const match = matchCrediMatchChargeback(chargeback({
    payplus: { status: 'found', merchantReference: 'roC52xUh72jCtVT1OlngYqj6L' },
  }), [order({
    payments: [{ merchantReference: 'roc52xuh72jctvt1olngyqj6l', amount: 1 }],
  })]);
  assert.equal(match.confidence, 'exact');
  assert.equal(match.orderNumber, '#123');
  assert.deepEqual(match.reasons, ['אסמכתת PayPlus זהה']);
  assert.equal(match.comparisons[0]?.key, 'reference');
});

test('reads PayPlus card suffix and terminal from the actual top-level response fields', () => {
  const evidence = normalizePayPlusPayload('7641146', { data: {
    approval_num: '7641146', four_digits: '7202', terminal_merchant_number: '7149427013',
    more_info: 'rGRBnyao738mUAOvYiFd3rQd7', amount: 400,
  } });
  assert.equal(evidence.cardLast4, '7202');
  assert.equal(evidence.terminalNumber, '7149427013');
  assert.equal(evidence.merchantReference, 'rGRBnyao738mUAOvYiFd3rQd7');
});

test('never links a PayPlus payment rejected as a card conflict', () => {
  const result = matchCrediMatchChargeback(chargeback({
    payplus: { status: 'conflict', merchantReference: 'same-payment-id' },
  }), [order({ payments: [{ merchantReference: 'same-payment-id' }] })]);
  assert.equal(result.confidence, 'unmatched');
});

test('preserves Shopify remote reference as the PayPlus more_info key', () => {
  const [payment] = paymentFingerprintsFromShopify([{
    receipt: { more_info: 'roC52xUh72jCtVT1OlngYqj6L' }, amount: '445',
  }], 'ILS');
  assert.equal(payment.merchantReference, 'roC52xUh72jCtVT1OlngYqj6L');
  assert.equal(payment.gatewayReference, undefined);
});

test('uses Shopify Payment ID as the PayPlus more_info key', () => {
  const [payment] = paymentFingerprintsFromShopify([{
    payment_id: 'roC52xUh72jCtVT1OlngYqj6L', amount: '445',
  }], 'ILS');
  assert.equal(payment.merchantReference, 'roC52xUh72jCtVT1OlngYqj6L');
});

test('keeps a distinct receipt more_info as a second exact reference', () => {
  const payments = paymentFingerprintsFromShopify([{
    payment_id: 'shopify-payment-id', receipt: { more_info: 'payplus-merchant-reference' }, amount: '445',
  }], 'ILS');
  assert.deepEqual(payments.map((payment) => payment.merchantReference), ['shopify-payment-id', 'payplus-merchant-reference']);
  assert.equal(matchCrediMatchChargeback(chargeback({
    payplus: { status: 'found', merchantReference: 'payplus-merchant-reference' },
  }), [order({ payments })]).confidence, 'exact');
});

test('accepts an exact Shopify receipt payment_id when the top-level payment ID differs', () => {
  const payments = paymentFingerprintsFromShopify([{
    payment_id: 'top-level-id', receipt: { payment_id: 'payplus-more-info' }, amount: '445',
  }], 'ILS');
  assert.deepEqual(payments.map((payment) => payment.merchantReference), ['top-level-id', 'payplus-more-info']);
  assert.equal(matchCrediMatchChargeback(chargeback({
    payplus: { status: 'found', merchantReference: 'payplus-more-info' },
  }), [order({ payments })]).confidence, 'exact');
});

test('does not link identical amount, card, approval or date without PayPlus more_info', () => {
  const match = matchCrediMatchChargeback(chargeback(), [order()]);
  assert.equal(match.confidence, 'unmatched');
  assert.equal(match.orderNumber, undefined);
});

test('does not link when PayPlus more_info is absent from Shopify', () => {
  const match = matchCrediMatchChargeback(chargeback({
    payplus: { status: 'found', merchantReference: 'roC52xUh72jCtVT1OlngYqj6L' },
  }), [order()]);
  assert.equal(match.confidence, 'unmatched');
});

test('leaves duplicate PayPlus more_info references for review', () => {
  const reference = 'roC52xUh72jCtVT1OlngYqj6L';
  const match = matchCrediMatchChargeback(chargeback({ payplus: { status: 'found', merchantReference: reference } }), [
    order({ payments: [{ merchantReference: reference }] }),
    order({ shopifyOrderId: 'gid://shopify/Order/124', orderNumber: '#124', payments: [{ merchantReference: reference }] }),
  ]);
  assert.equal(match.confidence, 'ambiguous');
  assert.equal(match.candidates?.length, 2);
});
