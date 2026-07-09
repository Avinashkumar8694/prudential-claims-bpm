// Script task — runs the node's JavaScript against kcontext in a sandbox; failure → SCRIPT_ERROR.
import type { NodeHandler } from '../types.ts';
import { runScript } from '../../sandbox.ts';
import { config } from '../../../infra/config.ts';

export const handler: NodeHandler = (c) => {
  const n = c.node;
  if (n.lang && n.lang !== 'js') return { outcome: 'skipped-nonjs' };
  const vars = { ...c.inst.variables };
  try { runScript(n.code || '', vars, config.scriptTimeoutMs); }
  catch (e) { return { error: `script failed: ${(e as Error).message}`, errorCode: 'SCRIPT_ERROR' }; }
  return { vars };
};
