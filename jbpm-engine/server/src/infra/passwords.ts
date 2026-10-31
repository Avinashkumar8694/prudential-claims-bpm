// scrypt-based password hashing, no external dependency (Node's built-in crypto). Stored format is
// "<hex-salt>:<128-hex-char-hash>" — matches the real surviving User.passwordHash records exactly
// (64-byte scrypt output), so this is at least internally consistent with pre-loss data, even though
// the original plaintext passwords themselves are unrecoverable.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, KEY_LEN).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const candidate = scryptSync(plain, salt, expected.length);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', 'qwertyui', 'qwerty123', 'iloveyou', 'admin123', 'welcome1', 'letmein1', 'admin-change-me']);

/** Password policy; returns a human-readable problem, or null when acceptable. */
/** `strict` (self-service: register, reset, change-own) also rejects common passwords and requires a letter and a digit;
 *  admin-provisioned passwords get length + identity checks only. */
export function passwordProblem(plain: unknown, minLength: number, identity?: string, strict = true): string | null {
  if (typeof plain !== 'string' || !plain) return 'password is required';
  if (plain.length < minLength) return `password must be at least ${minLength} characters`;
  if (plain.length > 128) return 'password must be at most 128 characters';
  const low = plain.toLowerCase();
  if (!strict) return null;
  if (COMMON.has(low)) return 'password is too common';
  const id = (identity || '').toLowerCase();
  if (id && (low === id || low === id.split('@')[0])) return 'password must not be your username or email';
  if (!/[a-zA-Z]/.test(plain) || !/[0-9]/.test(plain)) return 'password must contain at least one letter and one number';
  return null;
}
