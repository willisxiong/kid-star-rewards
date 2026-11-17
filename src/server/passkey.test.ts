import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { app } from './app.ts';
import { PARENT_SESSION_COOKIE, PARENT_SESSION_SECONDS, sha256 } from './http.ts';
import { authenticationResponse, createSoftwarePasskey, registrationResponse, type SoftwarePasskey } from './software-passkey.ts';
import { createDb, ORIGIN, RP_ID, SECRET } from './testing.ts';
import { expectedTrialRpId, isAcceptableRpId, signCountDecision, webauthnRelyingParty } from './webauthn.ts';

test('sign count flags a clone only for a device-bound key that moved backwards', () => {
  assert.equal(signCountDecision({ backupEligible: false, stored: 5, next: 5 }).reject, true);
  assert.equal(signCountDecision({ backupEligible: false, stored: 5, next: 4 }).reject, true);
  assert.equal(signCountDecision({ backupEligible: false, stored: 5, next: 0 }).reject, false);
  assert.equal(signCountDecision({ backupEligible: false, stored: 0, next: 0 }).reject, false);
  assert.equal(signCountDecision({ backupEligible: false, stored: 5, next: 6 }).signCount, 6);
  assert.equal(signCountDecision({ backupEligible: true, stored: 8, next: 0 }).reject, false);
  assert.equal(signCountDecision({ backupEligible: true, stored: 8, next: 0 }).signCount, 8);
});

test('production RP ID is pinned and refuses workers.dev suffixes', () => {
  assert.equal(isAcceptableRpId('workers.dev'), false);
  assert.equal(isAcceptableRpId('xiongwei-fly.workers.dev'), false);
  assert.equal(isAcceptableRpId(expectedTrialRpId()), true);
  assert.throws(() =>
    webauthnRelyingParty({ WEBAUTHN_RP_ID: 'workers.dev', WEBAUTHN_ORIGIN: 'https://workers.dev' } as Env, `${ORIGIN}/api`),
  );
  assert.throws(() =>
    webauthnRelyingParty(
      { WEBAUTHN_RP_ID: 'xiongwei-fly.workers.dev', WEBAUTHN_ORIGIN: 'https://xiongwei-fly.workers.dev' } as Env,
      `${ORIGIN}/api`,
    ),
  );
  const trial = webauthnRelyingParty(
    {
      WEBAUTHN_RP_ID: expectedTrialRpId(),
      WEBAUTHN_ORIGIN: `https://${expectedTrialRpId()}`,
    } as Env,
    'https://evil.example/api/auth/passkey/authenticate/options',
  );
  assert.equal(trial.rpID, expectedTrialRpId());
  assert.equal(trial.origin, `https://${expectedTrialRpId()}`);
  const local = webauthnRelyingParty({ WEBAUTHN_RP_ID: 'kid.example' } as Env, 'http://localhost:8787/parent');
  assert.equal(local.rpID, 'localhost');
  assert.equal(local.origin, 'http://localhost:8787');
  assert.throws(() => webauthnRelyingParty({} as Env, 'http://127.0.0.1:4321/parent'));
});

test('cannot register a passkey without a parent session', async () => {
  const { env } = createDb();
  const response = await app.fetch(call('/api/auth/passkey/register/options', {}), env);
  assert.equal(response.status, 401);
});

