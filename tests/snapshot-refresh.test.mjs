import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotRefresh } from '../lib/snapshot-refresh.ts';

function setup(load, canRefresh = () => true) {
  const states = [], values = [];
  const refresh = createSnapshotRefresh({ load, canRefresh, state: s => states.push(s), apply: v => values.push(v) });
  return { ...refresh, states, values };
}
test('background refresh never shows loading and keeps existing UI on transient failure', async () => {
  const r = setup(async () => 42);
  await r.refresh(true);
  assert.deepEqual(r.states, ['live']);
  assert.deepEqual(r.values, [42]);
  const failed = setup(async () => { throw Error('offline'); });
  await failed.refresh(true);
  assert.deepEqual(failed.states, []);
  await failed.refresh(true); await failed.refresh(true);
  assert.deepEqual(failed.states, ['error']);
});
test('hidden or editing context skips automatic reads', async () => {
  const r = setup(async () => { throw Error('must not fetch'); }, () => false);
  await r.refresh(true);
  assert.deepEqual(r.states, []);
});
test('expired login stops polling and is not a sync error', async () => {
  let calls = 0;
  const r = setup(async () => { calls++; throw Error('SESSION_EXPIRED'); });
  await r.refresh(true); await r.refresh(true);
  assert.equal(calls, 1);
  assert.deepEqual(r.states, ['expired']);
});
test('no overlapping polls; interrupted background result cannot overwrite an action', async () => {
  let done, calls = 0;
  const r = setup(() => { calls++; return new Promise(resolve => { done = resolve; }); });
  const pending = r.refresh(true);
  await r.refresh(true);
  assert.equal(calls, 1);
  r.interrupt(); done(123); await pending;
  assert.deepEqual(r.values, []);
});
test('manual refresh supersedes background and user interaction does not cancel initial loading', async () => {
  let done, calls = 0;
  const r = setup(() => ++calls === 1 ? new Promise(resolve => { done = resolve; }) : Promise.resolve('fresh'));
  const pending = r.refresh(true);
  await r.refresh(); done('old'); await pending;
  assert.deepEqual(r.values, ['fresh']);
  assert.deepEqual(r.states, ['loading', 'live']);
  const initial = setup(async () => 'initial');
  const p = initial.refresh(); initial.interrupt(); await p;
  assert.deepEqual(initial.values, ['initial']);
});
test('editing started during request prevents applying results', async () => {
  let done, allowed = true;
  const r = setup(() => new Promise(resolve => { done = resolve; }), () => allowed);
  const pending = r.refresh(true); allowed = false; done(1); await pending;
  assert.deepEqual(r.values, []);
});
