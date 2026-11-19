import type { ErrorKey } from '../lib/i18n';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly key: ErrorKey;

  constructor(status: number, key: ErrorKey, code = 'error') {
    super(key);
    this.status = status;
    this.code = code;
    this.key = key;
  }
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export const PARENT_SESSION_SECONDS = 60 * 60 * 24 * 14;
export const CHILD_SESSION_SECONDS = 60 * 60 * 48;
export const PARENT_SESSION_COOKIE = 'ks_parent_session';
export const CHILD_SESSION_COOKIE = 'ks_child_session';
export const LEGACY_SESSION_COOKIE = 'ks_session';

export function sessionCookie(name: string, token: string, requestUrl: string, maxAge: number): string {
  const secure = new URL(requestUrl).protocol === 'https:';
  // Expires is last. Its HTTP-date contains a comma; if a proxy splits the
  // header there, Max-Age is already present and still makes the cookie persistent.
  const expires = maxAge > 0 ? new Date(Date.now() + maxAge * 1000).toUTCString() : 'Thu, 01 Jan 1970 00:00:00 GMT';
  const parts = [
    `${name}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    `Expires=${expires}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(name: string, requestUrl: string): string {
  return sessionCookie(name, '', requestUrl, 0);
}

export function remainingSeconds(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let binary = '';
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function requireSecret(env: Env): string {
  const secret = env.SESSION_SECRET ?? '';
  if (secret.length < 16) {
    throw new HttpError(500, 'secretMissing');
  }
  return secret;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
