// Environment-driven configuration. Sensible zero-setup defaults for dev.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// jbpm-engine/server/src/infra/ -> up 3 -> jbpm-engine/ -> java-runtime/out
const defaultJavaSidecarClasspath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../java-runtime/out');

export interface Config {
  port: number;
  dataDir: string;
  /** Storage backend: 'file' for zero-dependency local dev; 'pg' for staging/production multi-replica. */
  store: 'file' | 'pg';
  /** Full PostgreSQL connection URL (e.g. postgresql://user:pass@host:5432/dbname or via PgBouncer :6432) */
  pgUrl?: string;
  /** Maximum client connections in the PostgreSQL connection pool (default: 20 per replica) */
  pgPoolMax: number;
  /** Idle timeout (ms) before an unused connection is closed from the pool (default: 30000) */
  pgPoolIdleTimeoutMs: number;
  /** Connection timeout (ms) when acquiring a new connection from PostgreSQL (default: 5000) */
  pgPoolConnectionTimeoutMs: number;
  /** Process role: 'all' (API + Timer Worker), 'api' (stateless HTTP/WS only), 'worker' (background scheduler only) */
  role: 'all' | 'api' | 'worker';
  /** Interval in ms between timer scheduler ticks (default: 5000) */
  timerTickIntervalMs: number;
  /** Max due timer jobs to fetch and process in a single tick batch (default: 50) */
  timerBatchSize: number;
  /** 32-bit integer key for PostgreSQL advisory lock to coordinate active-active timer ticks (default: 424242) */
  timerAdvisoryLockKey: number;
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
}

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const defaultJwtSecret = 'dev-insecure-secret-change-me';

if (isProd && (!env.JWT_SECRET || env.JWT_SECRET === defaultJwtSecret)) {
  throw new Error('FATAL SECURITY ERROR: JWT_SECRET must be explicitly configured with a strong secret in production mode (NODE_ENV=production).');
}

export const config: Config = {
  port: Number(env.PORT || 4000),
  dataDir: env.DATA_DIR || path.resolve(process.cwd(), '.data'),
  store: (env.STORE as 'file' | 'pg') || 'file',
  // matches docker-compose.yml's postgres service — `STORE=pg` works with zero extra config
  // once that container is up (see jbpm-engine/docker-compose.yml, `npm run docker:up`).
  pgUrl: env.PG_URL || 'postgresql://jbpm:jbpm@localhost:5434/jbpm',
  pgPoolMax: Number(env.PG_POOL_MAX || 20),
  pgPoolIdleTimeoutMs: Number(env.PG_POOL_IDLE_TIMEOUT_MS || 30000),
  pgPoolConnectionTimeoutMs: Number(env.PG_POOL_CONNECTION_TIMEOUT_MS || 5000),
  role: (env.ROLE as 'all' | 'api' | 'worker') || 'all',
  timerTickIntervalMs: Number(env.TIMER_TICK_INTERVAL_MS || 5000),
  timerBatchSize: Number(env.TIMER_BATCH_SIZE || 50),
  timerAdvisoryLockKey: Number(env.TIMER_ADVISORY_LOCK_KEY || 424242),
  jwtSecret: env.JWT_SECRET || 'dev-insecure-secret-change-me',
  adminInitialPassword: env.ADMIN_INITIAL_PASSWORD || 'admin-change-me',
  integrationBaseUrl: env.INTEGRATION_BASE_URL || 'http://localhost:3000',
  scriptTimeoutMs: Number(env.SCRIPT_TIMEOUT_MS || 2000),
  wsPath: env.WS_PATH || '/ws',
  defaultTenant: env.DEFAULT_TENANT || 'default',
  javaSidecarClasspath: env.JAVA_SIDECAR_CLASSPATH || defaultJavaSidecarClasspath,
  javaSidecarStartupTimeoutMs: Number(env.JAVA_SIDECAR_STARTUP_TIMEOUT_MS || 10000),
  javaSidecarTimeoutMs: Number(env.JAVA_SIDECAR_TIMEOUT_MS || 10000),
  outboundAllowlist: (env.OUTBOUND_ALLOWLIST || '').split(',').map((h) => h.trim()).filter(Boolean),
};
