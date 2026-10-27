// Business Rule task — evaluate a DMN decision (rule.dmn), a DRL ruleflow-group (rule.ruleflowGroup),
// a guided decision tree (rule.decisionTree) or a scorecard (rule.scorecard) over the instance
// variables; write results back. Failure → RULE_ERROR.
import type { NodeHandler } from '../types.ts';
import { evaluateDmn, evaluateRules, evaluateDecisionTree, evaluateScorecard } from '../../decisioning.ts';

export const handler: NodeHandler = (c) => {
  const n = c.node;
  try {
    if (n.dmn) return { vars: evaluateDmn(c.dep.engine, n.dmn, c.inst.variables), outcome: 'dmn' };
    if (n.decisionTree) return { vars: evaluateDecisionTree(c.dep.engine, n.decisionTree, c.inst.variables), outcome: `tree:${n.decisionTree}` };
    if (n.scorecard) return { vars: evaluateScorecard(c.dep.engine, n.scorecard, c.inst.variables), outcome: `scorecard:${n.scorecard}` };
    if (n.ruleflowGroup) return { vars: evaluateRules(c.dep.engine, n.ruleflowGroup, c.inst.variables), outcome: `rules:${n.ruleflowGroup}` };
    return {};
  } catch (e) { return { error: `rule evaluation failed: ${(e as Error).message}`, errorCode: 'RULE_ERROR' }; }
};
