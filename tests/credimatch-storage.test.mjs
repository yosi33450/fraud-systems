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
