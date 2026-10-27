// Work-item task — runs a named work-item handler (Email/SMS/DB/Compute/Log) with params ($var
// substitution), maps results back via resultTo. Failure → SERVICE_ERROR (catchable).
import type { NodeHandler } from '../types.ts';
import { WORKITEM_HANDLERS } from '../../workitems/registry.ts';

export const handler: NodeHandler = async (c) => {
  const n = c.node;
  const h = WORKITEM_HANDLERS[n.handler];
  if (!h) return { error: `unknown work-item handler "${n.handler}"`, errorCode: 'SERVICE_ERROR' };
  const params: Record<string, unknown> = {};
  const env = c.dep.env || {};
  const instVars = c.inst.variables || {};
  for (const [k, v] of Object.entries(n.params || {})) {
    if (typeof v === 'string') {
      if (v.startsWith('$')) {
        params[k] = instVars[v.slice(1)] ?? env[v.slice(1)];
      } else if (v.includes('${')) {
        params[k] = v.replace(/\$\{([^}]+)\}/g, (_, name) => String(instVars[name] ?? env[name] ?? process.env[name] ?? ''));
      } else {
        params[k] = v;
      }
    } else {
      params[k] = v;
    }
  }
  try {
    const result = await h(params, env);
    const vars: Record<string, unknown> = {};
    for (const [varName, key] of Object.entries(n.resultTo || {})) vars[varName] = (result as any)[String(key)];
    return { vars, outcome: `workitem:${n.handler}` };
  } catch (e) {
    return { error: `work item "${n.handler}" failed: ${(e as Error).message}`, errorCode: 'SERVICE_ERROR' };
  }
};
