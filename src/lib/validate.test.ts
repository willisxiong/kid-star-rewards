import assert from 'node:assert/strict';
import test from 'node:test';
import { copy, normalizeFamilyCode, parseName, parsePoints } from './validate.ts';

test('reward validation copy is not the task-name toast', () => {
  assert.notEqual(copy.rewardInvalid, copy.taskInvalid);
  assert.match(copy.rewardInvalid, /奖励名称/);
  assert.match(copy.taskInvalid, /任务名称/);
});

test('parse helpers reject empty and non-integers', () => {
  assert.equal(parseName('  帮忙洗碗  '), '帮忙洗碗');
  assert.equal(parseName('   '), null);
  assert.equal(parsePoints('4'), 4);
  assert.equal(parsePoints(0), null);
  assert.equal(parsePoints('2.5'), null);
  assert.equal(parsePoints(-1), null);
  assert.equal(normalizeFamilyCode(' star-4821 '), 'STAR-4821');
  assert.equal(normalizeFamilyCode('no'), null);
});
