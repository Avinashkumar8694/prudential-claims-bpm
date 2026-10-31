// OpenID Connect against the Identity Server (same contract zero-payment-ms uses): authorization code +
// PKCE (S256) with state + nonce, client_secret_basic at the token endpoint, bearer/ID tokens verified
// against the issuer's own JWKS (asymmetric algorithms only — there is no shared secret to forge with).
//
// Dependency-free on purpose (fetch + node:crypto + the already-present jsonwebtoken): the surface is
// small, and every step that matters for security (state/nonce/PKCE, iss/aud/exp, alg allow-list) is
// visible in one file.
//
// Discovery is LAZY with retry back-off, so an IdP that is briefly down at boot does not leave login
// and bearer verification broken until the process restarts.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.ts';

const SCOPE = 'openid email profile';
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const DISCOVERY_RETRY_MS = 15_000;
const JWKS_TTL_MS = 10 * 60 * 1000;
const JWKS_REFRESH_COOLDOWN_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;

/** never HMAC: an OIDC token must be verifiable with the issuer's public key only. */
const ALLOWED_ALGORITHMS: jwt.Algorithm[] = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'];

interface Metadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}
interface Jwk { kid?: string; kty: string; use?: string; [k: string]: unknown }

export interface OidcTransaction { v: string; s: string; n: string; r?: string }
export interface OidcTokens { access_token?: string; id_token?: string; expires_in?: number }
export interface OidcClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  exp?: number;
  [k: string]: unknown;
}

const b64url = (b: Buffer) => b.toString('base64url');
const timeout = () => AbortSignal.timeout(FETCH_TIMEOUT_MS);

export class Oidc {
  private meta?: Metadata;
  private discoveredAt = 0;
  private lastFailureAt = 0;
  private inFlight?: Promise<Metadata>;
  private keys?: Jwk[];
  private keysAt = 0;

  isConfigured(): boolean { return !!config.oidc.issuer && !!config.oidc.clientId; }

