export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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

export function sessionCookie(token: string, requestUrl: string, maxAge: number): string {
  const secure = new URL(requestUrl).protocol === 'https:';
  // Expires is last. Its HTTP-date contains a comma; if a proxy splits the
  // header there, Max-Age is already present and still makes the cookie persistent.
  const expires = maxAge > 0 ? new Date(Date.now() + maxAge * 1000).toUTCString() : 'Thu, 01 Jan 1970 00:00:00 GMT';
  const parts = [
    `ks_session=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    `Expires=${expires}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(requestUrl: string): string {
  return sessionCookie('', requestUrl, 0);
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
    throw new HttpError(500, '服务器未配置 SESSION_SECRET');
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
