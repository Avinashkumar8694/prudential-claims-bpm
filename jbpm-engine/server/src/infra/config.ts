// Environment-driven configuration. Sensible zero-setup defaults for dev.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// jbpm-engine/server/src/infra/ -> up 3 -> jbpm-engine/ -> java-runtime/out
const defaultJavaSidecarClasspath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../java-runtime/out');

export interface Config {
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
}

const env = process.env;
export const config: Config = {
  port: Number(env.PORT || 4000),
  dataDir: env.DATA_DIR || path.resolve(process.cwd(), '.data'),
  store: (env.STORE as 'file' | 'pg') || 'file',
  // matches docker-compose.yml's default postgres service — `STORE=pg` works with zero extra config
  // once that container is up (see jbpm-engine/docker-compose.yml, `npm run docker:up`).
  pgUrl: env.PG_URL || 'postgresql://jbpm:jbpm@localhost:5433/jbpm',
  jwtSecret: env.JWT_SECRET || 'dev-insecure-secret-change-me',
  adminInitialPassword: env.ADMIN_INITIAL_PASSWORD || 'admin-change-me',
  integrationBaseUrl: env.INTEGRATION_BASE_URL || 'http://localhost:3000',
  scriptTimeoutMs: Number(env.SCRIPT_TIMEOUT_MS || 2000),
  wsPath: env.WS_PATH || '/ws',
  defaultTenant: env.DEFAULT_TENANT || 'default',
  javaSidecarClasspath: env.JAVA_SIDECAR_CLASSPATH || defaultJavaSidecarClasspath,
  javaSidecarStartupTimeoutMs: Number(env.JAVA_SIDECAR_STARTUP_TIMEOUT_MS || 10000),
  javaSidecarTimeoutMs: Number(env.JAVA_SIDECAR_TIMEOUT_MS || 10000),
};
