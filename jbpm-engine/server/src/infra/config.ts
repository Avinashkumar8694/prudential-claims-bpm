// Environment-driven configuration. Sensible zero-setup defaults for dev.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// jbpm-engine/server/src/infra/ -> up 3 -> jbpm-engine/ -> java-runtime/out
const defaultJavaSidecarClasspath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../java-runtime/out');

export interface Config {
  appName: string;
  domain: string;
  port: number;
  dataDir: string;
  store: 'file' | 'pg';
  pgUrl?: string;
  jwtSecret: string;
  /** used only to seed the very first 'admin' user when no users exist yet at boot. */
  adminInitialPassword: string;
  integrationBaseUrl: string;
  scriptTimeoutMs: number;
  wsPath: string;
  defaultTenant: string;
  /** classpath dir for the Java sidecar (compiled bpmscript.* + Jackson-shim .class files) */
  javaSidecarClasspath: string;
  /** ms to wait for the sidecar JVM to print its ready line before giving up */
  javaSidecarStartupTimeoutMs: number;
  /** per-request timeout for a /execute call (first call per script includes a real javac compile) */
  javaSidecarTimeoutMs: number;
  /** hostnames (or ".suffix" domains) an HTTP service task's ABSOLUTE `url` is allowed to reach even
   *  if it resolves to a private/link-local/loopback range — see infra/outbound-guard.ts. A RELATIVE
   *  `url` (appended to integrationBaseUrl) is never gated; only an author-supplied absolute URL is. */
  outboundAllowlist: string[];
  /** production flag: NODE_ENV=production. Gates the weak-default-secret refusal below. */
  isProduction: boolean;
  /** single sign-on via the Identity Server (OIDC authorization code + PKCE). Unset issuer = SSO off. */
  oidc: OidcConfig;
  /** where the SPA lives: the SSO callback redirects here (tokens in the URL fragment). */
  dashboardUrl: string;
  /** feature flags and policy for the built-in (non-SSO) account system — all env-driven, surfaced to the UI by GET /auth/config */
  auth: AuthFeatures;
  /** outbound mail: SMTP (SMTP_*, aliases EMAIL_* as in rules-manager) or a JSON webhook relay; with neither, mails are only logged (never in production) */
  mail: { smtp?: { host: string; port: number; secure: boolean; user?: string; pass?: string }; webhookUrl?: string; from: string; capture: boolean };
  /** POST /auth/login (local username+password, HS256). Always on in dev; set AUTH_LOCAL_LOGIN=false to disable. */
  localLogin: boolean;
  /** the ONE platform administrator (system_admin everywhere). Fixed in code, deliberately not configurable. */
  platformAdminEmail: string;
}

export interface AuthFeatures {
  /** self-service account creation (needs localLogin) */
  registration: boolean;
  /** forgot / reset password (needs localLogin) */
  forgotPassword: boolean;
  /** a registered account cannot sign in until its email is verified */
  emailVerification: boolean;
  passwordMinLength: number;
  /** consecutive wrong passwords before the account is locked ... */
  maxFailedLogins: number;
  /** ... for this many minutes */
  lockoutMinutes: number;
}

export interface OidcConfig {
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
  /** accepted `aud` values for bearer tokens; defaults to the client id */
  audience: string[];
  clockToleranceSec: number;
}

const env = process.env;
/** The only system administrator. Always granted, never anyone else — not the first member, not the local `admin`. */
export const PLATFORM_ADMIN_EMAIL = 'arjunkumargupta108@gmail.com';
const isProduction = env.NODE_ENV === 'production';
const csv = (v?: string) => (v || '').split(',').map((h) => h.trim()).filter(Boolean);
const pick = (...names: string[]) => names.map((n) => env[n]?.trim()).find(Boolean);
const oidcClientId = pick('OIDC_CLIENT_ID', 'IDS_CLIENT_ID');
const port = Number(env.PORT || 4000);

