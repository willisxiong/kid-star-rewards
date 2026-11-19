import assert from 'node:assert/strict';
import test from 'node:test';
import { text } from './i18n.ts';
import { normalizeFamilyCode, parseDailyLimit, parseName, parsePoints, parseTaskKind } from './validate.ts';

test('reward validation copy is not the task-name toast', () => {
  for (const locale of ['en', 'zh-CN'] as const) {
    const copy = text(locale);
    assert.notEqual(copy.rewardInvalid, copy.taskInvalid);
  }
  assert.match(text('en').rewardInvalid, /reward name/i);
  assert.match(text('en').taskInvalid, /task name/i);
  assert.match(text('zh-CN').rewardInvalid, /奖励名称/);
  assert.match(text('zh-CN').taskInvalid, /任务名称/);
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

test('daily check-in count is 1–9 and task kind defaults to daily', () => {
  assert.equal(parseDailyLimit(undefined), null);
  assert.equal(parseDailyLimit(''), null);
  assert.equal(parseDailyLimit('1'), 1);
  assert.equal(parseDailyLimit(9), 9);
  assert.equal(parseDailyLimit(0), null);
  assert.equal(parseDailyLimit(10), null);
  assert.equal(parseDailyLimit('2.5'), null);
  assert.equal(parseTaskKind(undefined), 'daily');
  assert.equal(parseTaskKind('daily'), 'daily');
  assert.equal(parseTaskKind('starburst'), 'starburst');
  assert.equal(parseTaskKind('weekly'), null);
});
