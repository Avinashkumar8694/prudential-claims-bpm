// Work-item handler framework — pluggable executors for operation tasks (Email/SMS/DB/Compute/Log),
// the Node equivalent of jBPM WorkItemHandlers. Each returns result data mapped back to variables.
// External handlers (Email/SMS/DB) POST to a service URL from the deployment env when configured,
// otherwise they simulate (record) so flows run without live credentials.
import vm from 'node:vm';

export type WorkItemHandler = (params: Record<string, unknown>, env: Record<string, string>) => Promise<Record<string, unknown>>;

async function callService(url: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const t = await res.text();
  try { return t ? JSON.parse(t) : {}; } catch { return { raw: t }; }
}

export const WORKITEM_HANDLERS: Record<string, WorkItemHandler> = {
  // record only (audit/logging)
  Log: async (p) => ({ logged: true, message: p['message'] ?? p }),
  // evaluate a JS expression with params in scope → { result }
  Compute: async (p) => {
    const expr = String(p['expression'] ?? p['expr'] ?? '');
    if (!expr) return { result: undefined };
    const sandbox: Record<string, unknown> = { ...p };
    vm.createContext(sandbox);
    return { result: vm.runInContext(`(${expr})`, sandbox, { timeout: 1000 }) };
  },
  // external side-effects — call the configured service, else simulate
  Email: async (p, env) => (env['EMAIL_SERVICE_URL'] ? { ...(await callService(env['EMAIL_SERVICE_URL'], p)), sent: true } : { sent: true, simulated: true, to: p['to'] }),
  SMS: async (p, env) => (env['SMS_SERVICE_URL'] ? { ...(await callService(env['SMS_SERVICE_URL'], p)), sent: true } : { sent: true, simulated: true, to: p['to'] }),
  DBQuery: async (p, env) => (env['DB_SERVICE_URL'] ? await callService(env['DB_SERVICE_URL'], p) : { rows: [], simulated: true }),
};

export const WORKITEM_NAMES = Object.keys(WORKITEM_HANDLERS);
