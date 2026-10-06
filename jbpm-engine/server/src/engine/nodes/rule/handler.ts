// Business Rule task — evaluate a DMN decision (rule.dmn) or a DRL ruleflow-group (rule.ruleflowGroup,
// not available in this build — see decisioning.ts) over the instance variables; write results back.
import type { NodeHandler } from '../types.ts';
import type { EngineDecisionModel } from '../../../sdk/index.ts';
import { evaluateDmn, evaluateRules } from '../../decisioning.ts';
import { Collections, type Asset } from '../../../domain.ts';

export const handler: NodeHandler = async (c) => {
  const n = c.node as any;
  try {
    if (n.dmn) {
      const assets = await c.app.store.repo<Asset>(Collections.assets).query((a) =>
        a.tenantId === c.app.tenantId && a.workflowId === c.inst.workflowId && a.kind === 'decisions');
      const findModel = (namespace: string | undefined, model: string) =>
        assets.find((a) => a.name === model || (a.model as EngineDecisionModel)?.namespace === namespace)?.model as EngineDecisionModel | undefined;
      return { vars: evaluateDmn(findModel, n.dmn, c.inst.variables), outcome: 'dmn' };
    }
    if (n.ruleflowGroup) return { vars: evaluateRules(n.ruleflowGroup, c.inst.variables), outcome: `rules:${n.ruleflowGroup}` };
    return {};
  } catch (e) {
    const code = (e as { code?: string }).code === 'RULE_ENGINE_UNAVAILABLE' ? 'RULE_ENGINE_UNAVAILABLE' : 'RULE_ERROR';
    return { error: `rule evaluation failed: ${(e as Error).message}`, errorCode: code };
  }
};
