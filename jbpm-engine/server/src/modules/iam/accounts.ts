// Self-service account lifecycle for the built-in (non-SSO) login: register, verify email, forgot / reset
// password. Everything is flag-driven (config.auth.*) and the SSO path never touches it. Tokens are 256-bit,
// single-use, stored only as SHA-256, and expire. forgot-password and resend-verification answer the same
// whether or not the address exists, so they cannot be used to enumerate accounts.
import crypto from 'node:crypto';
import type { AppContext } from '../../context.ts';
import { Collections, type PendingRegistration, type User } from '../../domain.ts';
import { config } from '../../infra/config.ts';
import { hashPassword, verifyPassword } from '../../infra/auth.ts';
import { passwordProblem } from '../../infra/passwords.ts';
import { conflict, notFound, validation, authRequired, rateLimited, forbidden } from '../../infra/errors.ts';
import { isDisposableEmail } from '../../infra/disposable-domains.ts';
import { finishSignIn, sessionFor, verifySetupToken, type LoginResult } from './session.ts';
import { sendMail } from '../../infra/mailer.ts';
import { templates } from '../../infra/mail-templates.ts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const VERIFY_TTL_MS = 24 * 3600 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const RESEND_MIN_GAP_MS = 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
/** request bodies are untrusted: non-strings count as missing */
const lower = (s?: unknown) => (typeof s === 'string' ? s : '').trim().toLowerCase();

export class AccountService {
  constructor(private ctx: AppContext) {}
  private users() { return this.ctx.store.repo<User>(Collections.users); }
  private byEmail = async (email: string) => (await this.users().query((u) => u.tenantId === this.ctx.tenantId && (lower(u.email) === email || lower(u.username) === email)))[0];

  /** Shared gate for every self-registration: shape, reserved address, allowed domains, throw-away mailboxes, terms. */
  private checkRegistrable(input: { email?: unknown; tosAccepted?: unknown }): string {
    const email = lower(input.email);
    if (!EMAIL.test(email) || email.length > 254) throw validation('A valid email address is required');
    if (email === config.platformAdminEmail) throw validation('This address is reserved for single sign-on');   // the platform admin only ever signs in through the IdP
    const domain = email.split('@')[1]!;
    if (config.auth.allowedEmailDomains.length && !config.auth.allowedEmailDomains.includes(domain)) throw validation(`Registration is limited to these email domains: ${config.auth.allowedEmailDomains.join(', ')}`);
    if (config.auth.blockDisposableEmails && isDisposableEmail(email)) throw validation('Temporary or disposable email addresses are not allowed. Please use a valid personal or business email.');
    if (config.auth.tosUrl && input.tosAccepted !== true) throw validation('You must accept the Terms of Service to register');
    return email;
  }

