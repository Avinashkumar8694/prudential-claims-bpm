// Service (REST) task — performs a real HTTP call; $var body substitution; resultTo maps the JSON
// response into variables; non-2xx / network failure → SERVICE_ERROR (catchable by an Error Catch).
import type { NodeHandler } from '../types.ts';
import { config } from '../../../infra/config.ts';

function jsonPath(obj: any, path: string): unknown {
  if (obj == null) return undefined;
  const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean);
  return parts.reduce((c: any, p) => (c == null ? c : c[p]), obj);
}

export const handler: NodeHandler = async (c) => {
  const n = c.node;
  const baseUrl = (c.dep.env && c.dep.env['INTEGRATION_LAYER_URL']) || config.integrationBaseUrl;
  const url = /^https?:\/\//.test(n.url || '') ? n.url : `${baseUrl}${n.url || ''}`;
  const method = String(n.method || 'POST').toUpperCase();
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n.body || {})) body[k] = (typeof v === 'string' && v.startsWith('$')) ? c.inst.variables[v.slice(1)] : v;
  try {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(n.headers || {}) },
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) return { error: `HTTP ${res.status} from ${url}`, errorCode: 'SERVICE_ERROR' };
    const text = await res.text();
    let json: any; try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
    const vars: Record<string, unknown> = {};
    for (const [varName, path] of Object.entries(n.resultTo || {})) vars[varName] = jsonPath(json, String(path));
    return { vars, outcome: `HTTP ${res.status}` };
  } catch (e) {
    return { error: `service call failed: ${(e as Error).message}`, errorCode: 'SERVICE_ERROR' };
  }
};
