import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.CREDIMATCH_USERNAME = 'user';
process.env.CREDIMATCH_PASSWORD = 'password';
process.env.CREDIMATCH_ID = 'report-1';
process.env.x_cm_api_key = 'encrypted-api-key';
const api = await import('../lib/credimatch.server.ts');

test('authenticates with username and calls the fixed discrepancy endpoint', async (context) => {
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
  assert.deepEqual(JSON.parse(requests[0].init.body), { username: 'user', password: 'password' });
  assert.equal(requests[0].init.headers['x-cm-api-key'], 'encrypted-api-key');
  assert.equal(requests[0].init.headers.Accept, undefined);
  assert.equal(requests[0].init.cache, undefined);
  assert.equal(requests[1].url, 'https://api.credimatch.co.il/reports/report-1/discrepancies?discrepancyId=123456');
  assert.equal(requests[1].init.headers.Authorization, 'Bearer token-1');
  assert.equal(requests[1].init.headers['x-cm-api-key'], 'encrypted-api-key');
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

test('logs useful authentication failure diagnostics without leaking credentials', async (context) => {
  globalThis.__crediMatchTokenCache = undefined;
  globalThis.__crediMatchAuthentication = undefined;
  const errorLogs = [];
  context.mock.method(console, 'info', () => {});
  context.mock.method(console, 'error', (message) => errorLogs.push(String(message)));
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    error: 'gateway rejected encrypted-api-key for user with password',
    token: 'must-not-be-logged',
    detail: 'blocked before API',
  }), {
    status: 500,
    statusText: 'Internal Server Error',
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'cm-request-123' },
  }));

  await assert.rejects(() => api.getCrediMatchDiscrepancy('123456'), /CREDIMATCH_AUTH_FAILED_500/);
  const combined = errorLogs.join('\n');
  assert.match(combined, /CrediMatch authentication response/);
  assert.match(combined, /cm-request-123/);
  assert.match(combined, /blocked before API/);
  assert.doesNotMatch(combined, /encrypted-api-key/);
  assert.doesNotMatch(combined, /must-not-be-logged/);
  assert.doesNotMatch(combined, /password/);
});
