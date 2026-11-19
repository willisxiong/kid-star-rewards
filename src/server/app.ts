import { Hono } from 'hono';
import type { Context } from 'hono';
import { errorText, localeFromCookieHeader, text, type Locale } from '../lib/i18n';
import { normalizeEmail, normalizeFamilyCode, parseDailyLimit, parseName, parsePoints, parseTaskKind } from '../lib/validate';
import type { AppEnv } from './context';
import {
  addReward,
  addTask,
  awardStarburst,
  checkIn,
  disableReward,
  disableTask,
  kidState,
  loadSession,
  parentState,
  redeem,
  resolveRedemption,
  setTimezone,
  updateReward,
  updateTask,
  type SessionRow,
} from './data';
import {
  addSeconds,
  CHILD_SESSION_COOKIE,
  CHILD_SESSION_SECONDS,
  clearSessionCookie,
  HttpError,
  LEGACY_SESSION_COOKIE,
  nowIso,
  PARENT_SESSION_COOKIE,
  PARENT_SESSION_SECONDS,
  randomToken,
  readCookie,
  requireSecret,
  sessionCookie,
  sha256,
} from './http';
import { deliverMagicLink } from './mail';
import { mountPasskeyRoutes } from './passkey-routes';
import { resolveSessions, type ResolvedSessions } from './sessions';
import { passkeyCount } from './webauthn';

const MAGIC_TTL_SECONDS = 60 * 15;

export const app = new Hono<AppEnv>();

app.onError((error, c) => {
  noStore(c);
  const locale = requestLocale(c);
  if (error instanceof HttpError) {
    return c.json({ error: error.code, message: errorText(locale, error.key) }, error.status as 400);
  }
  console.error('[kid-star]', error);
  return c.json({ error: 'server', message: text(locale).serverBusy }, 500);
});

app.use('*', async (c, next) => {
  await next();
  noStore(c);
});

app.use('*', async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    await next();
    return;
  }
  const origin = c.req.header('origin');
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'originDenied');
    }
    if (originHost !== new URL(c.req.url).host) throw new HttpError(403, 'originDenied');
  }
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true, service: 'kid-star-rewards' }));

app.get('/api/session', async (c) => {
  const session = await optionalSession(c);
  if (!session) return c.json({ role: null });
  return c.json({ role: session.role });
});

app.post('/api/auth/logout', async (c) => {
  const secret = requireSecret(c.env);
  const body = await readBodyOptional(c);
  const role = body.role === 'parent' || body.role === 'child' ? body.role : null;
  const header = c.req.header('cookie');
  const legacy = readCookie(header, LEGACY_SESSION_COOKIE);
  const names: string[] = [];
  if (role !== 'child') names.push(PARENT_SESSION_COOKIE);
  if (role !== 'parent') names.push(CHILD_SESSION_COOKIE);
  const tokens = names
    .map((name) => readCookie(header, name))
    .filter((token): token is string => Boolean(token));
  if (legacy) {
    const legacySession = await loadSession(c.env.DB, await sha256(`${secret}:${legacy}`));
    if (!role || legacySession?.role === role) tokens.push(legacy);
    if (!role || legacySession?.role === role) names.push(LEGACY_SESSION_COOKIE);
  }
  for (const token of tokens) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(`${secret}:${token}`)).run();
  }
  for (const name of names) {
    c.header('Set-Cookie', clearSessionCookie(name, c.req.url), { append: true });
  }
  return c.json({ ok: true, message: text(requestLocale(c)).loggedOut });
});

