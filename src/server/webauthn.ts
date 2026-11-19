import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { decodeClientDataJSON, isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';
import { text, type Locale } from '../lib/i18n';
import type { D1Database } from './d1';
import { addSeconds, HttpError, nowIso } from './http';

export const RP_NAME = '儿童星级奖励系统';
export const CHALLENGE_TTL_SECONDS = 5 * 60;
export const RATE_WINDOW_SECONDS = 15 * 60;
export const AUTHENTICATE_LIMIT = 20;
export const REGISTER_LIMIT = 10;
const TRIAL_RP_ID = 'kid-star-rewards.xiongwei-fly.workers.dev';

export type RelyingParty = { rpID: string; origin: string; rpName: string };

export function webauthnRelyingParty(env: Env, requestUrl: string): RelyingParty {
  const url = new URL(requestUrl);
  if (url.protocol === 'http:' && url.hostname === 'localhost') {
    return { rpID: 'localhost', origin: url.origin, rpName: RP_NAME };
  }
  if (url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]') {
    throw new HttpError(400, 'passkeyLocalhost');
  }
  const rpID = (env.WEBAUTHN_RP_ID ?? '').trim().toLowerCase();
  const configured = (env.WEBAUTHN_ORIGIN || env.APP_ORIGIN || '').trim();
  if (!rpID || !configured) throw new HttpError(500, 'passkeyUnconfigured');
  let originUrl: URL;
  try {
    originUrl = new URL(configured);
  } catch {
    throw new HttpError(500, 'passkeyOriginInvalid');
  }
  const originHasPath = originUrl.pathname !== '/' || originUrl.search || originUrl.hash || originUrl.username;
  if (originUrl.protocol !== 'https:' || originHasPath || originUrl.hostname.toLowerCase() !== rpID) {
    throw new HttpError(500, 'passkeyOriginMismatch');
  }
  if (!isAcceptableRpId(rpID)) throw new HttpError(500, 'passkeyPublicSuffix');
  return { rpID, origin: originUrl.origin, rpName: RP_NAME };
}

export function isAcceptableRpId(rpID: string): boolean {
  if (rpID === 'workers.dev') return false;
  if (rpID.endsWith('.workers.dev') && rpID.split('.').length < 4) return false;
  return rpID.length > 0 && !rpID.includes('/') && !rpID.includes(':');
}

export function expectedTrialRpId(): string {
  return TRIAL_RP_ID;
}

export type SignCountInput = { backupEligible: boolean; stored: number; next: number };

export function signCountDecision(input: SignCountInput): { reject: boolean; signCount: number } {
  const clone = !input.backupEligible && input.stored > 0 && input.next > 0 && input.next <= input.stored;
  if (clone) return { reject: true, signCount: input.stored };
  return { reject: false, signCount: input.next > input.stored ? input.next : input.stored };
}

