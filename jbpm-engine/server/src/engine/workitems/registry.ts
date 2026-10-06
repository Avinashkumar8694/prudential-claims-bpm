// Built-in work-item handlers for the 'workItem' node type. Each handler receives resolved params
// ($var references already substituted by work-item/handler.ts) and this deployment's own env map;
// if the relevant *_SERVICE_URL env var is set, it POSTs there for real, otherwise it simulates.
export type WorkItemHandler = (params: Record<string, unknown>, env: Record<string, string>) => Promise<Record<string, unknown>>;

async function callOrSimulate(url: string | undefined, params: Record<string, unknown>, simulated: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!url) return { ...simulated, simulated: true };
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
  const text = await res.text();
  let json: unknown; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`work-item service returned HTTP ${res.status}`);
  return (json && typeof json === 'object' ? json as Record<string, unknown> : { result: json }) ;
}

export const WORKITEM_HANDLERS: Record<string, WorkItemHandler> = {
  Email: (params, env) => callOrSimulate(env.EMAIL_SERVICE_URL, params, { sent: true, to: params.to }),
  SMS: (params, env) => callOrSimulate(env.SMS_SERVICE_URL, params, { sent: true, to: params.to }),
  DBQuery: (params, env) => callOrSimulate(env.DB_SERVICE_URL, params, { rows: [] }),
  Compute: async (params) => {
    const expr = String(params.expression ?? '');
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${expr});`)();
    return { result };
  },
  Log: async (params) => { return { logged: true, message: String(params.message ?? '') }; },
};

export const WORKITEM_NAMES = Object.keys(WORKITEM_HANDLERS);
