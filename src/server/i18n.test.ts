import assert from 'node:assert/strict';
import test from 'node:test';
import { text } from '../lib/i18n.ts';
import { app } from './app.ts';
import { addTask } from './data.ts';
import {
  CHILD_SESSION_COOKIE,
  CHILD_SESSION_SECONDS,
  PARENT_SESSION_COOKIE,
  PARENT_SESSION_SECONDS,
  sha256,
} from './http.ts';
import { deliverMagicLink, magicLinkMessage } from './mail.ts';
import { createDb, ORIGIN, SECRET } from './testing.ts';

test('magic link email is English first and Chinese below', () => {
  const url = 'https://kid.example/auth/verify?token=abc<safe>';
  const message = magicLinkMessage(url);
  const en = message.text.indexOf('Kid Star Rewards');
  const zh = message.text.indexOf('儿童星级奖励系统');
  assert.ok(en >= 0);
  assert.ok(zh > en);
  assert.ok(message.text.indexOf('Use this link') < message.text.indexOf('点击链接登录家长端'));
  assert.ok(message.html.indexOf('Kid Star Rewards') < message.html.indexOf('儿童星级奖励系统'));
  assert.ok(message.html.indexOf('15 minutes') < message.html.indexOf('15 分钟'));
  assert.match(message.subject, /^Kid Star Rewards/);
  assert.match(message.subject, /儿童星级奖励系统/);
  assert.match(message.html, /&lt;safe&gt;/);
  assert.doesNotMatch(message.html, /abc<safe>/);
  assert.ok(message.text.includes(url));
});

test('deliverMagicLink sends the bilingual body and does not change the sender path', async () => {
  const calls: { url: string; body: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body ?? '') });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    const url = 'https://kid.example/auth/verify?token=one';
    const sent = await deliverMagicLink({ RESEND_API_KEY: 'test-key', EMAIL_FROM: 'Kid Star Rewards <noreply@example.com>' } as Env, 'parent@example.com', url);
    assert.equal(sent.channel, 'resend');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    const body = JSON.parse(calls[0].body) as { subject: string; text: string; html: string };
    assert.ok(body.text.indexOf('Kid Star Rewards') < body.text.indexOf('儿童星级奖励系统'));
    assert.ok(body.html.indexOf('Kid Star Rewards') < body.html.indexOf('儿童星级奖励系统'));
    assert.match(body.subject, /Kid Star Rewards/);
  } finally {
    globalThis.fetch = original;
  }
});

test('API copy defaults to English and follows ks_lang, not Accept-Language', async () => {
  const { env } = createDb();
  const english = await app.fetch(request({ email: 'not-an-email' }, { 'accept-language': 'zh-CN,zh;q=0.9' }), env);
  assert.equal(english.status, 400);
  const englishBody = (await english.json()) as { message: string };
  assert.equal(englishBody.message, text('en').emailInvalid);

  const chinese = await app.fetch(request({ email: 'not-an-email' }, { cookie: 'ks_lang=zh-CN' }), env);
  assert.equal(chinese.status, 400);
  const chineseBody = (await chinese.json()) as { message: string };
  assert.equal(chineseBody.message, text('zh-CN').emailInvalid);

  const sent = await app.fetch(request({ email: 'willis.parent1@example.com' }), env);
  assert.equal(sent.status, 200);
  const sentBody = (await sent.json()) as { message: string };
  assert.equal(sentBody.message, text('en').magicSent);
  assert.equal(sent.headers.getSetCookie().length, 0);
});

test('a language cookie is not a session and passkey gate codes stay the same', async () => {
  assert.equal(PARENT_SESSION_SECONDS, 60 * 60 * 24 * 14);
  assert.equal(CHILD_SESSION_SECONDS, 60 * 60 * 48);
  const { env, sqlite } = createDb();
  const anonymous = await app.fetch(
    new Request(`${ORIGIN}/api/parent/state`, { headers: { cookie: 'ks_lang=zh-CN', 'accept-language': 'en' } }),
    env,
  );
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.getSetCookie().length, 0);
  const anonBody = (await anonymous.json()) as { message: string };
  assert.equal(anonBody.message, '请先登录');

  const token = `parent-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + PARENT_SESSION_SECONDS * 1000).toISOString();
  sqlite
    .prepare(
      `INSERT INTO sessions (id, token_hash, role, family_id, parent_id, expires_at, created_at)
       VALUES (?, ?, 'parent', 'fam_demo', 'par_demo_1', ?, ?)`,
    )
    .run(crypto.randomUUID(), await sha256(`${SECRET}:${token}`), expires, now);
  const locked = await app.fetch(
    new Request(`${ORIGIN}/api/parent/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        cookie: `${PARENT_SESSION_COOKIE}=${encodeURIComponent(token)}; ks_lang=en`,
      },
      body: JSON.stringify({ name: 'Wash up', points: 2 }),
    }),
    env,
  );
  assert.equal(locked.status, 403);
  const lockedBody = (await locked.json()) as { error: string; message: string };
  assert.equal(lockedBody.error, 'passkey_required');
  assert.equal(lockedBody.message, text('en').passkeyRequired);
  assert.equal(locked.headers.getSetCookie().some((cookie) => cookie.startsWith('ks_lang=')), false);
  assert.equal(locked.headers.getSetCookie().some((cookie) => cookie.startsWith(`${CHILD_SESSION_COOKIE}=`)), false);
});

test('new activity log lines use the selected language', async () => {
  const { env, sqlite } = createDb();
  await addTask(env.DB, 'fam_demo', 'Wash up', 2, 'en');
  await addTask(env.DB, 'fam_demo', '洗碗', 1, 'zh-CN');
  const rows = sqlite.prepare('SELECT message FROM activity_log ORDER BY rowid DESC LIMIT 2').all() as { message: string }[];
  assert.match(rows[0].message, /洗碗/);
  assert.match(rows[0].message, /每日任务/);
  assert.match(rows[1].message, /Wash up/);
  assert.match(rows[1].message, /daily task/i);
});

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/auth/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}
