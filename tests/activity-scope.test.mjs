import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { inLastWeek, WEEK_MS, isCurrentCase, caseDate, chargebackDate } from '../lib/activity-scope.ts';
const now = Date.parse('2026-10-16T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
test('weekly scope includes boundary but excludes older, future and unknown dates', () => {
  assert.equal(inLastWeek(iso(now - WEEK_MS), now), true);
  for (const value of [iso(now - WEEK_MS - 1), iso(now + 1), '', 'unknown', '10.12.2026']) assert.equal(inLastWeek(value, now), false);
});
test('only untreated recent cases remain current; archive is the complement', () => {
  for (const status of ['new', 'review', 'action', 'fraud', 'resolved', 'false-positive']) {
    const item = { status, occurredAt: iso(now - 1000), evidence: [], createdAt: 'עכשיו' };
    assert.equal(isCurrentCase(item, now), ['new', 'review', 'action'].includes(status));
    assert.equal(isCurrentCase({ ...item, occurredAt: iso(now - WEEK_MS - 1) }, now), false);
  }
  assert.equal(caseDate({ createdAt: 'עכשיו', evidence: [{ timestamp: iso(now) }] }), iso(now));
});
test('chargebacks use dispute creation, never purchase or enrichment dates', () => {
  const item = { dealTime: iso(now - 90 * 86400000), creationTime: iso(now - 1000), receivedAt: iso(now) };
  assert.equal(inLastWeek(chargebackDate(item), now), true);
  assert.equal(inLastWeek(chargebackDate({ ...item, creationTime: iso(now - 30 * 86400000) }), now), false);
});
