// Script task — runs the node's script against kcontext in a sandbox; `js` runs natively, `java` runs
// in the JVM sidecar (see sandbox.ts / java-sidecar.ts); other dialects (e.g. mvel) are skipped.
import type { NodeHandler } from '../types.ts';
import { runScript } from '../../sandbox.ts';
import { config } from '../../../infra/config.ts';
import { varTypesOf, kcontextInfoOf, onActionOf } from '../kcontext-info.ts';
import { SettingsService } from '../../../modules/settings/service.ts';

export const handler: NodeHandler = async (c) => {
  const n = c.node;
  if (n.lang && n.lang !== 'js' && n.lang !== 'java') return { outcome: 'skipped-nonjs' };
  const vars = { ...c.inst.variables };
  const logs: string[] = [];
  const { maxConcurrentScripts } = await new SettingsService(c.app).get();
  try {
    await runScript(n.code || '', vars, config.scriptTimeoutMs, {
      ...kcontextInfoOf(c), log: (line) => logs.push(line), lang: n.lang,
      varTypes: varTypesOf(c), onAction: onActionOf(c),
      tenantId: c.app.tenantId, maxConcurrentScripts,
    });
  } catch (e) {
    const code = (e as { code?: string }).code === 'QUOTA_EXCEEDED' ? 'QUOTA_EXCEEDED' : 'SCRIPT_ERROR';
    return { error: `script failed: ${(e as Error).message}`, errorCode: code };
  }
  return { vars, ...(logs.length ? { outcome: logs.join('\n') } : {}) };
};
