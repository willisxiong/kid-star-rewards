import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.ts';
import {
  CHILD_SESSION_COOKIE,
  CHILD_SESSION_SECONDS,
  clearSessionCookie,
  PARENT_SESSION_COOKIE,
  PARENT_SESSION_SECONDS,
  sessionCookie,
  sha256,
} from './http.ts';
import { createDb, ORIGIN, SECRET } from './testing.ts';

test('child session is 48 hours and parent session stays 14 days', () => {
  assert.equal(CHILD_SESSION_SECONDS, 60 * 60 * 48);
  assert.equal(PARENT_SESSION_SECONDS, 60 * 60 * 24 * 14);
  const child = sessionCookie(CHILD_SESSION_COOKIE, 'child-token', `${ORIGIN}/api/auth/child`, CHILD_SESSION_SECONDS);
  const parent = sessionCookie(PARENT_SESSION_COOKIE, 'parent-token', `${ORIGIN}/auth/verify`, PARENT_SESSION_SECONDS);
  assert.match(child, /Max-Age=172800(?:;|$)/);
  assert.match(parent, /Max-Age=1209600(?:;|$)/);
  assert.match(child, /Secure/);
  assert.match(parent, /Secure/);
  const childExpires = /Expires=([^;]+)/.exec(child)?.[1];
  assert.ok(childExpires);
  const delta = new Date(childExpires).getTime() - Date.now();
  assert.ok(Math.abs(delta - CHILD_SESSION_SECONDS * 1000) < 5000);
  const cleared = clearSessionCookie(CHILD_SESSION_COOKIE, `${ORIGIN}/`);
  assert.match(child, new RegExp(`^${CHILD_SESSION_COOKIE}=`));
  assert.match(parent, new RegExp(`^${PARENT_SESSION_COOKIE}=`));
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
});

test('child bind cookie lasts 48 hours and reopens the kid session', async () => {
  const { env, sqlite } = createDb();
  const bound = await postChild(env, 'STAR-4821');
  assert.equal(bound.status, 303);
  assert.equal(bound.headers.get('cache-control'), 'private, no-store');
  assert.equal(new URL(bound.headers.get('location') ?? '', ORIGIN).pathname, '/kid');
  const setCookie = onlyCookie(bound);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /Max-Age=172800(?:;|$)/);
  const token = cookieValue(setCookie, CHILD_SESSION_COOKIE);
  const row = sqlite.prepare('SELECT expires_at FROM sessions').get() as { expires_at: string };
  const storedDelta = new Date(row.expires_at).getTime() - Date.now();
  assert.ok(Math.abs(storedDelta - CHILD_SESSION_SECONDS * 1000) < 5000);

  const state = await app.fetch(
    new Request(`${ORIGIN}/api/kid/state`, { headers: { cookie: `${CHILD_SESSION_COOKIE}=${token}` } }),
    env,
  );
  assert.equal(state.status, 200);
  assert.equal(state.headers.get('cache-control'), 'private, no-store');
  const body = (await state.json()) as { childName: string };
  assert.equal(body.childName, '小星');

  sqlite.prepare(`UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'`).run();
  const expired = await app.fetch(
    new Request(`${ORIGIN}/api/kid/state`, { headers: { cookie: `${CHILD_SESSION_COOKIE}=${token}` } }),
    env,
  );
  assert.equal(expired.status, 401);
  assert.equal(expired.headers.get('cache-control'), 'private, no-store');
});

test('a bad family code redirects back to the gate and does not set a session', async () => {
  const { env } = createDb();
  const denied = await postChild(env, 'NOPE');
  assert.equal(denied.status, 303);
  assert.equal(new URL(denied.headers.get('location') ?? '', ORIGIN).searchParams.get('bind'), 'invalid');
  assert.equal(denied.headers.getSetCookie().length, 0);
});

test('json child bind keeps the 48 hour cookie for API clients', async () => {
  const { env } = createDb();
  const response = await app.fetch(
    new Request(`${ORIGIN}/api/auth/child`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ familyCode: 'star-4821' }),
    }),
    env,
  );
  assert.equal(response.status, 200);
  const setCookie = onlyCookie(response);
  assert.match(setCookie, /Max-Age=172800(?:;|$)/);
  const body = (await response.json()) as { state?: { childName?: string } };
  assert.equal(body.state?.childName, '小星');
});

