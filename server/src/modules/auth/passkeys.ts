import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import crypto from 'node:crypto';
import type { AppContext, AuthUser } from '../../core/context.js';
import { logActivity, service } from '../../core/context.js';
import { HttpError, notFound } from '../../core/http.js';
import type { AlertService } from '../security/service.js';
import { describeDevice, type AuthService, type ClientInfo, type UserRow } from './service.js';

const CHALLENGE_TTL_MS = 5 * 60_000;

interface PasskeyRow {
  id: number;
  user_id: number;
  credential_id: string;
  public_key: Buffer;
  counter: number;
  transports: string;
}

/**
 * Biometric sign-in with passkeys (WebAuthn). The fingerprint / face scan
 * happens on the phone itself – the server only ever sees a signed proof,
 * never any biometric data. Works with Face ID / Touch ID on iPhone and
 * fingerprint / face unlock on Android.
 */
export class PasskeyService {
  constructor(private ctx: AppContext) {}

  private get auth() {
    return service<AuthService>(this.ctx, 'auth');
  }
  private get alerts() {
    return service<AlertService>(this.ctx, 'alerts');
  }
  private get cfg() {
    return this.ctx.config.webauthn;
  }

  private saveChallenge(challenge: string, purpose: 'register' | 'login', userId: number | null) {
    const id = crypto.randomBytes(16).toString('base64url');
    const now = new Date();
    this.ctx.db.prepare('DELETE FROM auth_challenges WHERE expires_at < ?').run(now.toISOString());
    this.ctx.db
      .prepare('INSERT INTO auth_challenges (id, challenge, user_id, purpose, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, challenge, userId, purpose, new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString());
    return id;
  }

  /** Each challenge can be used once. */
  private takeChallenge(id: string, purpose: 'register' | 'login') {
    const row = this.ctx.db
      .prepare('DELETE FROM auth_challenges WHERE id = ? AND purpose = ? AND expires_at > ? RETURNING challenge, user_id')
      .get(id, purpose, new Date().toISOString()) as { challenge: string; user_id: number | null } | undefined;
    if (!row) throw new HttpError(400, 'This sign-in request expired. Please try again.');
    return row;
  }

  list(userId: number) {
    return this.ctx.db.prepare('SELECT id, label, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY id DESC').all(userId);
  }

  async registrationOptions(user: AuthUser) {
    const existing = this.ctx.db.prepare('SELECT credential_id, transports FROM passkeys WHERE user_id = ?').all(user.id) as PasskeyRow[];
    const options = await generateRegistrationOptions({
      rpName: this.cfg.rpName,
      rpID: this.cfg.rpID,
      userName: user.username,
      userDisplayName: user.displayName,
      userID: new TextEncoder().encode(`slay-user-${user.id}`),
      attestationType: 'none',
      excludeCredentials: existing.map((p) => ({ id: p.credential_id, transports: splitTransports(p.transports) })),
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
    });
    return { challengeId: this.saveChallenge(options.challenge, 'register', user.id), options };
  }

  async register(user: AuthUser, challengeId: string, response: RegistrationResponseJSON, userAgent: string) {
    const ch = this.takeChallenge(challengeId, 'register');
    if (ch.user_id !== user.id) throw new HttpError(400, 'Request does not match the signed-in user');
    let result;
    try {
      result = await verifyRegistrationResponse({
        response,
        expectedChallenge: ch.challenge,
        expectedOrigin: this.cfg.origins,
        expectedRPID: this.cfg.rpID,
        requireUserVerification: true,
      });
    } catch (e) {
      console.warn('[passkeys] registration failed:', (e as Error).message);
      throw new HttpError(400, 'Couldn’t turn on fingerprint / face sign-in. Please try again – your password still works.');
    }
    if (!result.verified) throw new HttpError(400, 'Could not set up biometric login');
    const { credential } = result.registrationInfo;
    const label = describeDevice(userAgent);
    this.ctx.db
      .prepare('INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, label) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, credential.id, Buffer.from(credential.publicKey), credential.counter, (credential.transports ?? []).join(','), label);
    logActivity(this.ctx, user.id, 'passkey_added', 'user', user.id, { label });
    this.alerts.raise('passkey_added', 'info', `${user.displayName} turned on fingerprint / face login on ${label}.`, {}, user.id);
  }

  async loginOptions() {
    // No username needed: the phone offers the passkeys it holds for this app.
    const options = await generateAuthenticationOptions({ rpID: this.cfg.rpID, userVerification: 'required', allowCredentials: [] });
    return { challengeId: this.saveChallenge(options.challenge, 'login', null), options };
  }

  async login(challengeId: string, response: AuthenticationResponseJSON, client: ClientInfo) {
    this.auth.checkIpLimit(client.ip);
    const ch = this.takeChallenge(challengeId, 'login');
    const pk = this.ctx.db.prepare('SELECT * FROM passkeys WHERE credential_id = ?').get(response.id) as PasskeyRow | undefined;
    const fail = (msg: string, user?: UserRow) => {
      this.auth.recordAttempt(user?.username ?? '(biometric)', user?.id ?? null, client, false);
      return new HttpError(401, msg);
    };
    if (!pk) throw fail('This fingerprint / face login is no longer registered. Sign in with your password and turn it on again.');
    const user = this.auth.getUser(pk.user_id);
    if (!user.active || user.pending) throw fail(user.pending ? 'Your account is waiting for an owner to approve it.' : 'This account has been switched off.', user);
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: ch.challenge,
        expectedOrigin: this.cfg.origins,
        expectedRPID: this.cfg.rpID,
        requireUserVerification: true,
        credential: { id: pk.credential_id, publicKey: new Uint8Array(pk.public_key), counter: pk.counter, transports: splitTransports(pk.transports) },
      });
    } catch (e) {
      throw fail(`Biometric sign-in failed: ${(e as Error).message}`, user);
    }
    if (!result.verified) throw fail('Biometric sign-in failed', user);
    this.ctx.db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').run(result.authenticationInfo.newCounter, new Date().toISOString(), pk.id);
    this.auth.recordAttempt(user.username, user.id, client, true);
    return this.auth.startSession(user, client, 'biometric');
  }

  remove(user: AuthUser, id: number) {
    const res = this.ctx.db.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').run(id, user.id);
    if (!res.changes) throw notFound('Not found');
    logActivity(this.ctx, user.id, 'passkey_removed', 'user', user.id);
  }
}

const splitTransports = (s: string) => (s ? (s.split(',') as AuthenticatorTransportFuture[]) : undefined);
