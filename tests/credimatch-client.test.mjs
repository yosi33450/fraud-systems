import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.CREDIMATCH_USERNAME = 'user';
process.env.CREDIMATCH_PASSWORD = 'password';
process.env.CREDIMATCH_ID = 'report-1';
process.env.x_cm_api_key = 'encrypted-api-key';
const api = await import('../lib/credimatch.server.ts');

test('authenticates with userName and calls the fixed discrepancy endpoint', async (context) => {
  globalThis.__crediMatchTokenCache = undefined;
  globalThis.__crediMatchAuthentication = undefined;
  const requests = [];
  context.mock.method(globalThis, 'fetch', async (input, init) => {
    requests.push({ url: String(input), init });
    if (String(input).endsWith('/authentication/authenticate')) return Response.json({ token: 'token-1', expiresIn: 3600 });
    return Response.json({ id: '123456' });
  });

  assert.deepEqual(await api.getCrediMatchDiscrepancy('123456'), { id: '123456' });
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[0].init.body), { userName: 'user', password: 'password' });
  assert.equal(requests[0].init.headers.x_cm_api_key, 'encrypted-api-key');
  assert.equal(requests[1].url, 'https://api.credimatch.co.il/reports/report-1/discrepancies?discrepancyId=123456');
  assert.equal(requests[1].init.headers.Authorization, 'Bearer token-1');
  assert.equal(requests[1].init.headers.x_cm_api_key, 'encrypted-api-key');
});

test('refreshes the token once after an upstream 401', async (context) => {
  globalThis.__crediMatchTokenCache = { token: 'stale', expiresAt: Date.now() + 60_000 };
  globalThis.__crediMatchAuthentication = undefined;
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async (input) => {
    calls += 1;
    if (String(input).endsWith('/authentication/authenticate')) return Response.json({ token: 'fresh', expiresIn: 3600 });
    if (calls === 1) return new Response('{}', { status: 401, headers: { 'Content-Type': 'application/json' } });
    return Response.json({ id: 'tx-1' });
  });
  assert.deepEqual(await api.getCrediMatchTransaction('tx-1'), { id: 'tx-1' });
  assert.equal(calls, 3);
});
