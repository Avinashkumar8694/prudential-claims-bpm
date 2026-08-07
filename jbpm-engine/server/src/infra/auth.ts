// Password hashing (Node's own scrypt — no extra dependency for this half) + JWT sign/verify. JWTs
// use the well-audited `jsonwebtoken` library rather than hand-rolled token code: this is exactly the
// kind of code where a subtle bug (algorithm confusion, timing leaks) is a security bug, not merely a
// correctness one, so a vetted library is the safer choice over saving one dependency.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { config } from './config.ts';

const scrypt = promisify(scryptCb) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(hashHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export interface JwtClaims { sub: string; username: string; roles: string[]; groups: string[]; }

export function signToken(claims: JwtClaims): string {
  return jwt.sign(claims, config.jwtSecret, { expiresIn: '12h' });
}

/** Throws (jsonwebtoken's own JsonWebTokenError/TokenExpiredError) on a missing/invalid/expired token —
 *  callers (requireAuth) turn that into a 401. */
export function verifyToken(token: string): JwtClaims {
  return jwt.verify(token, config.jwtSecret) as JwtClaims;
}

/** action strings a role grants: exact match, '*' (everything), or a 'ns:*' namespace wildcard. */
export function permissionGrants(permissions: string[], action: string): boolean {
  return permissions.some((p) => p === '*' || p === action || (p.endsWith(':*') && action.startsWith(p.slice(0, -1))));
}
