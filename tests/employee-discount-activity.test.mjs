import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const api = await import('../lib/operational-store.ts');
const initial = api.exportOperationalState();

function setup(tenantId, domain) {
  api.restoreOperationalState(initial);
  return api.connectShopifyStore({ tenantId, name: 'Test store', domain, accessToken: 'test', clientId: 'test', clientSecret: 'test', expiresIn: 10000 });
}

function order(store, id, codes, extra = {}) {
  return api.ingestShopifyOrder({ storeId: store.id, webhookId: `coupon-${id}`, topic: 'HISTORICAL_SYNC', payload: {
    id: String(id), name: `#${id}`, created_at: new Date().toISOString(), email: 'buyer@example.com',
    total_price: 200, discount_codes: codes, ...extra,
  } });
}

test('all used coupon codes appear by default, while OVED remains the employee prefix', () => {
  const store = setup('coupon-test', 'strongful.myshopify.com');
  assert.equal(api.getEmployeeSettings('coupon-test').couponPrefix, 'oved');
  order(store, 1, ['OVEDmika', 'ovedTX30', 'summer']);
  order(store, 2, ['SUMMER']);
  const activity = api.getDashboardSnapshot('coupon-test').employeeDiscountActivity;
  assert.equal(activity.totalOrders, 2);
  assert.equal(activity.totalAmount, 400);
  assert.equal(activity.ordersChecked, 2);
  assert.equal(activity.ordersWithAnyDiscountCode, 2);
  assert.deepEqual(activity.codes.map((item) => [item.code, item.orders]), [['summer', 2], ['ovedmika', 1], ['ovedtx30', 1]]);
  assert.deepEqual(api.getObservedEmployeeDiscountCodes('coupon-test', store.id, 'OVED'), ['ovedmika', 'ovedtx30']);
  assert.equal(activity.recentUses.filter((use) => use.code === 'summer').length, 2);
});

test('code ownership is distinct from buyer identity and unassigned codes remain visible', () => {
  const store = setup('coupon-test', 'strongful.myshopify.com');
  const employee = api.addEmployee('coupon-test', { name: 'Mika', email: 'mika@example.com', department: 'Sales', couponCodes: ['OVEDMIKA'] });
  order(store, 1, ['ovedmika']);
  order(store, 2, ['ovedguest'], { email: 'mika@example.com' });
  const activity = api.getEmployeeDiscountActivity('coupon-test');
  const owned = activity.recentUses.find((use) => use.code === 'ovedmika');
  const unassigned = activity.recentUses.find((use) => use.code === 'ovedguest');
  assert.equal(owned.assignedEmployeeId, employee.id);
  assert.equal(owned.buyerMatchesEmployee, false);
  assert.equal(unassigned.assignedEmployeeId, undefined);
  assert.equal(unassigned.buyerMatchesEmployee, false);
});

test('coupon usage is visible without an employee prefix and other tenants stay isolated', () => {
  const store = setup('coupon-test', 'another.myshopify.com');
  order(store, 1, ['oved30']);
  assert.equal(api.getEmployeeDiscountActivity('coupon-test').totalOrders, 1);
  assert.equal(api.getEmployeeDiscountActivity('coupon-test').codes[0].code, 'oved30');
  api.saveEmployeeSettings('coupon-test', { ...api.getEmployeeSettings('coupon-test'), couponPrefix: 'oved' });
  assert.equal(api.getEmployeeDiscountActivity('coupon-test').totalOrders, 1);
  assert.equal(api.getEmployeeDiscountActivity('other-tenant').totalOrders, 0);
});

test('legacy blank Strongful setting migrates, but an explicitly cleared prefix stays cleared', () => {
  setup('coupon-test', 'strongful.myshopify.com');
  const legacy = api.exportOperationalState();
  legacy.employeeSettingsByTenant = [['coupon-test', { ...api.getEmployeeSettings('coupon-test'), couponPrefix: '' }]];
  api.restoreOperationalState(legacy);
  assert.equal(api.getEmployeeSettings('coupon-test').couponPrefix, 'oved');
  api.saveEmployeeSettings('coupon-test', { ...api.getEmployeeSettings('coupon-test'), couponPrefix: '' });
  const explicitlyCleared = api.exportOperationalState();
  api.restoreOperationalState(explicitlyCleared);
  assert.equal(api.getEmployeeSettings('coupon-test').couponPrefix, '');
});