test('parent magic-link cookie is unchanged at 14 days', async () => {
  const { env, sqlite } = createDb();
  const token = 'parent-magic-link-token-0123456789';
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  sqlite
    .prepare(
      `INSERT INTO magic_links (id, parent_id, token_hash, expires_at, created_at)
       VALUES ('ml_1', 'par_demo_1', ?, ?, ?)`,
    )
    .run(await sha256(`${SECRET}:${token}`), expires, now);
  const response = await app.fetch(new Request(`${ORIGIN}/auth/verify?token=${encodeURIComponent(token)}`), env);
  assert.equal(response.status, 302);
  const setCookie = onlyCookie(response);
  assert.match(setCookie, /Max-Age=1209600(?:;|$)/);
  assert.match(setCookie, new RegExp(`^${PARENT_SESSION_COOKIE}=`));
  const row = sqlite.prepare(`SELECT expires_at FROM sessions WHERE role = 'parent'`).get() as { expires_at: string };
  const delta = new Date(row.expires_at).getTime() - Date.now();
  assert.ok(Math.abs(delta - PARENT_SESSION_SECONDS * 1000) < 5000);
});

test('localhost magic links stay on localhost even when APP_ORIGIN is pinned', async () => {
  const { env } = createDb({
    APP_ORIGIN: 'https://kid-star-rewards.xiongwei-fly.workers.dev',
    MAGIC_LINK_DEV_ECHO: '1',
  });
  const response = await app.fetch(
    new Request('http://localhost:4321/api/auth/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:4321' },
      body: JSON.stringify({ email: 'willis.parent1@example.com' }),
    }),
    env,
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { devLink?: string };
  assert.ok(body.devLink?.startsWith('http://localhost:4321/auth/verify?token='));
});

test('legacy ks_session is reissued under the role cookie and then cleared', async () => {
  const { env, sqlite } = createDb();
  const token = 'legacy-parent-token-0123456789abcd';
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  sqlite
    .prepare(
      `INSERT INTO sessions (id, token_hash, role, family_id, parent_id, expires_at, created_at)
       VALUES ('ses_legacy', ?, 'parent', 'fam_demo', 'par_demo_1', ?, ?)`,
    )
    .run(await sha256(`${SECRET}:${token}`), expires, now);
  const response = await app.fetch(
    new Request(`${ORIGIN}/api/parent/state`, { headers: { cookie: `ks_session=${encodeURIComponent(token)}` } }),
    env,
  );
  assert.equal(response.status, 200);
  const cookies = response.headers.getSetCookie();
  const parent = cookies.find((cookie) => cookie.startsWith(`${PARENT_SESSION_COOKIE}=`));
  const cleared = cookies.find((cookie) => cookie.startsWith('ks_session='));
  assert.ok(parent);
  assert.ok(cleared);
  assert.match(cleared, /Max-Age=0/);
  const maxAge = Number(/Max-Age=(\d+)/.exec(parent)?.[1]);
  assert.ok(Math.abs(maxAge - 3 * 24 * 60 * 60) < 5);
  const body = (await response.json()) as { hasPasskeys: boolean; parentEmail: string };
  assert.equal(body.hasPasskeys, false);
  assert.equal(body.parentEmail, 'willis.parent1@example.com');

  const next = await app.fetch(
    new Request(`${ORIGIN}/api/parent/state`, { headers: { cookie: `${PARENT_SESSION_COOKIE}=${token}` } }),
    env,
  );
  assert.equal(next.status, 200);
});

test('a legacy child cookie migrates without accepting a parent cookie on /api/kid', async () => {
  const { env } = createDb();
  const bound = await postChild(env, 'STAR-4821');
  const token = cookieValue(onlyCookie(bound), CHILD_SESSION_COOKIE);
  const migrated = await app.fetch(
    new Request(`${ORIGIN}/api/kid/state`, { headers: { cookie: `ks_session=${encodeURIComponent(token)}` } }),
    env,
  );
  assert.equal(migrated.status, 200);
  const cookies = migrated.headers.getSetCookie();
  assert.ok(cookies.some((cookie) => cookie.startsWith(`${CHILD_SESSION_COOKIE}=`)));
  assert.ok(cookies.some((cookie) => cookie.startsWith('ks_session=') && /Max-Age=0/.test(cookie)));

  const rejected = await app.fetch(
    new Request(`${ORIGIN}/api/kid/state`, { headers: { cookie: `${PARENT_SESSION_COOKIE}=${token}` } }),
    env,
  );
  assert.equal(rejected.status, 401);
});

function cookieValue(header: string, name: string): string {
  const pair = header.split(';')[0];
  assert.ok(pair.startsWith(`${name}=`));
  return decodeURIComponent(pair.slice(name.length + 1));
}

function postChild(env: Env, familyCode: string): Promise<Response> {
  const body = new URLSearchParams({ familyCode });
  return app.fetch(
    new Request(`${ORIGIN}/api/auth/child`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN },
      body,
    }),
    env,
  );
}

function onlyCookie(response: Response): string {
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 1);
  return cookies[0];
}