export async function assertRateLimit(
  db: D1Database,
  scope: 'authenticate' | 'register',
  subject: string,
  limit: number,
): Promise<void> {
  const now = nowIso();
  const since = addSeconds(now, -RATE_WINDOW_SECONDS);
  await db.prepare('DELETE FROM webauthn_attempts WHERE created_at < ?').bind(since).run();
  await db
    .prepare('INSERT INTO webauthn_attempts (id, scope, subject, created_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), scope, subject.slice(0, 120), now)
    .run();
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM webauthn_attempts WHERE scope = ? AND subject = ? AND created_at >= ?')
    .bind(scope, subject.slice(0, 120), since)
    .first<{ n: number }>();
  if (Number(row?.n ?? 0) > limit) throw new HttpError(429, 'rateLimited', 'rate_limited');
}

export async function saveChallenge(
  db: D1Database,
  challenge: string,
  purpose: 'registration' | 'authentication',
  parentId: string | null,
): Promise<void> {
  const now = nowIso();
  await db.prepare('DELETE FROM webauthn_challenges WHERE expires_at <= ?').bind(now).run();
  await db
    .prepare(
      `INSERT INTO webauthn_challenges (id, challenge, purpose, parent_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), challenge, purpose, parentId, addSeconds(now, CHALLENGE_TTL_SECONDS), now)
    .run();
}

export async function consumeChallenge(
  db: D1Database,
  challenge: string,
  purpose: 'registration' | 'authentication',
  parentId: string | null,
): Promise<'ok' | 'replay' | 'expired' | 'mismatch'> {
  const now = nowIso();
  await db.prepare('DELETE FROM webauthn_challenges WHERE expires_at <= ? AND challenge != ?').bind(now, challenge).run();
  const row = await db
    .prepare('SELECT id, purpose, parent_id, expires_at, consumed_at FROM webauthn_challenges WHERE challenge = ?')
    .bind(challenge)
    .first<{ id: string; purpose: string; parent_id: string | null; expires_at: string; consumed_at: string | null }>();
  if (!row) return 'mismatch';
  if (row.expires_at <= now) {
    await db.prepare('DELETE FROM webauthn_challenges WHERE id = ?').bind(row.id).run();
    return 'expired';
  }
  if (row.consumed_at) return 'replay';
  if (row.purpose !== purpose || (row.parent_id ?? null) !== parentId) return 'mismatch';
  const updated = await db
    .prepare('UPDATE webauthn_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
    .bind(now, row.id)
    .run();
  if (Number(updated.meta.changes ?? 0) !== 1) return 'replay';
  return 'ok';
}

export function challengeError(result: 'replay' | 'expired' | 'mismatch'): HttpError {
  if (result === 'replay') return new HttpError(400, 'challengeUsed');
  if (result === 'expired') return new HttpError(400, 'challengeExpired');
  return new HttpError(400, 'challengeInvalid');
}

export function clientIp(header: string | undefined): string {
  const value = header?.trim() ?? '';
  if (/^[A-Za-z0-9:.]{1,64}$/.test(value)) return value;
  return 'unknown';
}

type StoredPasskey = {
  id: string;
  parent_id: string;
  credential_id: string;
  public_key: string;
  sign_count: number;
  backup_eligible: number;
  backed_up: number;
  device_type: string | null;
};

export async function registrationOptions(db: D1Database, rp: RelyingParty, parentId: string, email: string) {
  const existing = await db
    .prepare('SELECT credential_id, transports FROM parent_passkeys WHERE parent_id = ?')
    .bind(parentId)
    .all<{ credential_id: string; transports: string | null }>();
  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: email,
    userDisplayName: email,
    userID: isoUint8Array.fromUTF8String(parentId),
    timeout: CHALLENGE_TTL_SECONDS * 1000,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'preferred',
    },
    excludeCredentials: (existing.results ?? []).map((row) => ({
      id: row.credential_id,
      transports: parseTransports(row.transports),
    })),
  });
  await saveChallenge(db, options.challenge, 'registration', parentId);
  return options;
}

export async function authenticationOptions(db: D1Database, rp: RelyingParty) {
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: [],
    userVerification: 'preferred',
    timeout: CHALLENGE_TTL_SECONDS * 1000,
  });
  await saveChallenge(db, options.challenge, 'authentication', null);
  return options;
}

export async function verifyRegistration(
  db: D1Database,
  rp: RelyingParty,
  parentId: string,
  response: RegistrationResponseJSON,
  locale: Locale = 'en',
): Promise<{ id: string; passkeyCount: number }> {
  const challenge = readChallenge(response.response?.clientDataJSON);
  const consumed = await consumeChallenge(db, challenge, 'registration', parentId);
  if (consumed !== 'ok') throw challengeError(consumed);
  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: false,
    });
  } catch (error) {
    console.error('[kid-star] passkey register verify', error);
    throw new HttpError(400, 'passkeyVerifyFailed');
  }
  if (!verified.verified) throw new HttpError(400, 'passkeyVerifyFailed');
  const info = verified.registrationInfo;
  const backupEligible = info.credentialDeviceType === 'multiDevice';
  const now = nowIso();
  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO parent_passkeys (
           id, parent_id, credential_id, public_key, sign_count, transports, backed_up, backup_eligible,
           device_type, aaguid, friendly_name, created_at, last_used_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        parentId,
        info.credential.id,
        isoBase64URL.fromBuffer(info.credential.publicKey),
        info.credential.counter,
        JSON.stringify(info.credential.transports ?? []),
        info.credentialBackedUp ? 1 : 0,
        backupEligible ? 1 : 0,
        info.credentialDeviceType,
        info.aaguid,
        backupEligible ? text(locale).passkeySyncedName : text(locale).passkeyDeviceName,
        now,
        now,
      )
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNIQUE')) throw new HttpError(409, 'passkeyDuplicate');
    throw error;
  }
  return { id, passkeyCount: await passkeyCount(db, parentId) };
}

export async function verifyAuthentication(
  db: D1Database,
  rp: RelyingParty,
  response: AuthenticationResponseJSON,
): Promise<{ parentId: string; familyId: string }> {
  const challenge = readChallenge(response.response?.clientDataJSON);
  const consumed = await consumeChallenge(db, challenge, 'authentication', null);
  if (consumed !== 'ok') throw challengeError(consumed);
  const credentialId = typeof response.id === 'string' ? response.id : '';
  const row = await db
    .prepare(
      `SELECT id, parent_id, credential_id, public_key, sign_count, backup_eligible, backed_up, device_type
       FROM parent_passkeys WHERE credential_id = ?`,
    )
    .bind(credentialId)
    .first<StoredPasskey>();
  if (!row) throw new HttpError(401, 'passkeyFailed');
  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: false,
      credential: {
        id: row.credential_id,
        publicKey: isoBase64URL.toBuffer(row.public_key),
        counter: 0,
        transports: parseTransports(null),
      },
    });
  } catch (error) {
    console.error('[kid-star] passkey authenticate verify', error);
    throw new HttpError(401, 'passkeyFailed');
  }
  if (!verified.verified) throw new HttpError(401, 'passkeyFailed');
  const handle = response.response.userHandle;
  let handleId = '';
  try {
    handleId = handle ? isoBase64URL.toUTF8String(handle) : '';
  } catch {
    handleId = '';
  }
  if (!handleId || handleId !== row.parent_id) {
    console.log(JSON.stringify({ event: 'passkey_user_handle_mismatch', parentId: row.parent_id }));
    throw new HttpError(401, 'passkeyFailed');
  }
  const reportedEligible = verified.authenticationInfo.credentialDeviceType === 'multiDevice';
  const backupEligible = Number(row.backup_eligible) === 1 || reportedEligible;
  const decision = signCountDecision({
    backupEligible,
    stored: Number(row.sign_count),
    next: verified.authenticationInfo.newCounter,
  });
  if (decision.reject) {
    console.log(
      JSON.stringify({
        event: 'passkey_sign_count_clone',
        parentId: row.parent_id,
        credentialId: row.credential_id,
        stored: Number(row.sign_count),
        next: verified.authenticationInfo.newCounter,
      }),
    );
    throw new HttpError(401, 'passkeyFailed');
  }
  const now = nowIso();
  await db
    .prepare(
      `UPDATE parent_passkeys
       SET sign_count = ?, last_used_at = ?, backed_up = ?, backup_eligible = ?, device_type = ?
       WHERE id = ?`,
    )
    .bind(
      decision.signCount,
      now,
      verified.authenticationInfo.credentialBackedUp || Number(row.backed_up) === 1 ? 1 : 0,
      backupEligible ? 1 : 0,
      backupEligible ? 'multiDevice' : verified.authenticationInfo.credentialDeviceType,
      row.id,
    )
    .run();
  const parent = await db
    .prepare('SELECT id, family_id FROM parents WHERE id = ?')
    .bind(row.parent_id)
    .first<{ id: string; family_id: string }>();
  if (!parent) throw new HttpError(401, 'passkeyFailed');
  return { parentId: parent.id, familyId: parent.family_id };
}

export type PasskeySummary = {
  id: string;
  friendlyName: string;
  createdAt: string;
  lastUsedAt: string | null;
  deviceType: string | null;
  backedUp: boolean;
  backupEligible: boolean;
};

export async function listPasskeys(db: D1Database, parentId: string): Promise<PasskeySummary[]> {
  const rows = await db
    .prepare(
      `SELECT id, friendly_name, created_at, last_used_at, device_type, backed_up, backup_eligible
       FROM parent_passkeys WHERE parent_id = ? ORDER BY created_at ASC`,
    )
    .bind(parentId)
    .all<{
      id: string;
      friendly_name: string | null;
      created_at: string;
      last_used_at: string | null;
      device_type: string | null;
      backed_up: number;
      backup_eligible: number;
    }>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    friendlyName: row.friendly_name || 'Passkey',
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    deviceType: row.device_type,
    backedUp: Number(row.backed_up) === 1,
    backupEligible: Number(row.backup_eligible) === 1,
  }));
}

export async function renamePasskey(db: D1Database, parentId: string, id: string, name: string): Promise<void> {
  const updated = await db
    .prepare('UPDATE parent_passkeys SET friendly_name = ? WHERE id = ? AND parent_id = ?')
    .bind(name, id, parentId)
    .run();
  if (Number(updated.meta.changes ?? 0) !== 1) throw new HttpError(404, 'passkeyNotFound');
}

export async function deletePasskey(db: D1Database, parentId: string, id: string): Promise<number> {
  const updated = await db.prepare('DELETE FROM parent_passkeys WHERE id = ? AND parent_id = ?').bind(id, parentId).run();
  if (Number(updated.meta.changes ?? 0) !== 1) throw new HttpError(404, 'passkeyNotFound');
  return passkeyCount(db, parentId);
}

export async function passkeyCount(db: D1Database, parentId: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM parent_passkeys WHERE parent_id = ?').bind(parentId).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

function readChallenge(clientDataJSON: unknown): string {
  if (typeof clientDataJSON !== 'string' || !clientDataJSON) throw new HttpError(400, 'passkeyResponseInvalid');
  try {
    const data = decodeClientDataJSON(clientDataJSON);
    if (!data.challenge) throw new Error('missing challenge');
    return data.challenge;
  } catch {
    throw new HttpError(400, 'passkeyResponseInvalid');
  }
}

function parseTransports(value: string | null): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const transports = parsed.filter((item): item is string => typeof item === 'string');
    return transports.length ? transports : undefined;
  } catch {
    return undefined;
  }
}

export function asRegistrationResponse(body: Record<string, unknown>): RegistrationResponseJSON {
  const response = body.response;
  if (typeof body.id !== 'string' || !response || typeof response !== 'object' || Array.isArray(response)) {
    throw new HttpError(400, 'passkeyResponseInvalid');
  }
  const attestation = response as Record<string, unknown>;
  if (typeof attestation.clientDataJSON !== 'string' || typeof attestation.attestationObject !== 'string') {
    throw new HttpError(400, 'passkeyResponseInvalid');
  }
  return body as unknown as RegistrationResponseJSON;
}

export function asAuthenticationResponse(body: Record<string, unknown>): AuthenticationResponseJSON {
  const response = body.response;
  if (typeof body.id !== 'string' || !response || typeof response !== 'object' || Array.isArray(response)) {
    throw new HttpError(400, 'passkeyResponseInvalid');
  }
  const assertion = response as Record<string, unknown>;
  if (
    typeof assertion.clientDataJSON !== 'string' ||
    typeof assertion.authenticatorData !== 'string' ||
    typeof assertion.signature !== 'string'
  ) {
    throw new HttpError(400, 'passkeyResponseInvalid');
  }
  return body as unknown as AuthenticationResponseJSON;
}
