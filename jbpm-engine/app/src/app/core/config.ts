// Build-time and runtime configuration for Orkestr dashboard & landing page.
// Supports runtime injection via window.__ENV__ and process.env fallback.

function readEnv(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const winEnv: Record<string, unknown> =
  (typeof window !== 'undefined' && (window as unknown as { __ENV__?: Record<string, unknown> }).__ENV__) || {};

const procEnv: Record<string, string | undefined> =
  (typeof globalThis !== 'undefined' &&
    (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env) ||
  {};

export const APP_NAME: string =
  readEnv(winEnv['APP_NAME']) ||
  readEnv(procEnv['APP_NAME']) ||
  'Orkestr';

export const APP_INITIALS: string = (
  APP_NAME.match(/[A-Z]/g)?.slice(0, 2).join('') || APP_NAME.slice(0, 2)
).toUpperCase();

export const DOMAIN: string =
  readEnv(winEnv['DOMAIN']) ||
  readEnv(procEnv['DOMAIN']) ||
  (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
    ? window.location.hostname
    : 'orkestr.io');

export const API_ORIGIN: string =
  readEnv(winEnv['API_BASE_URL']) ||
  readEnv(procEnv['API_BASE_URL']) ||
  (typeof window !== 'undefined' ? window.location.origin : '');

export const API_BASE: string = `${API_ORIGIN}/api`;

export const DOCS_URL: string = readEnv(winEnv['DOCS_URL']) || '/api/docs';

export const CONTACT_EMAIL: string =
  readEnv(winEnv['CONTACT_EMAIL']) ||
  readEnv(procEnv['CONTACT_EMAIL']) ||
  `sales@${DOMAIN}`;

export const INTEGRATION_BASE_URL: string =
  readEnv(winEnv['INTEGRATION_BASE_URL']) ||
  readEnv(procEnv['INTEGRATION_BASE_URL']) ||
  `https://api.${DOMAIN}`;
