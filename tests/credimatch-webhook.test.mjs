import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { discrepancyIdFromCrediMatchPath, parseCrediMatchWebhook } from '../lib/credimatch-webhook.ts';

test('extracts and deduplicates discrepancy ids from the supplied webhook shape', () => {
  const path = 'https://api.credimatch.co.il/reports/account-1/discrepancies?discrepancyId=123456';
  assert.deepEqual(parseCrediMatchWebhook({ events: [{ name: 'chargeback', paths: [path, path] }] }), {
    discrepancyIds: ['123456'], ignoredEvents: 0,
  });
});

test('never accepts an arbitrary URL from a webhook', () => {
  assert.throws(
    () => discrepancyIdFromCrediMatchPath('https://example.com/reports/account-1/discrepancies?discrepancyId=123456'),
    /CREDIMATCH_PATH_ORIGIN_INVALID/,
  );
});

test('validates chargeback event paths', () => {
  assert.throws(() => parseCrediMatchWebhook({ events: [{ name: 'chargeback', paths: [] }] }), /CREDIMATCH_CHARGEBACK_PATHS_EMPTY/);
  assert.throws(() => parseCrediMatchWebhook({ events: [{ name: 'chargeback', paths: [42] }] }), /CREDIMATCH_EVENT_PATHS_INVALID/);
});