  private pendings() { return this.ctx.store.repo<PendingRegistration>(Collections.pendingRegistrations); }
  private tempPassword() { return crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) + '9!Aa'; }

  /** Self-registration entry point. Which flow runs is configuration (AUTH_REGISTRATION_METHOD). */
  async register(input: { email?: string; password?: string; name?: string; tosAccepted?: boolean }): Promise<Record<string, unknown>> {
    if (config.auth.registrationMethod === 'password') return this.registerWithPassword(input);
    return this.registerWithTempPassword(input);
  }

  /**
   * The Identity-Server onboarding flow: the form collects NO password. A temporary password is emailed; the account is
   * created only when that password is used to sign in (proving the mailbox), and the first sign-in must replace it.
   * Always answers the same ("check your email") whether or not the address is new — an existing account is told by
   * email instead, so the endpoint cannot be used to enumerate users.
   */
  private async registerWithTempPassword(input: { email?: string; name?: string; tosAccepted?: boolean }): Promise<Record<string, unknown>> {
    const email = this.checkRegistrable(input);
    const name = (typeof input.name === 'string' ? input.name : '').trim().slice(0, 100) || email.split('@')[0];
    const now = this.ctx.clock();
    const answer = { method: 'temp_password', email, expiresInHours: config.auth.tempPasswordHours };

    const existing = await this.byEmail(email);
    if (existing && !existing.mustResetPassword) {
      void sendMail(templates.alreadyRegistered(email));                    // a confirmed account exists: tell its owner, tell the caller nothing
      return answer;
    }
    const hours = config.auth.tempPasswordHours;
    const expiresAt = new Date(Date.parse(now) + hours * 3600_000).toISOString();
    const temp = this.tempPassword();
    const tempHash = await hashPassword(temp);

    if (existing) {                                                        // created but never finished onboarding (e.g. temp password expired): re-issue
      if (existing.passwordResetSentAt && Date.parse(now) - Date.parse(existing.passwordResetSentAt) < RESEND_MIN_GAP_MS) return answer;
      existing.passwordHash = tempHash; existing.mustResetPassword = true; existing.tempPasswordExpiresAt = expiresAt; existing.passwordResetSentAt = now;
      existing.failedLogins = 0; existing.lockedUntil = null;
      await this.users().put(existing);
    } else {
      const pend = (await this.pendings().query((p) => p.tenantId === this.ctx.tenantId && p.email === email))[0];
      if (pend && Date.parse(now) - Date.parse(pend.lastSentAt) < RESEND_MIN_GAP_MS) return answer;   // throttle: one mail a minute per address
      await this.pendings().put({
        id: pend?.id ?? this.ctx.newId(), tenantId: this.ctx.tenantId, email, displayName: name, tempHash, expiresAt,
        createdAt: pend?.createdAt ?? now, lastSentAt: now, failedAttempts: 0, lockedUntil: null, tosAcceptedAt: config.auth.tosUrl ? now : null,
      });
    }
    await sendMail(templates.tempPassword(email, { name, tempPassword: temp, hours }));
    await this.ctx.audit({ actor: email, kind: 'user.registration_requested', data: { method: 'temp_password' } });
    return answer;
  }

  /** Called by sign-in when no account exists for `email`: a correct temporary password confirms the registration
   *  and creates the (verified, not-yet-usable-until-password-set) account. */
  async confirmPendingRegistration(email: string, password: string): Promise<User | undefined> {
    const pend = (await this.pendings().query((p) => p.tenantId === this.ctx.tenantId && p.email === email))[0];
    if (!pend) return undefined;
    const now = this.ctx.clock();
    if (pend.lockedUntil && pend.lockedUntil > now) throw rateLimited('Too many failed sign-in attempts. Try again later.');
    if (pend.expiresAt < now) { await this.pendings().delete(pend.id); throw forbidden('Your temporary password has expired. Register again to receive a new one.'); }
    if (!(await verifyPassword(password || '', pend.tempHash))) {
      pend.failedAttempts = (pend.failedAttempts ?? 0) + 1;
      if (pend.failedAttempts >= config.auth.maxFailedLogins) { pend.lockedUntil = new Date(Date.parse(now) + config.auth.lockoutMinutes * 60000).toISOString(); pend.failedAttempts = 0; }
      await this.pendings().put(pend);
      return undefined;
    }
    const u: User = {
      id: this.ctx.newId(), tenantId: this.ctx.tenantId, username: pend.email, email: pend.email, displayName: pend.displayName,
      passwordHash: pend.tempHash, roles: [], groups: [], active: true, createdAt: now,
      emailVerified: true,                       // possession of the emailed temporary password proves the mailbox
      mustResetPassword: true, tempPasswordExpiresAt: pend.expiresAt, tosAcceptedAt: pend.tosAcceptedAt ?? null,
    };
    await this.users().put(u);
    await this.pendings().delete(pend.id);
    await this.ctx.audit({ actor: u.username, kind: 'user.registered', data: { userId: u.id, method: 'temp_password' } });
    return u;
  }

  /** Step 2 of onboarding: replace the temporary password with a real one; returns the first real session. */
  async setInitialPassword(setupToken: string, newPassword: string): Promise<LoginResult> {
    const id = verifySetupToken(String(setupToken || ''));
    const u = await this.users().get(id);
    if (!u || !u.active || !u.mustResetPassword) throw authRequired('This step expired. Sign in again.');
    const now = this.ctx.clock();
    if (u.tempPasswordExpiresAt && u.tempPasswordExpiresAt < now) throw forbidden('Your temporary password has expired. Register again to receive a new one.');
    const pp = passwordProblem(newPassword, config.auth.passwordMinLength, u.username);
    if (pp) throw validation(pp);
    if (await verifyPassword(newPassword, u.passwordHash)) throw validation('choose a password different from the temporary one');
    u.passwordHash = await hashPassword(newPassword);
    u.mustResetPassword = false; u.tempPasswordExpiresAt = null; u.passwordChangedAt = now; u.emailVerified = true; u.failedLogins = 0; u.lockedUntil = null;
    await this.users().put(u);
    await this.ctx.audit({ actor: u.username, kind: 'user.password_set', data: { userId: u.id, onboarding: true } });
    if (u.email) void sendMail(templates.welcome(u.email, u.displayName || u.email.split('@')[0]));
    return sessionFor(u);
  }

  // ---- passwordless: emailed 6-digit sign-in code ----
  async requestOtp(emailIn: string): Promise<void> {
    const u = await this.byEmail(lower(emailIn));
    if (!u || !u.active || !u.email) return;                               // same answer either way
    const now = this.ctx.clock();
    if (u.otpSentAt && Date.parse(now) - Date.parse(u.otpSentAt) < RESEND_MIN_GAP_MS) return;
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    u.otpHash = sha(`${u.id}:${code}`); u.otpExpiresAt = new Date(Date.parse(now) + OTP_TTL_MS).toISOString(); u.otpAttempts = 0; u.otpSentAt = now;
    await this.users().put(u);
    await sendMail(templates.otp(u.email, { code, minutes: OTP_TTL_MS / 60000 }));
  }

  async verifyOtp(emailIn: string, code: string): Promise<LoginResult> {
    const u = await this.byEmail(lower(emailIn));
    const now = this.ctx.clock();
    const bad = () => authRequired('That code is invalid or has expired');
    if (!u || !u.active || !u.otpHash || !u.otpExpiresAt) throw bad();
    if (u.lockedUntil && u.lockedUntil > now) throw rateLimited('Too many failed sign-in attempts. Try again later.');
    if (u.otpExpiresAt < now) { u.otpHash = null; await this.users().put(u); throw bad(); }
    const given = sha(`${u.id}:${String(code || '').trim()}`);
    if (!crypto.timingSafeEqual(Buffer.from(given), Buffer.from(u.otpHash))) {
      u.otpAttempts = (u.otpAttempts ?? 0) + 1;
      if (u.otpAttempts >= OTP_MAX_ATTEMPTS) u.otpHash = null;             // five wrong guesses burn the code
      await this.users().put(u);
      throw bad();
    }
    u.otpHash = null; u.otpExpiresAt = null; u.otpAttempts = 0; u.failedLogins = 0; u.lockedUntil = null; u.emailVerified = true;
    await this.users().put(u);
    return finishSignIn(u, now);
  }

  /** An invitee follows the link in their invitation email and sets a password: the token proves the mailbox, so the
   *  account is created verified. (Works even when open registration is off — like the Identity Server's /activate.) */
  async activateInvitedAccount(email: string, password: string, name?: string): Promise<void> {
    const e = lower(email);
    if (await this.byEmail(e)) throw conflict('An account with this email already exists — sign in instead');
    if (e === config.platformAdminEmail) throw validation('This address is reserved for single sign-on');
    const pp = passwordProblem(password, config.auth.passwordMinLength, e);
    if (pp) throw validation(pp);
    const now = this.ctx.clock();
    const u: User = { id: this.ctx.newId(), tenantId: this.ctx.tenantId, username: e, email: e, displayName: (typeof name === 'string' ? name.trim().slice(0, 100) : '') || e.split('@')[0], passwordHash: await hashPassword(password), roles: [], groups: [], active: true, createdAt: now, emailVerified: true };
    await this.users().put(u);
    await this.ctx.audit({ actor: e, kind: 'user.registered', data: { userId: u.id, method: 'invitation' } });
    void sendMail(templates.welcome(e, u.displayName!));
  }

  /** Self-chosen-password registration (AUTH_REGISTRATION_METHOD=password), optionally with email verification. */
  private async registerWithPassword(input: { email?: string; password?: string; name?: string; tosAccepted?: boolean }): Promise<{ id: string; email: string; verificationRequired: boolean }> {
    const email = this.checkRegistrable(input);
    const name = (typeof input.name === 'string' ? input.name : '').trim().slice(0, 100) || email.split('@')[0];
    const pp = passwordProblem(input.password, config.auth.passwordMinLength, email);
    if (pp) throw validation(pp);
    if (await this.byEmail(email)) throw conflict('An account with this email already exists');

    const now = this.ctx.clock();
    const u: User = {
      id: this.ctx.newId(), tenantId: this.ctx.tenantId, username: email, email, displayName: name,
      passwordHash: await hashPassword(input.password!), roles: [], groups: [], active: true, createdAt: now,
      emailVerified: false,
    };
    const verificationRequired = config.auth.emailVerification;
    if (verificationRequired) await this.issueVerification(u);
    await this.users().put(u);
    if (!verificationRequired) void sendMail(templates.welcome(email, name));
    await this.ctx.audit({ actor: email, kind: 'user.registered', data: { userId: u.id } });
    return { id: u.id, email, verificationRequired };
  }

  private async issueVerification(u: User) {
    const token = newToken();
    u.verificationHash = sha(token);
    u.verificationExpiresAt = new Date(Date.parse(this.ctx.clock()) + VERIFY_TTL_MS).toISOString();
    await sendMail(templates.verification(u.email!, token));
  }

  async verifyEmail(token: string): Promise<void> {
    const h = sha(String(token || ''));
    const u = (await this.users().query((x) => x.verificationHash === h))[0];
    if (!u || !u.verificationExpiresAt || u.verificationExpiresAt < this.ctx.clock()) throw notFound('Verification link');
    u.emailVerified = true; u.verificationHash = null; u.verificationExpiresAt = null;
    await this.users().put(u);
    await this.ctx.audit({ actor: u.username, kind: 'user.email_verified', data: { userId: u.id } });
    if (u.email) void sendMail(templates.welcome(u.email, u.displayName || u.email.split('@')[0]));
  }

  async resendVerification(emailIn: string): Promise<void> {
    const u = await this.byEmail(lower(emailIn));
    if (!u || u.emailVerified !== false || !u.email || !config.auth.emailVerification) return;
    await this.issueVerification(u);
    await this.users().put(u);
  }

  async forgotPassword(emailIn: string): Promise<void> {
    const u = await this.byEmail(lower(emailIn));
    if (!u || !u.active || !u.email) return;                                   // same answer either way
    if (u.passwordResetSentAt && Date.parse(this.ctx.clock()) - Date.parse(u.passwordResetSentAt) < RESEND_MIN_GAP_MS) return;
    const token = newToken();
    u.passwordResetHash = sha(token);
    u.passwordResetExpiresAt = new Date(Date.parse(this.ctx.clock()) + RESET_TTL_MS).toISOString();
    u.passwordResetSentAt = this.ctx.clock();
    await this.users().put(u);
    await sendMail(templates.passwordReset(u.email, token));
    await this.ctx.audit({ actor: u.username, kind: 'user.password_reset_requested', data: { userId: u.id } });
  }

  /** Describes a reset link without using it (lets the page show "expired" before the user types a password). */
  async checkResetToken(token: string): Promise<boolean> {
    const h = sha(String(token || ''));
    const u = (await this.users().query((x) => x.passwordResetHash === h))[0];
    return !!u && !!u.passwordResetExpiresAt && u.passwordResetExpiresAt >= this.ctx.clock();
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const h = sha(String(token || ''));
    const u = (await this.users().query((x) => x.passwordResetHash === h))[0];
    if (!u || !u.passwordResetExpiresAt || u.passwordResetExpiresAt < this.ctx.clock()) throw notFound('Reset link');
    const pp = passwordProblem(newPassword, config.auth.passwordMinLength, u.username);
    if (pp) throw validation(pp);
    if (await verifyPassword(newPassword, u.passwordHash)) throw validation('choose a password you have not used before');
    const now = this.ctx.clock();
    u.passwordHash = await hashPassword(newPassword);
    u.passwordResetHash = null; u.passwordResetExpiresAt = null; u.passwordChangedAt = now;
    u.failedLogins = 0; u.lockedUntil = null;
    u.emailVerified = true;                        // following the emailed link proves the mailbox
    await this.users().put(u);
    await this.ctx.audit({ actor: u.username, kind: 'user.password_reset', data: { userId: u.id } });
    if (u.email) void sendMail(templates.passwordChanged(u.email, 'reset'));
  }
}
