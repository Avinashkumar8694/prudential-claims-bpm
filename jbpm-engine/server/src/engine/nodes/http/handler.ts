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
  const n = c.node;
  const baseUrl = (c.dep.env && c.dep.env['INTEGRATION_LAYER_URL']) || config.integrationBaseUrl;
  const isAbsolute = /^https?:\/\//.test(n.url || '');
  const url = isAbsolute ? n.url : `${baseUrl}${n.url || ''}`;
  const method = String(n.method || 'POST').toUpperCase();
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n.body || {})) body[k] = (typeof v === 'string' && v.startsWith('$')) ? c.inst.variables[v.slice(1)] : v;
  // only an author-supplied ABSOLUTE url is SSRF-gated — see outbound-guard.ts's own doc comment for
  // why the relative/baseUrl path (operator-configured, trusted) is deliberately left alone.
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
    if (n.exitScript) {
      // jBPM-parity exit hook: raw response available as resPayload, resultTo already applied
      const scriptVars: Record<string, unknown> = { ...c.inst.variables, ...vars, resPayload: text };
      // bare-name binding for lang:'java' (real jBPM's own JavaActionBuilder mechanism — see
      // script/handler.ts); resPayload is a synthesized variable (not in c.proc.vars) but real jBPM
      // exit scripts reference it constantly (`resPayload.isEmpty()` etc.), so it's always declared
      // as String on top of whatever's actually declared for this process.
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
        const code = (e as { code?: string }).code === 'QUOTA_EXCEEDED' ? 'QUOTA_EXCEEDED' : 'SCRIPT_ERROR';
        return { error: `exitScript failed: ${(e as Error).message}`, errorCode: code };
      }
    }
    return { vars, outcome: `HTTP ${res.status}` };
  } catch (e) {
    return { error: `service call failed: ${(e as Error).message}`, errorCode: 'SERVICE_ERROR' };
  }
};
