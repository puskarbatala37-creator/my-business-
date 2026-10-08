import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser';
import { api } from './api';

const FLAG = 'slay.biometric'; // this device has a passkey for Slay
const OFFERED = 'slay.biometricOffered';

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const apple = /iPhone|iPad|Macintosh/.test(ua);

/** What to call it on this phone. */
export const biometricName = apple ? 'Face ID / Touch ID' : /Android/.test(ua) ? 'fingerprint / face unlock' : 'fingerprint / face';

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {}
  },
};

/** True when this device has a built-in fingerprint / face sensor the browser can use. */
export async function biometricAvailable(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

export const biometricEnrolledHere = () => store.get(FLAG) === '1';
export const markOffered = () => store.set(OFFERED, '1');
export const wasOffered = () => store.get(OFFERED) === '1';
export const forgetBiometricHere = () => store.set(FLAG, null);

function friendly(e: unknown): Error {
  const err = e as Error;
  if (err.name === 'NotAllowedError' || (e instanceof WebAuthnError && e.code === 'ERROR_CEREMONY_ABORTED')) return new Error('Cancelled – you can use your password instead.');
  if (e instanceof WebAuthnError && e.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return new Error(`${biometricName} is already set up on this device.`);
  return err;
}

/** Registers this phone's fingerprint / face sensor for the signed-in user. */
export async function enrollBiometric() {
  const { challengeId, options } = await api.post<{ challengeId: string; options: any }>('/api/auth/passkeys/options');
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch (e) {
    const err = friendly(e);
    if (err.message.includes('already set up')) store.set(FLAG, '1');
    throw err;
  }
  await api.post('/api/auth/passkeys', { challengeId, response });
  store.set(FLAG, '1');
  markOffered();
}

/** Signs in with fingerprint / face. No username needed. */
export async function biometricLogin() {
  const { challengeId, options } = await api.post<{ challengeId: string; options: any }>('/api/auth/passkey/login/options');
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch (e) {
    throw friendly(e);
  }
  try {
    await api.post('/api/auth/passkey/login', { challengeId, response });
  } catch (e) {
    if ((e as Error).message.includes('no longer registered')) forgetBiometricHere();
    throw e;
  }
  store.set(FLAG, '1');
}
