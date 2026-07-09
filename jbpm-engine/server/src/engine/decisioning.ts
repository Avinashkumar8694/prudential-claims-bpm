// Decisioning: evaluate DMN decision tables and (basic) DRL rulesets from the project engine against
// the instance variables. Node-native; the SDK exports the same models to real DMN/DRL for jBPM.
import type { EngineProject } from '../sdk/index.js';

type Vars = Record<string, unknown>;

// ---- DMN decision tables ----
function testMatch(value: unknown, test: any): boolean {
  if (test == null) return true;
  if (typeof test === 'object' && !Array.isArray(test)) {
    if (test.any === true) return true;
    if ('feel' in test) return true;                       // raw FEEL not evaluated here → treat as match
    if ('gt' in test) return Number(value) > Number(test.gt);
    if ('gte' in test) return Number(value) >= Number(test.gte);
    if ('lt' in test) return Number(value) < Number(test.lt);
    if ('lte' in test) return Number(value) <= Number(test.lte);
    if ('between' in test) return Number(value) >= Number(test.between[0]) && Number(value) <= Number(test.between[1]);
    if ('in' in test) return (test.in as unknown[]).includes(value);
    if ('not' in test) return Array.isArray(test.not) ? !test.not.includes(value) : value !== test.not;
    return true;
  }
  if (Array.isArray(test)) return test.includes(value);    // in-list
  if (test === '-' ) return true;                          // FEEL any
  return value === test;                                   // literal equals
}
function resolveOutput(r: any): unknown { return r && typeof r === 'object' && 'feel' in r ? r.feel : r; }

/** Evaluate a DMN decision; returns the output variable changes. */
export function evaluateDmn(engine: EngineProject, ref: { namespace?: string; model: string; decision: string }, vars: Vars): Vars {
  const model = (engine.decisions || []).find((m: any) => m.name === ref.model || m.namespace === ref.namespace);
  if (!model) throw new Error(`DMN model "${ref.model}" not found`);
  const decision = (model as any).decisions.find((d: any) => d.name === ref.decision);
  if (!decision) throw new Error(`DMN decision "${ref.decision}" not found`);

  const matches = decision.rules.filter((rule: any) =>
    decision.inputs.every((inp: any) => testMatch(vars[inp.name], rule.when[inp.name])));
  const chosen = (decision.hitPolicy === 'COLLECT') ? matches : matches.slice(0, 1);   // FIRST/UNIQUE/ANY → first
  const out: Vars = {};
  for (const inp of decision.outputs) {
    const vals = chosen.map((r: any) => resolveOutput(r.then[inp.name])).filter((v: unknown) => v !== undefined);
    if (vals.length) out[inp.name] = decision.hitPolicy === 'COLLECT' ? vals : vals[0];
  }
  return out;
}

// ---- DRL rulesets (basic: conditions/actions over a fact object held in a variable) ----
function whereMatch(fact: any, where: Record<string, any> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([field, spec]) => {
    const v = fact?.[field];
    if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
      if ('ref' in spec) return true;                       // binding ref — not resolved in the basic evaluator
      const [[op, val]] = Object.entries(spec);
      switch (op) {
        case 'gt': return Number(v) > Number(val); case 'gte': return Number(v) >= Number(val);
        case 'lt': return Number(v) < Number(val); case 'lte': return Number(v) <= Number(val);
        case 'ne': return v !== val; case 'in': return (val as unknown[]).includes(v);
        case 'notIn': return !(val as unknown[]).includes(v); case 'contains': return String(v).includes(String(val));
        default: return v === val;
      }
    }
    if (Array.isArray(spec)) return spec.includes(v);
    return v === spec;
  });
}

/** Evaluate all rules in the ruleflow-group; mutates a fact object per matched rule. Returns changed vars.
 *  Basic model: a fact of type F is the variable named F (an object) or, if absent, the whole vars map. */
export function evaluateRules(engine: EngineProject, group: string, vars: Vars): Vars {
  const rulesets = (engine.rulesets || []).filter((r: any) => r.group === group);
  const changed: Vars = {};
  const factOf = (type: string): any => (vars[type] && typeof vars[type] === 'object' ? vars[type] : vars);
  const rules = rulesets.flatMap((rs: any) => rs.rules).sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0));
  for (const rule of rules) {
    const ok = (rule.when || []).every((w: any) => {
      const fact = factOf(w.fact);
      const present = whereMatch(fact, w.where);
      return w.exists === false || w.not ? !present : present;
    });
    if (!ok) continue;
    for (const act of rule.then || []) {
      if ('set' in act) { const fact = factOf(act.set); Object.assign(fact, act.fields); if (fact === vars) Object.assign(changed, act.fields); else changed[act.set] = fact; }
      else if ('insert' in act) { vars[act.insert] = { ...(act.fields || {}) }; changed[act.insert] = vars[act.insert]; }
    }
  }
  return changed;
}
