// functions/dmn-engine.mjs — reusable reference DMN decision-table evaluator (runtime).
// Executes the engine decision model (the SAME JSON the SDK compiles to DMN XML) against input
// values: match each rule's `when` tests, then apply the hit policy to the matching `then` results.
// Pure JS, no SDK dependency. Structured tests (literal/op/range/in/not/any) are executed; a raw
// { feel } test is treated as a wildcard (this reference engine ships no FEEL parser).

// does an input value satisfy one structured InputTest?
export function testMatch(value, test) {
  if (test === '-' || test == null) return true;
  if (Array.isArray(test)) return test.includes(value);
  if (typeof test !== 'object') return value === test;              // literal equals
  if ('any' in test || 'feel' in test) return true;                // wildcard / raw FEEL (not parsed)
  if ('gt' in test) return value > test.gt;
  if ('gte' in test) return value >= test.gte;
  if ('lt' in test) return value < test.lt;
  if ('lte' in test) return value <= test.lte;
  if ('between' in test) return value >= test.between[0] && value <= test.between[1];
  if ('in' in test) return test.in.includes(value);
  if ('not' in test) return Array.isArray(test.not) ? !test.not.includes(value) : value !== test.not;
  return false;
}

const ruleMatches = (decision, rule, inputs) =>
  decision.inputs.every((inp) => testMatch(inputs[inp.name], inp.name in rule.when ? rule.when[inp.name] : '-'));

function outputsOf(decision, rule) {
  const o = {};
  for (const out of decision.outputs) {
    const r = out.name in rule.then ? rule.then[out.name] : null;
    o[out.name] = (r && typeof r === 'object' && 'feel' in r) ? r.feel : r;   // {feel} returned verbatim
  }
  return o;
}
const AGG = { SUM: (v) => v.reduce((a, b) => a + b, 0), MIN: (v) => Math.min(...v), MAX: (v) => Math.max(...v), COUNT: (v) => v.length };

// evaluate one decision table against a plain inputs object. Returns:
//   single-hit policies (UNIQUE/FIRST/ANY/PRIORITY) -> one output object (or null if no match)
//   COLLECT with aggregation                        -> { <output>: aggregate }
//   COLLECT / RULE ORDER / OUTPUT ORDER             -> array of output objects
export function evaluateDecision(decision, inputs) {
  const matched = decision.rules.filter((r) => ruleMatches(decision, r, inputs));
  const hp = decision.hitPolicy || 'UNIQUE';
  const list = ['COLLECT', 'RULE ORDER', 'OUTPUT ORDER'].includes(hp);
  if (!matched.length) return list ? [] : null;
  const outs = matched.map((r) => outputsOf(decision, r));
  if (!list) return outs[0];                                        // UNIQUE/FIRST/ANY/PRIORITY -> first
  if (hp === 'COLLECT' && decision.aggregation) {
    const name = decision.outputs[0].name;
    return { [name]: AGG[decision.aggregation](outs.map((o) => o[name])) };
  }
  return outs;
}

// evaluate every decision in a model; returns { <decisionName>: result }.
export function evaluateModel(model, inputs) {
  const out = {};
  for (const d of model.decisions) out[d.name] = evaluateDecision(d, inputs);
  return out;
}
