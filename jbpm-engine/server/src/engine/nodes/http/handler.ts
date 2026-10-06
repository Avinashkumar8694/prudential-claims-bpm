// Service (REST) task — performs a real HTTP call; $var body substitution; resultTo maps the JSON
// response into variables; non-2xx / network failure → SERVICE_ERROR (catchable by an Error Catch).
import type { NodeHandler } from '../types.ts';
import { config } from '../../../infra/config.ts';
import { runScript } from '../../sandbox.ts';
import { varTypesOf, kcontextInfoOf, onActionOf } from '../kcontext-info.ts';
import { assertOutboundAllowed } from '../../../infra/outbound-guard.ts';
import { SettingsService } from '../../../modules/settings/service.ts';

function jsonPath(obj: any, path: string): unknown {
  if (obj == null) return undefined;
  const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean);
  return parts.reduce((c: any, p) => (c == null ? c : c[p]), obj);
}

export const handler: NodeHandler = async (c) => {
  const n = c.node as any;
  const baseUrl = (c.dep.env && c.dep.env['INTEGRATION_LAYER_URL']) || config.integrationBaseUrl;
  const isAbsolute = /^https?:\/\//.test(n.url || '');
  const url = isAbsolute ? n.url : `${baseUrl}${n.url || ''}`;
  const method = String(n.method || 'POST').toUpperCase();
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n.body || {})) body[k] = (typeof v === 'string' && v.startsWith('$')) ? c.inst.variables[v.slice(1)] : v;
  if (isAbsolute) {
    try { await assertOutboundAllowed(url); }
    catch (e) { return { error: (e as Error).message, errorCode: 'SSRF_BLOCKED' }; }
  }
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
    if (n.exitScript && n.lang && n.lang !== 'js' && n.lang !== 'java') {
      return { vars, outcome: `HTTP ${res.status} (exit script skipped: unsupported dialect "${n.lang}")` };
    }
    if (n.exitScript) {
      const scriptVars: Record<string, unknown> = { ...c.inst.variables, ...vars, resPayload: text };
      const varTypes: Record<string, string> = { resPayload: 'String', ...varTypesOf(c) };
      try {
        const { maxConcurrentScripts } = await new SettingsService(c.app).get();
        await runScript(String(n.exitScript), scriptVars, config.scriptTimeoutMs, {
          ...kcontextInfoOf(c), lang: n.lang, varTypes, onAction: onActionOf(c),
          tenantId: c.app.tenantId, maxConcurrentScripts,
        });
        delete scriptVars.resPayload;
        Object.assign(vars, scriptVars);
      } catch (e) {
        const code = (e as { code?: string }).code === 'QUOTA_EXCEEDED' ? 'QUOTA_EXCEEDED'
          : (e as { code?: string }).code === 'JAVA_SIDECAR_UNAVAILABLE' ? 'JAVA_SIDECAR_UNAVAILABLE'
          : 'SCRIPT_ERROR';
        return { error: `exitScript failed: ${(e as Error).message}`, errorCode: code };
      }
    }
    return { vars, outcome: `HTTP ${res.status}` };
  } catch (e) {
    return { error: `service call failed: ${(e as Error).message}`, errorCode: 'SERVICE_ERROR' };
  }
};