  async metadata(): Promise<Metadata> {
    const issuer = config.oidc.issuer;
    if (!issuer) throw new Error('OIDC is not configured (set OIDC_ISSUER)');
    const now = Date.now();
    if (this.meta && now - this.discoveredAt < DISCOVERY_TTL_MS) return this.meta;
    if (!this.meta && this.lastFailureAt && now - this.lastFailureAt < DISCOVERY_RETRY_MS) throw new Error('OIDC issuer is unavailable (retrying shortly)');
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      try {
        const res = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: timeout() });
        if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
        const m = (await res.json()) as Metadata;
        if (m.issuer?.replace(/\/+$/, '') !== issuer) throw new Error('OIDC discovery issuer mismatch');
        if (!m.authorization_endpoint || !m.token_endpoint || !m.jwks_uri) throw new Error('OIDC discovery document is incomplete');
        this.meta = m; this.discoveredAt = Date.now(); this.lastFailureAt = 0;
        return m;
      } catch (e) {
        this.lastFailureAt = Date.now();
        // a stale document beats an outage once we have ever discovered successfully
        if (this.meta) return this.meta;
        throw e;
      } finally { this.inFlight = undefined; }
    })();
    return this.inFlight;
  }

  /** Step 1: build the authorize URL and the transaction (verifier/state/nonce) the caller must keep for the callback. */
  async authorizationRequest(returnTo?: string): Promise<{ url: string; tx: OidcTransaction }> {
    const m = await this.metadata();
    const verifier = b64url(crypto.randomBytes(32));
    const tx: OidcTransaction = { v: verifier, s: b64url(crypto.randomBytes(16)), n: b64url(crypto.randomBytes(16)), ...(returnTo ? { r: returnTo } : {}) };
    const u = new URL(m.authorization_endpoint);
    u.search = new URLSearchParams({
      response_type: 'code',
      client_id: config.oidc.clientId!,
      redirect_uri: config.oidc.redirectUri,
      scope: SCOPE,
      state: tx.s,
      nonce: tx.n,
      code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
    }).toString();
    return { url: u.toString(), tx };
  }

  /** Step 2: validate state, exchange the code (+PKCE verifier) and validate the ID token (signature, iss, aud, exp, nonce). */
  async handleCallback(query: Record<string, unknown>, tx: OidcTransaction): Promise<OidcTokens> {
    const m = await this.metadata();
    if (typeof query.state !== 'string' || !timingEq(query.state, tx.s)) throw new Error('state mismatch');
    if (typeof query.code !== 'string' || !query.code) throw new Error('missing authorization code');

    const body = new URLSearchParams({ grant_type: 'authorization_code', code: query.code, redirect_uri: config.oidc.redirectUri, code_verifier: tx.v });
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
    const { clientId, clientSecret } = config.oidc;
    if (clientSecret) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId!)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`;
    else body.set('client_id', clientId!);

    const res = await fetch(m.token_endpoint, { method: 'POST', headers, body, signal: timeout() });
    const json = (await res.json().catch(() => ({}))) as OidcTokens & { error?: string };
    if (!res.ok) throw new Error(json.error || `token endpoint HTTP ${res.status}`);
    if (!json.id_token) throw new Error('token response has no id_token');

    const idClaims = await this.verify(json.id_token, [clientId!]);
    if (!idClaims || idClaims.nonce !== tx.n) throw new Error('nonce mismatch');
    return json;
  }

  /** Verify a signed JWT against the issuer's JWKS. Returns null for anything unverifiable (fail closed). */
  async verify(token: string, audience: string[] = config.oidc.audience): Promise<(OidcClaims & Record<string, unknown>) | null> {
    try {
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || typeof decoded.payload === 'string') return null;
      const alg = decoded.header.alg;
      if (!ALLOWED_ALGORITHMS.includes(alg as jwt.Algorithm)) return null;
      const key = await this.signingKey(decoded.header.kid);
      const claims = jwt.verify(token, key, {
        algorithms: ALLOWED_ALGORITHMS,
        issuer: [config.oidc.issuer!, `${config.oidc.issuer}/`],
        clockTolerance: config.oidc.clockToleranceSec,
        ...(audience.length ? { audience: audience as [string, ...string[]] } : {}),
      });
      if (typeof claims === 'string' || !claims.sub) return null;
      return claims as OidcClaims;
    } catch { return null; }
  }

  async logoutUrl(idTokenHint?: string): Promise<string | undefined> {
    try {
      const m = await this.metadata();
      if (!m.end_session_endpoint) return undefined;
      const u = new URL(m.end_session_endpoint);
      u.searchParams.set('client_id', config.oidc.clientId!);
      u.searchParams.set('post_logout_redirect_uri', config.dashboardUrl);
      if (idTokenHint) u.searchParams.set('id_token_hint', idTokenHint);
      return u.toString();
    } catch { return undefined; }
  }

  private async signingKey(kid?: string): Promise<crypto.KeyObject> {
    const pick = (keys: Jwk[]) => { const sig = keys.filter((k) => k.use !== 'enc'); return kid ? sig.find((k) => k.kid === kid) : sig[0]; };
    let match = pick(await this.jwks());
    if (!match && kid) match = pick(await this.jwks(true));   // unknown kid: the issuer may have rotated
    if (!match) throw new Error(`no JWKS key for kid "${kid}"`);
    return crypto.createPublicKey({ key: match as unknown as crypto.JsonWebKey, format: 'jwk' });
  }

  private async jwks(force = false): Promise<Jwk[]> {
    const now = Date.now();
    if (this.keys && !force && now - this.keysAt < JWKS_TTL_MS) return this.keys;
    if (this.keys && force && now - this.keysAt < JWKS_REFRESH_COOLDOWN_MS) return this.keys;  // unknown-kid flood != JWKS flood
    const m = await this.metadata();
    const res = await fetch(m.jwks_uri, { signal: timeout() });
    if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    if (!body.keys) throw new Error('JWKS has no keys');
    this.keys = body.keys; this.keysAt = now;
    return this.keys;
  }

  /** test hook */
  reset() { this.meta = undefined; this.keys = undefined; this.discoveredAt = this.keysAt = this.lastFailureAt = 0; }
}

function timingEq(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export const oidc = new Oidc();

// --- signed, HttpOnly login-transaction cookie (state/nonce/verifier are bound to the browser that started login) ---

export const TX_COOKIE = 'oidc_tx';
export const TX_COOKIE_PATH = '/api/auth/oidc';

const sign = (payload: string) => crypto.createHmac('sha256', config.jwtSecret).update(payload).digest('base64url');

export function sealTx(tx: OidcTransaction): string {
  const payload = Buffer.from(JSON.stringify({ ...tx, exp: Date.now() + 10 * 60 * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function openTx(raw: string | undefined): OidcTransaction | undefined {
  if (!raw) return undefined;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig || !timingEq(sig, sign(payload))) return undefined;
  try {
    const t = JSON.parse(Buffer.from(payload, 'base64url').toString()) as OidcTransaction & { exp: number };
    if (!t.v || !t.s || !t.n || t.exp < Date.now()) return undefined;
    return t;
  } catch { return undefined; }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
