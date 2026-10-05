import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const store = await import('../lib/operational-store.ts');
const initial = store.exportOperationalState();

test('dedicated CrediMatch hydration merges by discrepancy id', () => {
  const empty = structuredClone(initial);
  empty.chargebacks = [];
  store.restoreOperationalState(empty);
  const base = {
    id: 'credimatch-123', tenantId: 'tenant-primary', discrepancyId: '123', receivedAt: '2026-09-30T00:00:00Z',
    amount: 10, settlements: [],
  };
  store.restoreCrediMatchChargebacks([base]);
  store.restoreCrediMatchChargebacks([{ ...base, amount: 20, status: 'open' }]);
  const chargebacks = store.exportCrediMatchChargebacks();
  assert.equal(chargebacks.length, 1);
  assert.equal(chargebacks[0].amount, 20);
  assert.equal(chargebacks[0].status, 'open');
  store.restoreOperationalState(initial);
});

test('historical match candidates stay out of the operational order ledger', () => {
  const tenantId = 'candidate-only-tenant';
  const chargeback = {
    id: 'credimatch-candidate-only', tenantId, discrepancyId: 'candidate-only', receivedAt: '2026-09-30T00:00:00Z',
    dealTime: '2026-03-15T10:01:00Z', originalAmount: 445, currency: 'ILS', last4Digits: '1944', settlements: [],
    payplus: { status: 'found', merchantReference: 'payplus-1944' },
  };
  store.restoreCrediMatchChargebacks([chargeback]);
  store.restoreCrediMatchOrderCandidates([{
    tenantId, storeId: 'store-1', shopifyOrderId: 'gid://shopify/Order/1944', orderNumber: '#1944',
    customer: 'Historical Buyer', email: 'buyer@example.com', amount: 445, currency: 'ILS', createdAt: '2026-03-15T10:00:00Z',
    payments: [{ amount: 445, currency: 'ILS', processedAt: '2026-03-15T10:00:30Z', last4: '1944', merchantReference: 'payplus-1944' }],
  }]);

  assert.equal(store.exportOperationalState().orders.some((order) => order.tenantId === tenantId), false);
  const snapshot = store.getDashboardSnapshot(tenantId);
  assert.equal(snapshot.chargebacks[0].match.orderNumber, '#1944');
  assert.equal(snapshot.cases.length, 0);
  store.restoreOperationalState(initial);
});

test('a live order without gateway reference does not hide its verified historical payment', () => {
  const tenantId = 'candidate-overlap-tenant';
  const orderId = 'gid://shopify/Order/6111350292620';
  const state = structuredClone(initial);
  state.orders.push({
    tenantId, storeId: 'store-1', shopifyOrderId: orderId, orderNumber: '542939',
    email: 'buyer@example.com', amount: 357, currency: 'ILS', createdAt: '2026-09-07T15:49:27Z',
    payments: [{ amount: 357, currency: 'ILS', processedAt: '2026-09-07T15:49:27Z' }],
  });
  store.restoreOperationalState(state);
  store.restoreCrediMatchChargebacks([{
    id: 'credimatch-overlap', tenantId, discrepancyId: '21961008', receivedAt: '2026-09-07T15:49:27Z',
    dealTime: '2026-09-07T15:49:27Z', originalAmount: 357, currency: 'ILS', settlements: [],
    payplus: { status: 'found', merchantReference: 'rqVcD866WVAX171kyKuDB0Qd2' },
  }]);
  store.restoreCrediMatchOrderCandidates([{
    tenantId, storeId: 'store-1', shopifyOrderId: orderId, orderNumber: '542939',
    email: 'buyer@example.com', amount: 357, currency: 'ILS', createdAt: '2026-09-07T15:49:27Z',
    payments: [{ amount: 357, currency: 'ILS', merchantReference: 'rqVcD866WVAX171kyKuDB0Qd2' }],
  }]);
  assert.equal(store.getDashboardSnapshot(tenantId).chargebacks[0].match.orderNumber, '542939');
  store.restoreOperationalState(initial);
});
