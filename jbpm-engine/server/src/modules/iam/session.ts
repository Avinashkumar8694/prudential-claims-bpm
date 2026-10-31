// What a successful credential check turns into: a session token — or, for an account that is still on its emailed
// temporary password, a short-lived SETUP token that may only be used to choose a real password.
import jwt from 'jsonwebtoken';
import type { User } from '../../domain.ts';
import { config } from '../../infra/config.ts';
import { signToken } from '../../infra/auth.ts';
import { forbidden, authRequired } from '../../infra/errors.ts';

/** Never serialise credentials or one-time-token material: the public user shape carries none of it. */
export const SECRET_FIELDS = ['passwordHash', 'verificationHash', 'verificationExpiresAt', 'passwordResetHash', 'passwordResetExpiresAt', 'passwordResetSentAt', 'failedLogins', 'lockedUntil', 'otpHash', 'otpExpiresAt', 'otpAttempts', 'otpSentAt', 'tempPasswordExpiresAt'] as const;
export type PublicUser = Omit<User, (typeof SECRET_FIELDS)[number]>;
export const sanitize = (u: User): PublicUser => { const rest: any = { ...u }; for (const k of SECRET_FIELDS) delete rest[k]; return rest; };

export type LoginResult =
  | { token: string; user: PublicUser }
  | { passwordSetupRequired: true; setupToken: string; user: { email?: string; displayName?: string } };

// Signed with a different key than session tokens, so a setup token can never be replayed as a bearer token.
const setupKey = () => `${config.jwtSecret}::password-setup`;
export const setupTokenFor = (u: User) => jwt.sign({ sub: u.id, purpose: 'set-password' }, setupKey(), { algorithm: 'HS256', expiresIn: '15m' });
export function verifySetupToken(token: string): string {
  try {
    const p = jwt.verify(token, setupKey(), { algorithms: ['HS256'] }) as { sub?: string; purpose?: string };
    if (p.purpose !== 'set-password' || !p.sub) throw new Error('wrong purpose');
    return p.sub;
  } catch { throw authRequired('This step expired. Sign in again.'); }
}

export function sessionFor(u: User): { token: string; user: PublicUser } {
  const token = signToken({ sub: u.id, username: u.username, roles: u.roles, groups: u.groups, email: u.email || (u.username.includes('@') ? u.username.toLowerCase() : undefined), emailVerified: u.emailVerified !== false, name: u.displayName });
  return { token, user: sanitize(u) };
}

/** Called after the credential (password / temp password / OTP) has been verified. */
export function finishSignIn(u: User, now: string): LoginResult {
  if (config.auth.emailVerification && u.emailVerified === false) throw forbidden('Verify your email address before signing in');
  if (u.mustResetPassword) {
    if (u.tempPasswordExpiresAt && u.tempPasswordExpiresAt < now) throw forbidden('Your temporary password has expired. Register again to receive a new one.');
    return { passwordSetupRequired: true, setupToken: setupTokenFor(u), user: { email: u.email, displayName: u.displayName } };
  }
  return sessionFor(u);
}
