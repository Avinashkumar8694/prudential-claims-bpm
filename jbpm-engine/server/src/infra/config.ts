const env = process.env;

export const config = {
  port: Number(env.PORT || 4000),
  wsPath: env.WS_PATH || '/ws',
  store: (env.STORE as 'memory' | 'file' | 'pg') || 'file',
  dataDir: env.DATA_DIR || '.data',
  pgUrl: env.PG_URL || 'postgresql://jbpm:jbpm@localhost:5433/jbpm',
  jwtSecret: env.JWT_SECRET || 'dev-secret-change-me',
  adminInitialPassword: env.ADMIN_INITIAL_PASSWORD || 'admin-change-me',
  scriptTimeoutMs: Number(env.SCRIPT_TIMEOUT_MS || 2000),
  integrationBaseUrl: env.INTEGRATION_LAYER_URL || env.INTEGRATION_BASE_URL || 'http://localhost:4000/api/_stub',
  executorIntervalMs: Number(env.EXECUTOR_INTERVAL_MS || 5000),
};
