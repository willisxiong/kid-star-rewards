import { isoBase64URL, isoCBOR, isoUint8Array } from '@simplewebauthn/server/helpers';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

const FLAG_UP = 1 << 0;
const FLAG_UV = 1 << 2;
const FLAG_BE = 1 << 3;
const FLAG_BS = 1 << 4;
const FLAG_AT = 1 << 6;

export type SoftwarePasskey = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  credentialId: Uint8Array;
  backupEligible: boolean;
  backedUp: boolean;
};

export async function createSoftwarePasskey(options?: {
  backupEligible?: boolean;
  backedUp?: boolean;
}): Promise<SoftwarePasskey> {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const credentialId = new Uint8Array(16);
  crypto.getRandomValues(credentialId);
  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    credentialId,
    backupEligible: options?.backupEligible ?? false,
    backedUp: Boolean(options?.backupEligible && options?.backedUp),
  };
}

export async function registrationResponse(
  passkey: SoftwarePasskey,
  options: { challenge: string; origin: string; rpID: string; signCount?: number },
): Promise<RegistrationResponseJSON> {
  const signCount = options.signCount ?? 0;
  const clientDataJSON = clientData('webauthn.create', options.challenge, options.origin);
  const authData = await authenticatorData(options.rpID, passkey, signCount, true);
  const attestationObject = isoCBOR.encode(
    new Map<string, unknown>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData],
    ]),
  );
  const id = isoBase64URL.fromBuffer(passkey.credentialId);
  return {
    id,
    rawId: id,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON,
      attestationObject: isoBase64URL.fromBuffer(attestationObject),
      transports: passkey.backupEligible ? ['internal', 'hybrid'] : ['internal'],
    },
  };
}

export async function authenticationResponse(
  passkey: SoftwarePasskey,
  options: { challenge: string; origin: string; rpID: string; userHandle: string; signCount: number },
): Promise<AuthenticationResponseJSON> {
  const clientDataJSON = clientData('webauthn.get', options.challenge, options.origin);
  const authData = await authenticatorData(options.rpID, passkey, options.signCount, false);
  const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', isoBase64URL.toBuffer(clientDataJSON)));
  const signed = isoUint8Array.concat([authData, clientDataHash]);
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, passkey.privateKey, signed));
  const signature = p256RawToDer(raw);
  const id = isoBase64URL.fromBuffer(passkey.credentialId);
  return {
    id,
    rawId: id,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON,
      authenticatorData: isoBase64URL.fromBuffer(authData),
      signature: isoBase64URL.fromBuffer(signature),
      userHandle: isoBase64URL.fromUTF8String(options.userHandle),
    },
  };
}

function clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin: string): string {
  return isoBase64URL.fromUTF8String(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

async function authenticatorData(
  rpID: string,
  passkey: SoftwarePasskey,
  signCount: number,
  attested: boolean,
): Promise<Uint8Array> {
  const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpID)));
  let flags = FLAG_UP | FLAG_UV;
  if (passkey.backupEligible) flags |= FLAG_BE;
  if (passkey.backedUp) flags |= FLAG_BS;
  if (attested) flags |= FLAG_AT;
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, signCount, false);
  const chunks: Uint8Array[] = [rpIdHash, Uint8Array.of(flags), counter];
  if (attested) {
    const credLen = new Uint8Array(2);
    new DataView(credLen.buffer).setUint16(0, passkey.credentialId.byteLength, false);
    chunks.push(new Uint8Array(16), credLen, passkey.credentialId, await cosePublicKey(passkey.publicKey));
  }
  return isoUint8Array.concat(chunks);
}

function p256RawToDer(signature: Uint8Array): Uint8Array {
  if (signature.byteLength !== 64) throw new Error('expected a 64-byte P-256 signature');
  const r = derInteger(signature.subarray(0, 32));
  const s = derInteger(signature.subarray(32));
  const body = new Uint8Array(r.byteLength + s.byteLength);
  body.set(r, 0);
  body.set(s, r.byteLength);
  const out = new Uint8Array(2 + body.byteLength);
  out[0] = 0x30;
  out[1] = body.byteLength;
  out.set(body, 2);
  return out;
}

function derInteger(component: Uint8Array): Uint8Array {
  let start = 0;
  while (start < component.byteLength - 1 && component[start] === 0) start += 1;
  const needsPad = (component[start] & 0x80) === 0x80;
  const length = component.byteLength - start + (needsPad ? 1 : 0);
  const out = new Uint8Array(2 + length);
  out[0] = 0x02;
  out[1] = length;
  if (needsPad) out.set(component.subarray(start), 3);
  else out.set(component.subarray(start), 2);
  return out;
}

async function cosePublicKey(publicKey: CryptoKey): Promise<Uint8Array> {
  const jwk = await crypto.subtle.exportKey('jwk', publicKey);
  if (!jwk.x || !jwk.y) throw new Error('P-256 public key was missing coordinates');
  return isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, isoBase64URL.toBuffer(jwk.x)],
      [-3, isoBase64URL.toBuffer(jwk.y)],
    ]),
  );
}
