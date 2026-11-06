import assert from 'node:assert/strict';
import test from 'node:test';
import { isTimeZone, localDateISO, localTimeHM } from './time.ts';

test('local date follows the family timezone across midnight', () => {
  const beforeMidnight = new Date('2026-11-05T15:59:00.000Z');
  const afterMidnight = new Date('2026-11-05T16:30:00.000Z');
  assert.equal(localDateISO('Asia/Hong_Kong', beforeMidnight), '2026-11-05');
  assert.equal(localDateISO('Asia/Hong_Kong', afterMidnight), '2026-11-06');
  assert.equal(localDateISO('UTC', afterMidnight), '2026-11-05');
});

test('log clock matches the prototype seed time in Hong Kong', () => {
  assert.equal(localTimeHM('Asia/Hong_Kong', '2026-11-05T07:22:00.000Z'), '15:22');
});

test('rejects unknown timezones', () => {
  assert.equal(isTimeZone('Asia/Hong_Kong'), true);
  assert.equal(isTimeZone('Not/AZone'), false);
});