test('passkey options stay discoverable and do not trust the request host', async () => {
  const { env, sqlite } = createDb();
  const cookie = await parentCookie(sqlite);
  const registered = await app.fetch(call('/api/auth/passkey/register/options', {}, cookie), env);
  assert.equal(registered.status, 200);
  const options = (await registered.json()) as {
    rp: { id: string };
    user: { id: string };
    attestation: string;
    authenticatorSelection: { residentKey?: string; requireResidentKey?: boolean; userVerification?: string; authenticatorAttachment?: string };
  };
  assert.equal(options.rp.id, RP_ID);
  assert.equal(options.attestation, 'none');
  assert.equal(options.authenticatorSelection.residentKey, 'required');
  assert.equal(options.authenticatorSelection.requireResidentKey, true);
  assert.equal(options.authenticatorSelection.userVerification, 'preferred');
  assert.equal(options.authenticatorSelection.authenticatorAttachment, undefined);
  assert.equal(isoBase64URL.toUTF8String(options.user.id), 'par_demo_1');

  const discovered = await app.fetch(call('/api/auth/passkey/authenticate/options', {}, undefined, '203.0.113.20'), env);
  assert.equal(discovered.status, 200);
  const authOptions = (await discovered.json()) as { rpId: string; allowCredentials: unknown[]; userVerification: string };
  assert.equal(authOptions.rpId, RP_ID);
  assert.deepEqual(authOptions.allowCredentials, []);
  assert.equal(authOptions.userVerification, 'preferred');

  const evil = await app.fetch(
    call('/api/auth/passkey/authenticate/options', {}, undefined, '203.0.113.21', 'https://evil.example'),
    env,
  );
  assert.equal(evil.status, 200);
  const evilBody = (await evil.json()) as { rpId: string };
  assert.equal(evilBody.rpId, RP_ID);

  const local = await app.fetch(
    call('/api/auth/passkey/authenticate/options', {}, undefined, '203.0.113.22', 'http://localhost:4321'),
    env,
  );
  assert.equal(local.status, 200);
  const localBody = (await local.json()) as { rpId: string };
  assert.equal(localBody.rpId, 'localhost');
});

test('dashboard writes stay locked until a passkey exists, then a passkey login lasts 14 days', async () => {
  const { env, sqlite } = createDb();
  const cookie = await parentCookie(sqlite);
  const state = await app.fetch(call('/api/parent/state', undefined, cookie, '203.0.113.30', ORIGIN, 'GET'), env);
  assert.equal(state.status, 200);
  const before = (await state.json()) as { hasPasskeys: boolean; passkeyCount: number };
  assert.equal(before.hasPasskeys, false);
  assert.equal(before.passkeyCount, 0);

  const task = await app.fetch(call('/api/parent/tasks', { name: '帮忙洗碗', points: 2 }, cookie), env);
  assert.equal(task.status, 403);
  const taskBody = (await task.json()) as { error: string };
  assert.equal(taskBody.error, 'passkey_required');
  const reward = await app.fetch(call('/api/parent/rewards', { name: '故事', cost: 5 }, cookie), env);
  assert.equal(reward.status, 403);
  const family = await app.fetch(call('/api/parent/family', { timezone: 'Asia/Tokyo' }, cookie, '203.0.113.30', ORIGIN, 'PATCH'), env);
  assert.equal(family.status, 403);

  const key = await createSoftwarePasskey({ backupEligible: true, backedUp: true });
  const saved = await registerKey(env, cookie, key, 0);
  assert.equal(saved.passkeyCount, 1);
  const row = sqlite.prepare('SELECT backup_eligible, backed_up, friendly_name FROM parent_passkeys').get() as {
    backup_eligible: number;
    backed_up: number;
    friendly_name: string;
  };
  assert.equal(row.backup_eligible, 1);
  assert.equal(row.backed_up, 1);
  assert.equal(row.friendly_name, '已同步的 Passkey');

  const added = await app.fetch(call('/api/parent/tasks', { name: '帮忙洗碗', points: 2 }, cookie), env);
  assert.equal(added.status, 200);

  sqlite.prepare(`UPDATE parent_passkeys SET last_used_at = '2000-01-01T00:00:00.000Z'`).run();
  const login = await authenticate(env, key, 'par_demo_1', 0);
  assert.equal(login.status, 200);
  const setCookie = cookieNamed(login, PARENT_SESSION_COOKIE);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /Max-Age=1209600(?:;|$)/);
  const session = sqlite.prepare(`SELECT expires_at FROM sessions WHERE role = 'parent' ORDER BY created_at DESC`).get() as {
    expires_at: string;
  };
  const delta = new Date(session.expires_at).getTime() - Date.now();
  assert.ok(Math.abs(delta - PARENT_SESSION_SECONDS * 1000) < 5000);
  const used = sqlite.prepare('SELECT last_used_at FROM parent_passkeys').get() as { last_used_at: string };
  assert.notEqual(used.last_used_at, '2000-01-01T00:00:00.000Z');

  const again = await authenticate(env, key, 'par_demo_1', 0, '203.0.113.31');
  assert.equal(again.status, 200);

  const wrongParent = await authenticate(env, key, 'par_demo_2', 0, '203.0.113.32');
  assert.equal(wrongParent.status, 401);
});

