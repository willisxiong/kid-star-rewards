import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/browser';
import { currentLocale, text } from '../lib/i18n';
import { api } from './api';

export function browserSupportsPasskey(): boolean {
  return typeof PublicKeyCredential !== 'undefined' && typeof navigator.credentials?.create === 'function';
}

export async function authenticateWithPasskey(): Promise<{ ok: boolean; message: string }> {
  const copy = text(currentLocale());
  const options = await api<PublicKeyCredentialRequestOptionsJSON & { message?: string }>('/api/auth/passkey/authenticate/options', {
    method: 'POST',
    body: '{}',
  });
  if (options.status !== 200 || !options.data.challenge) {
    return { ok: false, message: options.data.message || copy.passkeyFailed };
  }
  let credential: AuthenticationResponseJSON;
  try {
    credential = await startAuthentication({ optionsJSON: options.data });
  } catch {
    return { ok: false, message: copy.passkeyFailed };
  }
  const verified = await api<{ message?: string }>('/api/auth/passkey/authenticate/verify', {
    method: 'POST',
    body: JSON.stringify(credential),
  });
  if (verified.status !== 200) return { ok: false, message: verified.data.message || copy.passkeyFailed };
  return { ok: true, message: verified.data.message || copy.passkeySignedIn };
}

export async function registerPasskey(): Promise<{ ok: boolean; message: string; passkeyCount?: number; unauthorized?: boolean }> {
  const copy = text(currentLocale());
  const options = await api<PublicKeyCredentialCreationOptionsJSON & { message?: string; error?: string }>(
    '/api/auth/passkey/register/options',
    { method: 'POST', body: '{}' },
  );
  if (options.status === 401) return { ok: false, message: options.data.message || copy.loginRequired, unauthorized: true };
  if (options.status !== 200 || !options.data.challenge) {
    return { ok: false, message: options.data.message || copy.passkeyUnavailable };
  }
  let credential: RegistrationResponseJSON;
  try {
    credential = await startRegistration({ optionsJSON: options.data });
  } catch {
    return { ok: false, message: copy.passkeyRegisterFailed };
  }
  const verified = await api<{ message?: string; passkeyCount?: number }>('/api/auth/passkey/register/verify', {
    method: 'POST',
    body: JSON.stringify(credential),
  });
  if (verified.status !== 200) return { ok: false, message: verified.data.message || copy.passkeyRegisterFailed };
  return { ok: true, message: verified.data.message || copy.passkeyRegistered, passkeyCount: verified.data.passkeyCount };
}