export const config: Config = {
  appName: env.APP_NAME || 'Orkestr',
  domain: env.DOMAIN || 'orkestr.io',
  port,
  dataDir: env.DATA_DIR || path.resolve(process.cwd(), '.data'),
  store: (env.STORE as 'file' | 'pg') || 'file',
  // matches docker-compose.yml's default postgres service — `STORE=pg` works with zero extra config
  // once that container is up (see jbpm-engine/docker-compose.yml, `npm run docker:up`).
  pgUrl: env.PG_URL || 'postgresql://jbpm:jbpm@localhost:5433/jbpm',
  jwtSecret: env.JWT_SECRET || 'dev-insecure-secret-change-me',
  adminInitialPassword: env.ADMIN_INITIAL_PASSWORD || 'admin-change-me',
  integrationBaseUrl: env.INTEGRATION_BASE_URL || `https://api.${env.DOMAIN || 'orkestr.io'}`,
  scriptTimeoutMs: Number(env.SCRIPT_TIMEOUT_MS || 2000),
  wsPath: env.WS_PATH || '/ws',
  defaultTenant: env.DEFAULT_TENANT || 'default',
  javaSidecarClasspath: env.JAVA_SIDECAR_CLASSPATH || defaultJavaSidecarClasspath,
  javaSidecarStartupTimeoutMs: Number(env.JAVA_SIDECAR_STARTUP_TIMEOUT_MS || 10000),
  javaSidecarTimeoutMs: Number(env.JAVA_SIDECAR_TIMEOUT_MS || 10000),
  outboundAllowlist: csv(env.OUTBOUND_ALLOWLIST),
  isProduction,
  oidc: {
    issuer: pick('OIDC_ISSUER', 'IDS_ISSUER_URL')?.replace(/\/+$/, ''),
    clientId: oidcClientId,
    clientSecret: pick('OIDC_CLIENT_SECRET', 'IDS_CLIENT_SECRET'),
    redirectUri: pick('OIDC_REDIRECT_URI') || `http://localhost:${port}/api/auth/oidc/callback`,
    audience: csv(env.OIDC_AUDIENCE).length ? csv(env.OIDC_AUDIENCE) : (oidcClientId ? [oidcClientId] : []),
    clockToleranceSec: Number(env.OIDC_CLOCK_TOLERANCE_SEC || 30),
  },
  dashboardUrl: (env.DASHBOARD_URL || env.APP_ORIGIN || 'http://localhost:4200').replace(/\/+$/, ''),
  localLogin: env.AUTH_LOCAL_LOGIN !== 'false',
  auth: {
    registration: env.AUTH_REGISTRATION !== 'false',
    forgotPassword: env.AUTH_FORGOT_PASSWORD !== 'false',
    emailVerification: env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true',
    passwordMinLength: Math.max(8, Number(env.AUTH_PASSWORD_MIN_LENGTH || 8)),
    maxFailedLogins: Math.max(1, Number(env.AUTH_MAX_FAILED_LOGINS || 5)),
    lockoutMinutes: Math.max(1, Number(env.AUTH_LOCKOUT_MINUTES || 15)),
  },
  mail: {
    smtp: pick('SMTP_HOST', 'EMAIL_HOST') ? {
      host: pick('SMTP_HOST', 'EMAIL_HOST')!,
      port: Number(pick('SMTP_PORT', 'EMAIL_PORT') || 587),
      secure: (pick('SMTP_SECURE', 'EMAIL_SECURE') || 'false') === 'true',
      user: pick('SMTP_USER', 'EMAIL_USER'),
      pass: pick('SMTP_PASSWORD', 'SMTP_PASS', 'EMAIL_PASS'),
    } : undefined,
    webhookUrl: env.MAIL_WEBHOOK_URL?.trim() || undefined,
    from: pick('MAIL_FROM', 'EMAIL_FROM') || `no-reply@${env.DOMAIN || 'orkestr.io'}`,
    capture: env.MAIL_CAPTURE === 'true',
  },
  platformAdminEmail: PLATFORM_ADMIN_EMAIL,
};

/** Refuse to boot in production on insecure defaults (same posture as zero-payment-ms's settings validation). */
export function assertProductionConfig(c: Config = config): void {
  if (!c.isProduction) return;
  const problems: string[] = [];
  if (!c.jwtSecret || c.jwtSecret === 'dev-insecure-secret-change-me' || c.jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be set to a random value of at least 32 characters (it signs local tokens and the SSO login-transaction cookie)');
  }
  if (c.localLogin && c.adminInitialPassword === 'admin-change-me') {
    problems.push('ADMIN_INITIAL_PASSWORD must be changed (or disable local login with AUTH_LOCAL_LOGIN=false)');
  }
  if (c.oidc.issuer && !c.oidc.clientId) problems.push('OIDC_CLIENT_ID is required when OIDC_ISSUER is set');
  if (c.oidc.issuer && !/^https:\/\//.test(c.oidc.issuer)) problems.push('OIDC_ISSUER must be an https URL in production');
  if (!c.oidc.issuer && !c.localLogin) problems.push('No sign-in method configured: set OIDC_ISSUER or enable AUTH_LOCAL_LOGIN');
  if (problems.length) throw new Error(`Refusing to start in production:\n - ${problems.join('\n - ')}`);
}
