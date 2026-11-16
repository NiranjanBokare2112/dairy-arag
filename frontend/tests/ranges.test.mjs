import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetRange, customRange, rangeFromQuery, rangeDays, MAX_RANGE_DAYS } from '../public/src/lib/ranges.js';

const T = '2026-11-08';

test('preset ranges include today', () => {
  assert.deepEqual(presetRange('today', T), { from: T, to: T });
  assert.deepEqual(presetRange('7', T), { from: '2026-11-02', to: T });
  assert.deepEqual(presetRange('15', T), { from: '2026-10-25', to: T });
  assert.deepEqual(presetRange('30', T), { from: '2026-10-10', to: T });
  assert.equal(rangeDays(presetRange('30', T)), 30);
  assert.throws(() => presetRange('x', T));
});

test('custom range: swaps reversed dates, never goes past today, capped length', () => {
  assert.deepEqual(customRange('2026-11-05', '2026-11-01', T), { from: '2026-11-01', to: '2026-11-05' });
  assert.deepEqual(customRange('2026-11-01', '2026-12-31', T), { from: '2026-11-01', to: T });
  assert.deepEqual(customRange('2026-12-01', '2026-12-31', T), { from: T, to: T });
  assert.equal(rangeDays(customRange('2020-01-01', T, T)), MAX_RANGE_DAYS);
  assert.equal(customRange('', T, T), null);
  assert.equal(customRange('01/11/2026', T, T), null);
});

test('range from URL query, default today', () => {
  assert.deepEqual(rangeFromQuery({}, T), { from: T, to: T, preset: 'today' });
  assert.deepEqual(rangeFromQuery({ range: '7' }, T), { from: '2026-11-02', to: T, preset: '7' });
  assert.deepEqual(rangeFromQuery({ range: '999' }, T), { from: T, to: T, preset: 'today' });
  assert.deepEqual(rangeFromQuery({ from: '2026-10-01', to: '2026-10-10' }, T), { from: '2026-10-01', to: '2026-10-10', preset: 'custom' });
  assert.equal(rangeFromQuery({ from: 'bad', to: T }, T).preset, 'today');
});