app.post('/api/auth/request', async (c) => {
  const secret = requireSecret(c.env);
  const body = await readBody(c);
  const email = normalizeEmail(body.email);
  if (!email) throw new HttpError(400, 'emailInvalid');
  const parent = await c.env.DB.prepare('SELECT id FROM parents WHERE email = ?').bind(email).first<{ id: string }>();
  let devLink: string | undefined;
  if (parent) {
    const since = addSeconds(nowIso(), -60 * 60);
    const recent = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM magic_links WHERE parent_id = ? AND created_at >= ? AND consumed_at IS NULL',
    )
      .bind(parent.id, since)
      .first<{ n: number }>();
    if (Number(recent?.n ?? 0) < 5) {
      const token = randomToken();
      const createdAt = nowIso();
      await c.env.DB.prepare(
        'INSERT INTO magic_links (id, parent_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(crypto.randomUUID(), parent.id, await sha256(`${secret}:${token}`), addSeconds(createdAt, MAGIC_TTL_SECONDS), createdAt)
        .run();
      const origin = publicOrigin(c.env, c.req.url);
      const url = `${origin}/auth/verify?token=${encodeURIComponent(token)}`;
      const delivery = await deliverMagicLink(c.env, email, url);
      if (delivery.channel === 'log') devLink = delivery.devLink;
    } else {
      console.log(`[kid-star] magic link rate limit for ${email}`);
    }
  }
  return c.json({ ok: true, message: text(requestLocale(c)).magicSent, devLink });
});

app.get('/auth/verify', async (c) => {
  const secret = requireSecret(c.env);
  const token = c.req.query('token') ?? '';
  const fail = () => c.redirect('/parent?link=invalid', 302);
  if (token.length < 20) return fail();
  const link = await c.env.DB.prepare(
    `SELECT m.id, m.expires_at, m.consumed_at, m.parent_id, p.family_id
     FROM magic_links m
     JOIN parents p ON p.id = m.parent_id
     WHERE m.token_hash = ?`,
  )
    .bind(await sha256(`${secret}:${token}`))
    .first<{ id: string; expires_at: string; consumed_at: string | null; parent_id: string; family_id: string }>();
  const now = nowIso();
  if (!link || link.consumed_at || link.expires_at <= now) return fail();
  const consumed = await c.env.DB.prepare(
    'UPDATE magic_links SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL',
  )
    .bind(now, link.id)
    .run();
  if (!Number(consumed.meta.changes ?? 0)) return fail();
  const sessionToken = randomToken();
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, token_hash, role, family_id, parent_id, expires_at, created_at)
     VALUES (?, ?, 'parent', ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), await sha256(`${secret}:${sessionToken}`), link.family_id, link.parent_id, addSeconds(now, PARENT_SESSION_SECONDS), now)
    .run();
  c.header('Set-Cookie', sessionCookie(PARENT_SESSION_COOKIE, sessionToken, c.req.url, PARENT_SESSION_SECONDS));
  return c.redirect('/parent', 302);
});

