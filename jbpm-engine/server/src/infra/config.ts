// Environment-driven configuration. Sensible zero-setup defaults for dev.
import path from 'node:path';

export interface Config {
  port: number;
  dataDir: string;
  store: 'file' | 'pg';
  pgUrl?: string;
  jwtSecret: string;
  integrationBaseUrl: string;
  scriptTimeoutMs: number;
  wsPath: string;
  defaultTenant: string;
}

const env = process.env;
export const config: Config = {
  port: Number(env.PORT || 4000),
  dataDir: env.DATA_DIR || path.resolve(process.cwd(), '.data'),
  store: (env.STORE as 'file' | 'pg') || 'file',
  pgUrl: env.PG_URL,
  jwtSecret: env.JWT_SECRET || 'dev-insecure-secret-change-me',
  integrationBaseUrl: env.INTEGRATION_BASE_URL || 'http://localhost:3000',
  scriptTimeoutMs: Number(env.SCRIPT_TIMEOUT_MS || 2000),
  wsPath: env.WS_PATH || '/ws',
  defaultTenant: env.DEFAULT_TENANT || 'default',
};
