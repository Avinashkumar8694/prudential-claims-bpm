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
