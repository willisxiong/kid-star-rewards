import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LANG_COOKIE,
  applyLanguageChoice,
  htmlLang,
  isSessionCookieName,
  languageCookie,
  localeFromCookieHeader,
  text,
} from './i18n.ts';

test('default language is English when nothing is stored', () => {
  assert.equal(localeFromCookieHeader(null), 'en');
  assert.equal(localeFromCookieHeader(''), 'en');
  assert.equal(localeFromCookieHeader('ks_parent_session=abc'), 'en');
  assert.equal(localeFromCookieHeader('ks_lang='), 'en');
  assert.equal(localeFromCookieHeader('ks_lang=zh'), 'en');
  assert.equal(localeFromCookieHeader('ks_lang=zh-Hans'), 'en');
  assert.equal(localeFromCookieHeader('ks_lang=fr'), 'en');
  assert.equal(htmlLang('en'), 'en');
  assert.equal(text('en').productName, 'Kid Star Rewards');
});

test('a stored ks_lang choice round-trips and sets html lang', () => {
  const choice = applyLanguageChoice('zh-CN', false);
  assert.ok(choice);
  assert.equal(choice.locale, 'zh-CN');
  assert.equal(choice.lang, 'zh-CN');
  assert.equal(htmlLang(choice.locale), 'zh-CN');
  assert.equal(localeFromCookieHeader(choice.cookie), 'zh-CN');
  assert.match(choice.cookie, new RegExp(`^${LANG_COOKIE}=zh-CN`));
  assert.match(choice.cookie, /Path=\//);
  assert.match(choice.cookie, /SameSite=Lax/);
  assert.match(choice.cookie, /Max-Age=31536000/);
  assert.doesNotMatch(choice.cookie, /HttpOnly/);
  assert.doesNotMatch(choice.cookie, /Secure/);
  assert.equal(isSessionCookieName(LANG_COOKIE), false);
  assert.equal(isSessionCookieName('ks_parent_session'), true);
  assert.equal(isSessionCookieName('ks_child_session'), true);
  assert.equal(isSessionCookieName('ks_session'), true);

  const secure = languageCookie('en', true);
  assert.match(secure, /Secure/);
  assert.equal(localeFromCookieHeader(secure), 'en');
  assert.equal(htmlLang('en'), 'en');
  assert.equal(applyLanguageChoice('zh', false), null);
  assert.equal(text('zh-CN').productName, '儿童星级奖励系统');
});

test('passkey warnings stay in both languages', () => {
  const en = text('en');
  const zh = text('zh-CN');
  for (const copy of [en, zh]) {
    assert.match(copy.loginHelp, /email|邮箱/);
    assert.match(copy.enrollWarn, /workers\.dev/);
    assert.match(copy.enrollWarn, /domain|域名/);
    assert.match(copy.keysWarn, /domain|域名/);
    assert.match(copy.enrollNote, /passkey|Passkey/i);
  }
  assert.match(en.enrollWarn, /will not move/);
  assert.match(zh.enrollWarn, /会失效/);
  assert.match(zh.loginHelp, /第一次登录请先用邮箱链接/);
  assert.equal(zh.keysAndSignIn, '密钥与登录');
  assert.equal(en.keysAndSignIn, 'Keys and sign-in');
});
