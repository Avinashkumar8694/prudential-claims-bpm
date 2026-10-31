// Self-service account lifecycle for the built-in (non-SSO) login: register, verify email, forgot / reset
// password. Everything is flag-driven (config.auth.*) and the SSO path never touches it. Tokens are 256-bit,
// single-use, stored only as SHA-256, and expire. forgot-password and resend-verification answer the same
// whether or not the address exists, so they cannot be used to enumerate accounts.
import crypto from 'node:crypto';
import type { AppContext } from '../../context.ts';
import { Collections, type User } from '../../domain.ts';
import { config } from '../../infra/config.ts';
import { hashPassword, verifyPassword } from '../../infra/auth.ts';
import { passwordProblem } from '../../infra/passwords.ts';
import { conflict, notFound, validation } from '../../infra/errors.ts';
import { sendMail } from '../../infra/mailer.ts';
import { templates } from '../../infra/mail-templates.ts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const VERIFY_TTL_MS = 24 * 3600 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const RESEND_MIN_GAP_MS = 60 * 1000;
const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
/** request bodies are untrusted: non-strings count as missing */
const lower = (s?: unknown) => (typeof s === 'string' ? s : '').trim().toLowerCase();

export class AccountService {
  constructor(private ctx: AppContext) {}
  private users() { return this.ctx.store.repo<User>(Collections.users); }
  private byEmail = async (email: string) => (await this.users().query((u) => u.tenantId === this.ctx.tenantId && (lower(u.email) === email || lower(u.username) === email)))[0];

  async register(input: { email?: string; password?: string; name?: string }): Promise<{ id: string; email: string; verificationRequired: boolean }> {
    const email = lower(input.email);
    if (!EMAIL.test(email) || email.length > 254) throw validation('A valid email address is required');
    const name = (typeof input.name === 'string' ? input.name : '').trim().slice(0, 100) || email.split('@')[0];
    const pp = passwordProblem(input.password, config.auth.passwordMinLength, email);
    if (pp) throw validation(pp);
    if (await this.byEmail(email)) throw conflict('An account with this email already exists');
    if (email === config.platformAdminEmail) throw validation('This address is reserved for single sign-on');   // the platform admin only ever signs in through the IdP

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
