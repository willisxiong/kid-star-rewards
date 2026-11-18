import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/browser';
import { api } from './api';

export function browserSupportsPasskey(): boolean {
  return typeof PublicKeyCredential !== 'undefined' && typeof navigator.credentials?.create === 'function';
}

export async function authenticateWithPasskey(): Promise<{ ok: boolean; message: string }> {
  const options = await api<PublicKeyCredentialRequestOptionsJSON & { message?: string }>('/api/auth/passkey/authenticate/options', {
    method: 'POST',
    body: '{}',
  });
  if (options.status !== 200 || !options.data.challenge) {
    return { ok: false, message: '未能使用 Passkey，请改用登录链接。' };
  }
  let credential: AuthenticationResponseJSON;
  try {
    credential = await startAuthentication({ optionsJSON: options.data });
  } catch {
    return { ok: false, message: '未能使用 Passkey，请改用登录链接。' };
  }
  const verified = await api<{ message?: string }>('/api/auth/passkey/authenticate/verify', {
    method: 'POST',
    body: JSON.stringify(credential),
  });
  if (verified.status !== 200) return { ok: false, message: '未能使用 Passkey，请改用登录链接。' };
  return { ok: true, message: verified.data.message || '已使用 Passkey 登录' };
}

export async function registerPasskey(): Promise<{ ok: boolean; message: string; passkeyCount?: number }> {
  const options = await api<PublicKeyCredentialCreationOptionsJSON & { message?: string; error?: string }>(
    '/api/auth/passkey/register/options',
    { method: 'POST', body: '{}' },
  );
  if (options.status === 401) return { ok: false, message: '请先登录' };
  if (options.status !== 200 || !options.data.challenge) {
    return { ok: false, message: options.data.message || '暂时无法登记 Passkey' };
  }
  let credential: RegistrationResponseJSON;
  try {
    credential = await startRegistration({ optionsJSON: options.data });
  } catch {
    return { ok: false, message: '未能登记 Passkey，请再试一次。' };
  }
  const verified = await api<{ message?: string; passkeyCount?: number }>('/api/auth/passkey/register/verify', {
    method: 'POST',
    body: JSON.stringify(credential),
  });
  if (verified.status !== 200) return { ok: false, message: verified.data.message || '未能登记 Passkey，请再试一次。' };
  return { ok: true, message: verified.data.message || 'Passkey 已登记', passkeyCount: verified.data.passkeyCount };
}
