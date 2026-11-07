import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { app } from './app.ts';
import type { D1Database, D1Prepared, D1Result } from './d1.ts';
import {
  CHILD_SESSION_SECONDS,
  clearSessionCookie,
  PARENT_SESSION_SECONDS,
  sessionCookie,
  sha256,
} from './http.ts';

const SECRET = 'test-session-secret-value';
const ORIGIN = 'https://kid.example';

test('child session is 48 hours and parent session stays 14 days', () => {
  assert.equal(CHILD_SESSION_SECONDS, 60 * 60 * 48);
  assert.equal(PARENT_SESSION_SECONDS, 60 * 60 * 24 * 14);
  const child = sessionCookie('child-token', `${ORIGIN}/api/auth/child`, CHILD_SESSION_SECONDS);
  const parent = sessionCookie('parent-token', `${ORIGIN}/auth/verify`, PARENT_SESSION_SECONDS);
  assert.match(child, /Max-Age=172800(?:;|$)/);
  assert.match(parent, /Max-Age=1209600(?:;|$)/);
  assert.match(child, /Secure/);
  assert.match(parent, /Secure/);
  const childExpires = /Expires=([^;]+)/.exec(child)?.[1];
  assert.ok(childExpires);
  const delta = new Date(childExpires).getTime() - Date.now();
  assert.ok(Math.abs(delta - CHILD_SESSION_SECONDS * 1000) < 5000);
  const cleared = clearSessionCookie(`${ORIGIN}/`);
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
  const token = decodeURIComponent(setCookie.split(';')[0].slice('ks_session='.length));
  const row = sqlite.prepare('SELECT expires_at FROM sessions').get() as { expires_at: string };
  const storedDelta = new Date(row.expires_at).getTime() - Date.now();
  assert.ok(Math.abs(storedDelta - CHILD_SESSION_SECONDS * 1000) < 5000);

  const state = await app.fetch(
    new Request(`${ORIGIN}/api/kid/state`, { headers: { cookie: `ks_session=${token}` } }),
    env,
  );
  assert.equal(state.status, 200);
  assert.equal(state.headers.get('cache-control'), 'private, no-store');
  const body = (await state.json()) as { childName: string };
  assert.equal(body.childName, '小星');

  sqlite.prepare(`UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'`).run();
  const expired = await app.fetch(
    new Request(`${ORIGIN}/api/kid/state`, { headers: { cookie: `ks_session=${token}` } }),
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
  const row = sqlite.prepare(`SELECT expires_at FROM sessions WHERE role = 'parent'`).get() as { expires_at: string };
  const delta = new Date(row.expires_at).getTime() - Date.now();
  assert.ok(Math.abs(delta - PARENT_SESSION_SECONDS * 1000) < 5000);
});

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

function createDb(): { env: Env; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0001_schema.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../migrations/0002_seed_demo.sql', import.meta.url), 'utf8'));
  const env = { DB: new SqliteD1(sqlite), SESSION_SECRET: SECRET } as Env;
  return { env, sqlite };
}

class SqliteD1 implements D1Database {
  sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
  }

  prepare(query: string): D1Prepared {
    const statement = this.sqlite.prepare(query);
    let params: unknown[] = [];
    const prepared: D1Prepared = {
      bind(...values: unknown[]) {
        params = values;
        return prepared;
      },
      async first<T>() {
        const row = statement.get(...(params as Array<string | number | null>)) as T | undefined;
        return row ?? null;
      },
      async all<T>() {
        return { results: statement.all(...(params as Array<string | number | null>)) as T[] };
      },
      async run() {
        const result = statement.run(...(params as Array<string | number | null>));
        return { meta: { changes: Number(result.changes ?? 0) } };
      },
    };
    return prepared;
  }

  async batch(statements: D1Prepared[]): Promise<D1Result[]> {
    const results: D1Result[] = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}
