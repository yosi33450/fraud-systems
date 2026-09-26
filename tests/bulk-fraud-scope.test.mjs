import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const api = await import('../lib/operational-store.ts');
const clean = api.exportOperationalState();

test('bulk fraud scope includes only open orders with exact buyer identity in the same shop', () => {
  api.restoreOperationalState(clean);
  const first = api.connectShopifyStore({ tenantId: 'scope-a', name: 'First', domain: 'first.myshopify.com', accessToken: 'test', clientSecret: 'test', expiresIn: 10000 });
  const second = api.connectShopifyStore({ tenantId: 'scope-a', name: 'Second', domain: 'second.myshopify.com', accessToken: 'test', clientSecret: 'test', expiresIn: 10000 });
  const create = (store, id, email, customerId) => api.ingestShopifyOrder({ storeId: store.id, webhookId: `scope-${id}`, topic: 'HISTORICAL_SYNC', payload: {
    id: String(id), name: `#${id}`, created_at: '2026-09-25T12:00:00Z', email, total_price: 2500,
    customer: customerId ? { admin_graphql_api_id: customerId } : undefined,
    browser_ip: '203.0.113.9',
  } }).case;
  const anchor = create(first, 1, 'buyer@example.com', 'gid://shopify/Customer/1');
  const sameEmail = create(first, 2, 'buyer@example.com', 'gid://shopify/Customer/2');
  const sameCustomer = create(first, 3, 'changed@example.com', 'gid://shopify/Customer/1');
  create(first, 4, 'redeemer@example.com', 'gid://shopify/Customer/4');
  create(second, 5, 'buyer@example.com', 'gid://shopify/Customer/1');
  assert.deepEqual(new Set(api.relatedOpenCases('scope-a', anchor.id).map((item) => item.id)), new Set([anchor.id, sameEmail.id, sameCustomer.id]));
  api.decideCase('scope-a', sameEmail.id, 'false-positive');
  assert.deepEqual(new Set(api.relatedOpenCases('scope-a', anchor.id).map((item) => item.id)), new Set([anchor.id, sameCustomer.id]));
});

test('shared payment-service email never expands fraud scope', () => {
  api.restoreOperationalState(clean);
  const store = api.connectShopifyStore({ tenantId: 'scope-b', name: 'First', domain: 'third.myshopify.com', accessToken: 'test', clientSecret: 'test', expiresIn: 10000 });
  const create = (id) => api.ingestShopifyOrder({ storeId: store.id, webhookId: `payplus-${id}`, topic: 'HISTORICAL_SYNC', payload: {
    id: String(id), name: `#${id}`, created_at: '2026-09-25T12:00:00Z', email: 'general-customer@payplus.co.il', total_price: 2500,
    customer: { first_name: 'General', last_name: 'Customer PayPlus', admin_graphql_api_id: 'gid://shopify/Customer/technical' },
  } }).case;
  const anchor = create(1);
  create(2);
  assert.deepEqual(api.relatedOpenCases('scope-b', anchor.id).map((item) => item.id), [anchor.id]);
});