test('expired and replayed challenges fail', async () => {
  const { env, sqlite } = createDb();
  const cookie = await parentCookie(sqlite);
  const options = await app.fetch(call('/api/auth/passkey/register/options', {}, cookie), env);
  const body = (await options.json()) as { challenge: string };
  sqlite.prepare(`UPDATE webauthn_challenges SET expires_at = '2000-01-01T00:00:00.000Z'`).run();
  const key = await createSoftwarePasskey();
  const expired = await app.fetch(
    call('/api/auth/passkey/register/verify', await registrationResponse(key, { challenge: body.challenge, origin: ORIGIN, rpID: RP_ID }), cookie),
    env,
  );
  assert.equal(expired.status, 400);
  const expiredBody = (await expired.json()) as { message: string };
  assert.match(expiredBody.message, /过期/);

  const fresh = await app.fetch(call('/api/auth/passkey/register/options', {}, cookie, '203.0.113.41'), env);
  const freshBody = (await fresh.json()) as { challenge: string };
  const payload = await registrationResponse(key, { challenge: freshBody.challenge, origin: ORIGIN, rpID: RP_ID, signCount: 1 });
  const first = await app.fetch(call('/api/auth/passkey/register/verify', payload, cookie, '203.0.113.42'), env);
  assert.equal(first.status, 200);
  const replay = await app.fetch(call('/api/auth/passkey/register/verify', payload, cookie, '203.0.113.43'), env);
  assert.equal(replay.status, 400);
  const replayBody = (await replay.json()) as { message: string };
  assert.match(replayBody.message, /已使用/);
});

test('device-bound sign count can reject a clone and still accepts a zero counter', async () => {
  const { env, sqlite } = createDb();
  const cookie = await parentCookie(sqlite);
  const key = await createSoftwarePasskey();
  await registerKey(env, cookie, key, 1);
  const moved = await authenticate(env, key, 'par_demo_1', 2, '203.0.113.51');
  assert.equal(moved.status, 200);
  const cloned = await authenticate(env, key, 'par_demo_1', 2, '203.0.113.52');
  assert.equal(cloned.status, 401);
  const stored = sqlite.prepare('SELECT sign_count FROM parent_passkeys').get() as { sign_count: number };
  assert.equal(stored.sign_count, 2);

  sqlite.prepare('UPDATE parent_passkeys SET sign_count = 5').run();
  const zero = await authenticate(env, key, 'par_demo_1', 0, '203.0.113.53');
  assert.equal(zero.status, 200);
  const afterZero = sqlite.prepare('SELECT sign_count FROM parent_passkeys').get() as { sign_count: number };
  assert.equal(afterZero.sign_count, 5);
});

test('a parent cannot delete another parent passkey, and the last key may be deleted', async () => {
  const { env, sqlite } = createDb();
  const first = await parentCookie(sqlite, 'par_demo_1');
  const second = await parentCookie(sqlite, 'par_demo_2');
  const key = await createSoftwarePasskey();
  await registerKey(env, first, key, 0);
  const listed = await app.fetch(call('/api/parent/passkeys', undefined, first, '203.0.113.60', ORIGIN, 'GET'), env);
  const list = (await listed.json()) as { passkeys: { id: string; friendlyName: string }[] };
  assert.equal(list.passkeys.length, 1);
  const id = list.passkeys[0].id;

  const stolen = await app.fetch(call(`/api/parent/passkeys/${id}`, undefined, second, '203.0.113.61', ORIGIN, 'DELETE'), env);
  assert.equal(stolen.status, 404);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM parent_passkeys').get().n, 1);

  const renamed = await app.fetch(
    call(`/api/parent/passkeys/${id}`, { friendlyName: '妈妈的手机' }, second, '203.0.113.62', ORIGIN, 'PATCH'),
    env,
  );
  assert.equal(renamed.status, 404);
  const ownRename = await app.fetch(
    call(`/api/parent/passkeys/${id}`, { friendlyName: '妈妈的手机' }, first, '203.0.113.63', ORIGIN, 'PATCH'),
    env,
  );
  assert.equal(ownRename.status, 200);

  const child = await fetchChildCookie(env);
  const blocked = await app.fetch(call('/api/parent/state', undefined, child, '203.0.113.64', ORIGIN, 'GET'), env);
  assert.equal(blocked.status, 401);
  const childWrite = await app.fetch(call('/api/parent/tasks', { name: '不行', points: 1 }, child), env);
  assert.equal(childWrite.status, 401);

  const removed = await app.fetch(call(`/api/parent/passkeys/${id}`, undefined, first, '203.0.113.65', ORIGIN, 'DELETE'), env);
  assert.equal(removed.status, 200);
  const removedBody = (await removed.json()) as { passkeyCount: number };
  assert.equal(removedBody.passkeyCount, 0);
  const locked = await app.fetch(call('/api/parent/tasks', { name: '帮忙洗碗', points: 2 }, first), env);
  assert.equal(locked.status, 403);
  const logout = await app.fetch(call('/api/auth/logout', { role: 'parent' }, first), env);
  assert.equal(logout.status, 200);
  const loggedOut = await app.fetch(call('/api/parent/state', undefined, first, '203.0.113.66', ORIGIN, 'GET'), env);
  assert.equal(loggedOut.status, 401);
});

