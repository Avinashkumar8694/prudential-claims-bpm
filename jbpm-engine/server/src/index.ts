import { createApp } from './app.ts';
import { MemoryStore } from './store/memory-store.ts';
import { FileStore } from './store/file-store.ts';
import { makeContext, type AppContext } from './context.ts';
import { config } from './infra/config.ts';
import { newId } from './infra/ids.ts';
import type { Store } from './store/types.ts';
import { Collections, type Role, type User } from './domain.ts';
import { hashPassword } from './infra/passwords.ts';
import { startTimerExecutor } from './engine/timer-executor.ts';

function buildStore(): Store {
  if (config.store === 'memory') return new MemoryStore();
  if (config.store === 'file') return new FileStore(config.dataDir);
  throw new Error('STORE=pg is not implemented in this rebuild yet (the TypeORM/Postgres backend was lost along with the rest of the source) — set STORE=file or STORE=memory instead.');
}

const store = buildStore();
function makeCtx(tenantId: string): AppContext {
  return makeContext({ store, tenantId, clock: () => new Date().toISOString(), newId });
}

async function seedIfEmpty(ctx: AppContext): Promise<void> {
  const users = await ctx.store.repo<User>(Collections.users).query(() => true);
  if (users.length) return;
  await ctx.store.repo<Role>(Collections.roles).put({ id: newId(), tenantId: ctx.tenantId, name: 'admin', permissions: ['*'] });
  await ctx.store.repo<User>(Collections.users).put({
    id: newId(), tenantId: ctx.tenantId, username: 'admin',
    passwordHash: hashPassword(config.adminInitialPassword), roles: ['admin'], groups: [], active: true, createdAt: ctx.clock(),
  });
  console.log(`Seeded initial admin user for tenant "${ctx.tenantId}" (ADMIN_INITIAL_PASSWORD env, or the dev default if unset).`);
}

async function main(): Promise<void> {
  await seedIfEmpty(makeCtx('default'));
  const app = createApp(makeCtx);
  const server = app.listen(config.port, () => console.log(`jbpm-engine listening on :${config.port} (store: ${config.store})`));
  server.on('error', (err) => { console.error('Failed to start server:', err); process.exit(1); });

  const stopTimers = startTimerExecutor({ store, makeCtx }, config.executorIntervalMs);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => { stopTimers(); server.close(() => process.exit(0)); });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
