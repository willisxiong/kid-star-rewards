import type { D1Database } from './d1';
import { loadSession, type SessionRow } from './data';
import {
  CHILD_SESSION_COOKIE,
  clearSessionCookie,
  LEGACY_SESSION_COOKIE,
  PARENT_SESSION_COOKIE,
  readCookie,
  remainingSeconds,
  sessionCookie,
  sha256,
} from './http';

export type ResolvedSessions = {
  parent: SessionRow | null;
  child: SessionRow | null;
  setCookies: string[];
};

const EMPTY: ResolvedSessions = { parent: null, child: null, setCookies: [] };

export async function resolveSessions(
  db: D1Database,
  secret: string,
  cookieHeader: string | undefined,
  requestUrl: string,
): Promise<ResolvedSessions> {
  const parentToken = readCookie(cookieHeader, PARENT_SESSION_COOKIE);
  const childToken = readCookie(cookieHeader, CHILD_SESSION_COOKIE);
  const legacyToken = readCookie(cookieHeader, LEGACY_SESSION_COOKIE);
  if (!parentToken && !childToken && !legacyToken) return EMPTY;

  const setCookies: string[] = [];
  let parent = await sessionFor(db, secret, parentToken, 'parent');
  let child = await sessionFor(db, secret, childToken, 'child');

  if (legacyToken && legacyToken !== parentToken && legacyToken !== childToken) {
    const legacy = await loadSession(db, await sha256(`${secret}:${legacyToken}`));
    setCookies.push(clearSessionCookie(LEGACY_SESSION_COOKIE, requestUrl));
    if (legacy?.role === 'parent' && !parent) {
      parent = legacy;
      setCookies.push(sessionCookie(PARENT_SESSION_COOKIE, legacyToken, requestUrl, remainingSeconds(legacy.expires_at)));
    } else if (legacy?.role === 'child' && !child) {
      child = legacy;
      setCookies.push(sessionCookie(CHILD_SESSION_COOKIE, legacyToken, requestUrl, remainingSeconds(legacy.expires_at)));
    }
  } else if (legacyToken) {
    setCookies.push(clearSessionCookie(LEGACY_SESSION_COOKIE, requestUrl));
  }

  return { parent, child, setCookies };
}

async function sessionFor(
  db: D1Database,
  secret: string,
  token: string | null,
  role: 'parent' | 'child',
): Promise<SessionRow | null> {
  if (!token) return null;
  const session = await loadSession(db, await sha256(`${secret}:${token}`));
  if (!session || session.role !== role) return null;
  return session;
}