test('authenticate and register routes are rate limited', async () => {
  const { env, sqlite } = createDb();
  const ip = '203.0.113.80';
  for (let i = 0; i < 20; i += 1) {
    const response = await app.fetch(call('/api/auth/passkey/authenticate/options', {}, undefined, ip), env);
    assert.equal(response.status, 200);
  }
  const limited = await app.fetch(call('/api/auth/passkey/authenticate/options', {}, undefined, ip), env);
  assert.equal(limited.status, 429);

  const cookie = await parentCookie(sqlite, 'par_demo_2');
  for (let i = 0; i < 10; i += 1) {
    const response = await app.fetch(call('/api/auth/passkey/register/options', {}, cookie, `203.0.113.${90 + i}`), env);
    assert.equal(response.status, 200);
  }
  const registerLimited = await app.fetch(call('/api/auth/passkey/register/options', {}, cookie, '203.0.113.70'), env);
  assert.equal(registerLimited.status, 429);
});

async function registerKey(env: Env, cookie: string, key: SoftwarePasskey, signCount: number): Promise<{ passkeyCount: number }> {
  const options = await app.fetch(call('/api/auth/passkey/register/options', {}, cookie), env);
  assert.equal(options.status, 200);
  const body = (await options.json()) as { challenge: string };
  const payload = await registrationResponse(key, { challenge: body.challenge, origin: ORIGIN, rpID: RP_ID, signCount });
  const verified = await app.fetch(call('/api/auth/passkey/register/verify', payload, cookie), env);
  assert.equal(verified.status, 200, await verified.clone().text());
  return (await verified.json()) as { passkeyCount: number };
}

async function authenticate(env: Env, key: SoftwarePasskey, userHandle: string, signCount: number, ip = '203.0.113.40'): Promise<Response> {
  const options = await app.fetch(call('/api/auth/passkey/authenticate/options', {}, undefined, ip), env);
  assert.equal(options.status, 200);
  const body = (await options.json()) as { challenge: string };
  const payload = await authenticationResponse(key, { challenge: body.challenge, origin: ORIGIN, rpID: RP_ID, userHandle, signCount });
  return app.fetch(call('/api/auth/passkey/authenticate/verify', payload, undefined, ip), env);
}

async function parentCookie(sqlite: DatabaseSync, parentId = 'par_demo_1'): Promise<string> {
  const token = `parent-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + PARENT_SESSION_SECONDS * 1000).toISOString();
  sqlite
    .prepare(
      `INSERT INTO sessions (id, token_hash, role, family_id, parent_id, expires_at, created_at)
       VALUES (?, ?, 'parent', 'fam_demo', ?, ?, ?)`,
    )
    .run(crypto.randomUUID(), await sha256(`${SECRET}:${token}`), parentId, expires, now);
  return `${PARENT_SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

async function fetchChildCookie(env: Env): Promise<string> {
  const response = await app.fetch(
    new Request(`${ORIGIN}/api/auth/child`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ familyCode: 'STAR-4821' }),
    }),
    env,
  );
  return cookieNamed(response, 'ks_child_session').split(';')[0];
}

function cookieNamed(response: Response, name: string): string {
  const match = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
  assert.ok(match);
  return match;
}

function call(
  path: string,
  body: unknown,
  cookie?: string,
  ip = '203.0.113.10',
  origin = ORIGIN,
  method = 'POST',
): Request {
  const headers: Record<string, string> = { origin, 'cf-connecting-ip': ip };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`${origin}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