app.post('/api/auth/child', async (c) => {
  const wantsJson = (c.req.header('content-type') ?? '').includes('application/json');
  const deny = (status: 400, key: 'codeInvalid' | 'noChild', code: string) => {
    if (wantsJson) throw new HttpError(status, key);
    return c.redirect(`/kid?bind=${code}`, 303);
  };
  const secret = requireSecret(c.env);
  const familyCode = await readFamilyCode(c);
  const code = normalizeFamilyCode(familyCode);
  if (!code) return deny(400, 'codeInvalid', 'invalid');
  const family = await c.env.DB.prepare('SELECT id FROM families WHERE family_code = ?').bind(code).first<{ id: string }>();
  if (!family) return deny(400, 'codeInvalid', 'invalid');
  const child = await c.env.DB.prepare('SELECT id FROM children WHERE family_id = ?').bind(family.id).first<{ id: string }>();
  if (!child) return deny(400, 'noChild', 'nochild');
  const now = nowIso();
  const deviceId = crypto.randomUUID();
  const sessionToken = randomToken();
  const expiresAt = addSeconds(now, CHILD_SESSION_SECONDS);
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO child_devices (id, family_id, child_id, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(deviceId, family.id, child.id, now, now),
    c.env.DB.prepare(
      `INSERT INTO sessions (id, token_hash, role, family_id, child_device_id, expires_at, created_at)
       VALUES (?, ?, 'child', ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), await sha256(`${secret}:${sessionToken}`), family.id, deviceId, expiresAt, now),
  ]);
  // Set-Cookie is on this document navigation (303), same pattern as the parent magic link.
  // A cookie set only on a fetch response is dropped by some in-app browsers when the page is closed.
  c.header('Set-Cookie', sessionCookie(CHILD_SESSION_COOKIE, sessionToken, c.req.url, CHILD_SESSION_SECONDS));
  if (wantsJson) {
    const state = await kidState(c.env.DB, family.id, child.id);
    return c.json({ ok: true, state });
  }
  return c.redirect('/kid', 303);
});

app.get('/api/kid/state', async (c) => {
  const session = await requireRole(c, 'child');
  return c.json(await kidState(c.env.DB, session.family_id, session.child_id!));
});

app.post('/api/kid/checkin', async (c) => {
  const session = await requireRole(c, 'child');
  const body = await readBody(c);
  const taskId = typeof body.taskId === 'string' ? body.taskId : '';
  if (!taskId) throw new HttpError(400, 'taskInvalid');
  const locale = requestLocale(c);
  const result = await checkIn(c.env.DB, session.family_id, session.child_id!, taskId, locale);
  const state = await kidState(c.env.DB, session.family_id, session.child_id!);
  const copy = text(locale);
  return c.json({
    ok: true,
    already: result.already,
    toast: result.already ? copy.alreadyChecked : copy.checkin(result.points),
    state,
  });
});

app.post('/api/kid/redeem', async (c) => {
  const session = await requireRole(c, 'child');
  const body = await readBody(c);
  const rewardId = typeof body.rewardId === 'string' ? body.rewardId : '';
  if (!rewardId) throw new HttpError(400, 'rewardInvalid');
  const locale = requestLocale(c);
  await redeem(c.env.DB, session.family_id, rewardId, locale);
  const state = await kidState(c.env.DB, session.family_id, session.child_id!);
  return c.json({ ok: true, toast: text(locale).redeemPending, state });
});

app.get('/api/parent/state', async (c) => {
  const session = await requireRole(c, 'parent');
  return c.json(await parentState(c.env.DB, session.family_id, session.parent_email ?? '', session.parent_id!));
});

app.post('/api/parent/redemptions/:id/approve', async (c) => {
  const session = await requireParentReady(c);
  const locale = requestLocale(c);
  const result = await resolveRedemption(c.env.DB, session.family_id, session.parent_id!, c.req.param('id'), 'approved', locale);
  const state = await parentState(c.env.DB, session.family_id, session.parent_email ?? '', session.parent_id!);
  return c.json({ ok: true, toast: text(locale).approved(result.name), state });
});

app.post('/api/parent/redemptions/:id/reject', async (c) => {
  const session = await requireParentReady(c);
  const locale = requestLocale(c);
  await resolveRedemption(c.env.DB, session.family_id, session.parent_id!, c.req.param('id'), 'rejected', locale);
  const state = await parentState(c.env.DB, session.family_id, session.parent_email ?? '', session.parent_id!);
  return c.json({ ok: true, toast: text(locale).rejected, state });
});

app.post('/api/parent/tasks', async (c) => {
  const session = await requireParentReady(c);
  const body = await readBody(c);
  const name = parseName(body.name);
  const points = parsePoints(body.points);
  const kind = parseTaskKind(body.kind);
  if (!name || points == null || !kind) throw new HttpError(400, 'taskInvalid');
  const dailyLimit = readDailyLimit(body.dailyLimit, kind === 'daily');
  const locale = requestLocale(c);
  await addTask(c.env.DB, session.family_id, name, points, locale, {
    kind,
    ...(dailyLimit == null ? {} : { dailyLimit }),
  });
  return c.json({ ok: true, toast: text(locale).taskAdded, state: await parentState(c.env.DB, session.family_id, session.parent_email ?? '', session.parent_id!) });
});

app.patch('/api/parent/tasks/:id', async (c) => {
  const session = await requireParentReady(c);
  const body = await readBody(c);
  const name = parseName(body.name);
  const points = parsePoints(body.points);
  if (!name || points == null) throw new HttpError(400, 'taskInvalid');
  const dailyLimit = readDailyLimit(body.dailyLimit, false);
  const locale = requestLocale(c);
  await updateTask(c.env.DB, session.family_id, c.req.param('id'), name, points, locale, dailyLimit);
  return c.json({ ok: true, toast: text(locale).taskUpdated, state: await parentState(c.env.DB, session.family_id, session.parent_email ?? '', session.parent_id!) });
});

app.post('/api/parent/tasks/:id/award', async (c) => {
  const session = await requireParentReady(c);
  const locale = requestLocale(c);
  const result = await awardStarburst(c.env.DB, session.family_id, session.parent_id!, c.req.param('id'), locale);
  const state = await parentState(c.env.DB, session.family_id, session.parent_email ?? '', session.parent_id!);
  return c.json({ ok: true, toast: text(locale).starburstAwarded(result.name, result.points), state });
});

app.delete('/api/parent/tasks/:id', async (c) => {
  const session = await requireParentReady(c);
  const locale = requestLocale(c);
  await disableTask(c.env.DB, session.family_id, c.req.param('id'), locale);
  return c.json({ ok: true, toast: text(locale).taskDisabled, state: await parentState(c.env.DB, session.family_id, session.parent_email ?? '', session.parent_id!) });
});

app.post('/api/parent/rewards', async (c) => {
  const session = await requireParentReady(c);
  const body = await readBody(c);
  const name = parseName(body.name);
  const cost = parsePoints(body.cost, 9999);
  if (!name || cost == null) throw new HttpError(400, 'rewardInvalid');
  const locale = requestLocale(c);
  await addReward(c.env.DB, session.family_id, name, cost, locale);
  return c.json({ ok: true, toast: text(locale).rewardAdded, state: await parentState(c.env.DB, session.family_id, session.parent_email ?? '', session.parent_id!) });
});

app.patch('/api/parent/rewards/:id', async (c) => {
  const session = await requireParentReady(c);
  const body = await readBody(c);
  const name = parseName(body.name);
  const cost = parsePoints(body.cost, 9999);
  if (!name || cost == null) throw new HttpError(400, 'rewardInvalid');
  const locale = requestLocale(c);
  await updateReward(c.env.DB, session.family_id, c.req.param('id'), name, cost, locale);
  return c.json({ ok: true, toast: text(locale).rewardUpdated, state: await parentState(c.env.DB, session.family_id, session.parent_email ?? '', session.parent_id!) });
});

app.delete('/api/parent/rewards/:id', async (c) => {
  const session = await requireParentReady(c);
  const locale = requestLocale(c);
  await disableReward(c.env.DB, session.family_id, c.req.param('id'), locale);
  return c.json({ ok: true, toast: text(locale).rewardDisabled, state: await parentState(c.env.DB, session.family_id, session.parent_email ?? '', session.parent_id!) });
});

app.patch('/api/parent/family', async (c) => {
  const session = await requireParentReady(c);
  const body = await readBody(c);
  const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : '';
  const locale = requestLocale(c);
  await setTimezone(c.env.DB, session.family_id, timezone, locale);
  return c.json({ ok: true, toast: text(locale).timezoneSaved, state: await parentState(c.env.DB, session.family_id, session.parent_email ?? '', session.parent_id!) });
});

mountPasskeyRoutes(app, {
  requireParent: (c) => requireRole(c, 'parent'),
  readBody,
  issueParentSession,
});

export function publicOrigin(env: Env, requestUrl: string): string {
  const url = new URL(requestUrl);
  if (url.protocol === 'http:' && url.hostname === 'localhost') return url.origin;
  return (env.APP_ORIGIN || url.origin).replace(/\/$/, '');
}

function readDailyLimit(value: unknown, defaultWhenMissing: boolean): number | null {
  const missing = value === undefined || value === null || value === '';
  if (missing) {
    if (defaultWhenMissing) return 1;
    return null;
  }
  const parsed = parseDailyLimit(value);
  if (parsed == null) throw new HttpError(400, 'dailyLimitInvalid');
  return parsed;
}

function requestLocale(c: Context<AppEnv>): Locale {
  return localeFromCookieHeader(c.req.header('cookie'));
}

function noStore(c: Context<AppEnv>): void {
  c.header('Cache-Control', 'private, no-store');
  c.header('Pragma', 'no-cache');
}

async function readFamilyCode(c: Context<AppEnv>): Promise<string> {
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await readBody(c);
    return typeof body.familyCode === 'string' ? body.familyCode : '';
  }
  try {
    const form = await c.req.parseBody();
    const value = form.familyCode;
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

async function readBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const body = await readBodyOptional(c);
  if (!Object.keys(body).length && !(c.req.header('content-type') ?? '').includes('json')) {
    throw new HttpError(400, 'badRequest');
  }
  return body;
}

async function readBodyOptional(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  let text = '';
  try {
    text = await c.req.text();
  } catch {
    throw new HttpError(400, 'badRequest');
  }
  if (!text.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'badRequest');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'badRequest');
  return value as Record<string, unknown>;
}

async function readSessions(c: Context<AppEnv>): Promise<ResolvedSessions> {
  const cached = c.get('sessions');
  if (cached) return cached;
  const header = c.req.header('cookie');
  const present =
    readCookie(header, PARENT_SESSION_COOKIE) ||
    readCookie(header, CHILD_SESSION_COOKIE) ||
    readCookie(header, LEGACY_SESSION_COOKIE);
  if (!present) {
    const empty: ResolvedSessions = { parent: null, child: null, setCookies: [] };
    c.set('sessions', empty);
    return empty;
  }
  const resolved = await resolveSessions(c.env.DB, requireSecret(c.env), header, c.req.url);
  for (const cookie of resolved.setCookies) c.header('Set-Cookie', cookie, { append: true });
  c.set('sessions', resolved);
  return resolved;
}

async function optionalSession(c: Context<AppEnv>): Promise<SessionRow | null> {
  const sessions = await readSessions(c);
  return sessions.parent ?? sessions.child;
}

async function requireRole(c: Context<AppEnv>, role: 'parent' | 'child'): Promise<SessionRow> {
  const sessions = await readSessions(c);
  const session = role === 'parent' ? sessions.parent : sessions.child;
  if (!session) throw new HttpError(401, 'loginRequired');
  if (role === 'child' && !session.child_id) throw new HttpError(401, 'bindRequired');
  if (role === 'parent' && !session.parent_id) throw new HttpError(401, 'loginRequired');
  return session;
}

async function requireParentReady(c: Context<AppEnv>): Promise<SessionRow> {
  const session = await requireRole(c, 'parent');
  if ((await passkeyCount(c.env.DB, session.parent_id!)) < 1) {
    throw new HttpError(403, 'passkeyRequired', 'passkey_required');
  }
  return session;
}

async function issueParentSession(c: Context<AppEnv>, parentId: string, familyId: string): Promise<void> {
  const secret = requireSecret(c.env);
  const now = nowIso();
  const sessionToken = randomToken();
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, token_hash, role, family_id, parent_id, expires_at, created_at)
     VALUES (?, ?, 'parent', ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      await sha256(`${secret}:${sessionToken}`),
      familyId,
      parentId,
      addSeconds(now, PARENT_SESSION_SECONDS),
      now,
    )
    .run();
  if (readCookie(c.req.header('cookie'), LEGACY_SESSION_COOKIE)) {
    c.header('Set-Cookie', clearSessionCookie(LEGACY_SESSION_COOKIE, c.req.url), { append: true });
  }
  c.header('Set-Cookie', sessionCookie(PARENT_SESSION_COOKIE, sessionToken, c.req.url, PARENT_SESSION_SECONDS), {
    append: true,
  });
}
