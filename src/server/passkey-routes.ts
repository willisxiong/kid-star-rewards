import type { Context, Hono } from 'hono';
import { parseName } from '../lib/validate';
import type { SessionRow } from './data';
import type { AppEnv } from './context';
import { HttpError } from './http';
import {
  asAuthenticationResponse,
  asRegistrationResponse,
  assertRateLimit,
  AUTHENTICATE_LIMIT,
  authenticationOptions,
  clientIp,
  deletePasskey,
  listPasskeys,
  REGISTER_LIMIT,
  registrationOptions,
  renamePasskey,
  verifyAuthentication,
  verifyRegistration,
  webauthnRelyingParty,
} from './webauthn';

type Deps = {
  requireParent: (c: Context<AppEnv>) => Promise<SessionRow>;
  readBody: (c: Context<AppEnv>) => Promise<Record<string, unknown>>;
  issueParentSession: (c: Context<AppEnv>, parentId: string, familyId: string) => Promise<void>;
};

export function mountPasskeyRoutes(app: Hono<AppEnv>, deps: Deps): void {
  app.post('/api/auth/passkey/register/options', async (c) => {
    const session = await deps.requireParent(c);
    await assertRateLimit(c.env.DB, 'register', `parent:${session.parent_id}`, REGISTER_LIMIT);
    const options = await registrationOptions(
      c.env.DB,
      webauthnRelyingParty(c.env, c.req.url),
      session.parent_id!,
      session.parent_email || session.parent_id!,
    );
    return c.json(options);
  });

  app.post('/api/auth/passkey/register/verify', async (c) => {
    const session = await deps.requireParent(c);
    await assertRateLimit(c.env.DB, 'register', `parent:${session.parent_id}`, REGISTER_LIMIT);
    const body = asRegistrationResponse(await deps.readBody(c));
    const saved = await verifyRegistration(c.env.DB, webauthnRelyingParty(c.env, c.req.url), session.parent_id!, body);
    return c.json({ ok: true, message: 'Passkey 已登记', id: saved.id, passkeyCount: saved.passkeyCount });
  });

  app.post('/api/auth/passkey/authenticate/options', async (c) => {
    await assertRateLimit(c.env.DB, 'authenticate', `ip:${clientIp(c.req.header('cf-connecting-ip'))}`, AUTHENTICATE_LIMIT);
    const options = await authenticationOptions(c.env.DB, webauthnRelyingParty(c.env, c.req.url));
    return c.json(options);
  });

  app.post('/api/auth/passkey/authenticate/verify', async (c) => {
    await assertRateLimit(c.env.DB, 'authenticate', `ip:${clientIp(c.req.header('cf-connecting-ip'))}`, AUTHENTICATE_LIMIT);
    const body = asAuthenticationResponse(await deps.readBody(c));
    const parent = await verifyAuthentication(c.env.DB, webauthnRelyingParty(c.env, c.req.url), body);
    await deps.issueParentSession(c, parent.parentId, parent.familyId);
    return c.json({ ok: true, message: '已使用 Passkey 登录' });
  });

  app.get('/api/parent/passkeys', async (c) => {
    const session = await deps.requireParent(c);
    return c.json({ passkeys: await listPasskeys(c.env.DB, session.parent_id!) });
  });

  app.patch('/api/parent/passkeys/:id', async (c) => {
    const session = await deps.requireParent(c);
    const body = await deps.readBody(c);
    const name = parseName(body.friendlyName ?? body.name, 40);
    if (!name) throw new HttpError(400, '请输入钥匙名称');
    await renamePasskey(c.env.DB, session.parent_id!, c.req.param('id'), name);
    return c.json({ ok: true, message: '已更新名称', passkeys: await listPasskeys(c.env.DB, session.parent_id!) });
  });

  app.delete('/api/parent/passkeys/:id', async (c) => {
    const session = await deps.requireParent(c);
    const passkeyCount = await deletePasskey(c.env.DB, session.parent_id!, c.req.param('id'));
    return c.json({
      ok: true,
      message: passkeyCount === 0 ? '已删除最后一把 Passkey，请重新登记' : '已删除这把 Passkey',
      passkeyCount,
    });
  });
}
