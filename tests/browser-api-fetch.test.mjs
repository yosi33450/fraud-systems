import test from 'node:test';
import assert from 'node:assert/strict';
import { browserApiFetch } from '../lib/browser-api-fetch.ts';

test('renews an expired token once only after an auth-gate rejection, preserving mutation body', async () => {
  let tokens = 0;
  const requests = [];
  globalThis.window = { self: {}, top: {}, location: { href: 'https://app.example/shopify', origin:'https://app.example' }, shopify: { idToken: async () => `token-${++tokens}` }, fetch: async request => {
    requests.push({ auth: request.headers.get('Authorization'), body: await request.text(), credentials: request.credentials });
    return requests.length === 1 ? new Response('', {status:401,headers:{'X-Shopify-Retry-Invalid-Session-Request':'1'}}) : new Response('ok');
  }};
  try {
    assert.equal((await browserApiFetch('/api/tenants/tenant-primary/rules', {method:'POST',body:'{"enabled":true}'})).status,200);
    assert.deepEqual(requests.map(r=>r.auth),['Bearer token-1','Bearer token-2']);
    assert.ok(requests.every(r=>r.body === '{"enabled":true}' && r.credentials === 'omit'));
  } finally { delete globalThis.window; }
});

test('never sends Shopify tokens to another origin', async () => {
  let tokens = 0;
  globalThis.window = { self: {}, top: {}, location: { href:'https://app.example/shopify', origin:'https://app.example' }, shopify: {idToken:async()=>{tokens++;return 'secret';}}, fetch:async(input,init)=>{assert.equal(init?.headers,undefined);return new Response('ok');} };
  try { await browserApiFetch('https://other.example/api/test'); assert.equal(tokens,0); }
  finally { delete globalThis.window; }
});
