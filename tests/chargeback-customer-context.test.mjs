import assert from 'node:assert/strict';
import test from 'node:test';
import { chargebackCustomerKey, relatedCustomerChargebacks } from '../lib/chargeback-customer-context.ts';

const chargeback = (id, email, storeId = 'store-1', confidence = 'exact') => ({
  id, discrepancyId: id, receivedAt: '2026-10-01T10:00:00Z',
  match: { confidence, storeId, email },
});

test('groups only exact matches from the same store and normalized email', () => {
  const current = chargeback('1', 'Person@Example.com');
  const same = chargeback('2', ' person@example.com ');
  const otherStore = chargeback('3', 'person@example.com', 'store-2');
  const uncertain = chargeback('4', 'person@example.com', 'store-1', 'possible');
  assert.equal(chargebackCustomerKey(current), 'store-1:person@example.com');
  assert.deepEqual(relatedCustomerChargebacks(current, [current, same, otherStore, uncertain]).map((item) => item.id), ['2']);
});

test('does not group unknown or placeholder addresses', () => {
  assert.equal(chargebackCustomerKey(chargeback('1', '')), undefined);
  assert.equal(chargebackCustomerKey(chargeback('2', 'general@example.com')), undefined);
  assert.equal(chargebackCustomerKey(chargeback('3', 'not-an-email')), undefined);
});
