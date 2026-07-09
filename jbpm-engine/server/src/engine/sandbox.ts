// Minimal JS sandbox for script tasks and flow conditions. Dev-grade isolation via node:vm
// (docs/07 mandates isolated-vm for prod). Only `js` runs; other dialects are not evaluated.
import vm from 'node:vm';

export function runScript(code: string, vars: Record<string, unknown>, timeoutMs: number): void {
  const kcontext = {
    getVariable: (n: string) => vars[n],
    setVariable: (n: string, v: unknown) => { vars[n] = v; },
  };
  const sandbox: Record<string, unknown> = { kcontext, console: { log: () => {} } };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: timeoutMs });
}

/** Evaluate a boolean flow condition. Only `js` executes; other langs (java/mvel) → false. */
export function evalCondition(expr: string | undefined, lang: string | undefined, vars: Record<string, unknown>, timeoutMs = 500): boolean {
  if (!expr) return true;
  if (lang && lang !== 'js') return false;
  const sandbox: Record<string, unknown> = { ...vars };
  vm.createContext(sandbox);
  const body = /return\b/.test(expr) ? expr : `return (${expr});`;
  try { return !!vm.runInContext(`(function(){ ${body} })()`, sandbox, { timeout: timeoutMs }); }
  catch { return false; }
}
