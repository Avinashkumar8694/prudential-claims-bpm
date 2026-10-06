// Business Rule task evaluation. DMN decision tables are genuinely re-implemented here (a real,
// well-specified decision-table matcher). DRL ruleflow-group evaluation is NOT available in this
// rebuild — a real DRL rule engine (pattern matching over working memory, salience ordering,
// accumulate/collect/exists/forall) is a much larger undertaking than a decision table matcher, and
// its own source was lost along with the rest of this project; it's real, deferred future work, not
// something to half-implement. A ruleflowGroup reference fails loudly with a clear RULE_ERROR rather
// than silently doing nothing.
import type { EngineDecision, EngineDecisionModel, InputTest, OutputResult } from '../sdk/index.ts';

export type FindDecisionModel = (namespace: string | undefined, model: string) => EngineDecisionModel | undefined;

function testInput(test: InputTest, value: unknown): boolean {
  if (test && typeof test === 'object' && !Array.isArray(test)) {
    if ('gt' in test) return Number(value) > Number(test.gt);
    if ('gte' in test) return Number(value) >= Number(test.gte);
    if ('lt' in test) return Number(value) < Number(test.lt);
    if ('lte' in test) return Number(value) <= Number(test.lte);
    if ('between' in test) { const [lo, hi] = test.between; return Number(value) >= Number(lo) && Number(value) <= Number(hi); }
    if ('in' in test) return test.in.includes(value as never);
    if ('not' in test) return !testInput(test.not as InputTest, value);
    if ('any' in test) return true;
    if ('feel' in test) return false; // FEEL expression evaluation not re-implemented in this build
    return false;
  }
  if (Array.isArray(test)) return test.includes(value as never);
  return value === test;
}
function resolveOutput(result: OutputResult): unknown {
  if (result && typeof result === 'object' && 'feel' in result) return undefined; // not re-implemented
  return result;
}

function evaluateDecision(decision: EngineDecision, vars: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const rule of decision.rules) {
    const matches = decision.inputs.every((inp) => {
      const test = rule.when[inp.name];
      return test === undefined || testInput(test, vars[inp.name]);
    });
    if (!matches) continue;
    for (const outField of decision.outputs) {
      const result = rule.then[outField.name];
      if (result !== undefined) out[outField.name] = resolveOutput(result);
    }
    if (decision.hitPolicy !== 'COLLECT') break; // UNIQUE/FIRST/PRIORITY/ANY: first match wins
  }
  return out;
}

export function evaluateDmn(findModel: FindDecisionModel, dmn: { namespace?: string; model: string; decision?: string }, vars: Record<string, unknown>): Record<string, unknown> {
  const model = findModel(dmn.namespace, dmn.model);
  if (!model) throw new Error(`DMN model "${dmn.model}" not found`);
  const decision = dmn.decision ? model.decisions.find((d) => d.name === dmn.decision) : model.decisions[0];
  if (!decision) throw new Error(`DMN decision "${dmn.decision || '(first)'}" not found in model "${dmn.model}"`);
  return evaluateDecision(decision, vars);
}

export function evaluateRules(ruleflowGroup: string, _vars: Record<string, unknown>): Record<string, unknown> {
  const e: Error & { code?: string } = new Error(`DRL ruleflow-group evaluation ("${ruleflowGroup}") is not available in this build — see decisioning.ts's own doc comment`);
  e.code = 'RULE_ENGINE_UNAVAILABLE';
  throw e;
}
