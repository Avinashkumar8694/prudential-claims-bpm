// functions/rule-engine.mjs — reusable reference rule engine (runtime).
// Executes the engine-ruleset JSON (fact/where/then) against plain objects: match -> resolve
// (priority) -> act, with property reactivity + no-loop. Pure JS, no SDK dependency.
// Used by examples/rules-runtime/08 and /09; import `run` in your own Node engine the same way.

// operators (same set as CondOp)
export const OPS = {
  eq: (a, b) => a === b, ne: (a, b) => a !== b, gt: (a, b) => a > b, gte: (a, b) => a >= b,
  lt: (a, b) => a < b, lte: (a, b) => a <= b,
  in: (a, b) => Array.isArray(b) && b.includes(a), notIn: (a, b) => !(Array.isArray(b) && b.includes(a)),
  contains: (a, b) => Array.isArray(a) ? a.includes(b) : String(a).includes(b),
  notContains: (a, b) => !(Array.isArray(a) ? a.includes(b) : String(a).includes(b)),
  matches: (a, b) => new RegExp(b).test(String(a)),
  memberOf: (a, b) => Array.isArray(b) && b.includes(a),
};
const isLiteral = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const resolveRef = (ref, binds) => { const [b, ...p] = ref.replace(/^\$/, '').split('.'); return p.reduce((o, k) => o?.[k], binds[b]); };

// does one field's value satisfy its `where` spec? (literal | array | {ref} | {op: value|ref})
function fieldOk(value, spec, binds) {
  if (isLiteral(spec)) return value === spec;
  if (Array.isArray(spec)) return spec.includes(value);
  if (spec && spec.ref) return value === resolveRef(spec.ref, binds);
  return Object.entries(spec).every(([op, raw]) => {
    const rhs = (raw && raw.ref) ? resolveRef(raw.ref, binds) : raw;
    return OPS[op] && OPS[op](value, rhs);
  });
}
const whereOk = (fact, where, binds) => Object.entries(where || {}).every(([f, spec]) => fieldOk(fact[f], spec, binds));

// find EVERY set of bindings that satisfies a rule's `when` (recursive join across patterns)
export function match(when, wm, i = 0, binds = {}) {
  if (i === when.length) return [{ ...binds }];
  const w = when[i];
  const candidates = wm.filter((f) => f._type === w.fact);
  if (w.exists === false || w.not) return candidates.some((f) => whereOk(f, w.where, binds)) ? [] : match(when, wm, i + 1, binds);
  if (w.exists === true) return candidates.some((f) => whereOk(f, w.where, binds)) ? match(when, wm, i + 1, binds) : [];
  const out = [];
  for (const f of candidates) if (whereOk(f, w.where, binds)) out.push(...match(when, wm, i + 1, w.as ? { ...binds, [w.as]: f } : binds));
  return out;
}
const invoke = (helpers, name, args = []) => name.split('.').reduce((o, k) => o?.[k], helpers)?.(...args);

// fields each rule READS (where keys + ref target fields) — drives property-reactive re-evaluation
function readFields(rule) {
  const s = new Set();
  for (const w of rule.when) for (const [f, spec] of Object.entries(w.where || {})) {
    s.add(f);
    const refs = [];
    if (spec && spec.ref) refs.push(spec.ref);
    else if (spec && typeof spec === 'object' && !Array.isArray(spec)) for (const v of Object.values(spec)) if (v && v.ref) refs.push(v.ref);
    for (const ref of refs) s.add(ref.split('.').pop());
  }
  return s;
}

// the engine loop: match -> resolve (priority) -> act -> repeat until nothing new fires (fixpoint)
export function run(ruleset, facts, helpers = {}) {
  const wm = facts.map((f, i) => ({ _id: f._id ?? `f${i}`, ...f }));
  let nextId = wm.length;
  const reads = new Map(ruleset.rules.map((r) => [r, readFields(r)]));
  const MAX_CYCLES = 10000;                            // safety backstop; a normal ruleset exits at fixpoint far sooner
  const fired = new Set();                             // activations already fired (rule|factIds)
  const trace = [];
  for (let cycle = 0; ; cycle++) {
    if (cycle >= MAX_CYCLES) throw new Error(`rule engine exceeded ${MAX_CYCLES} cycles — non-terminating ruleset?`);
    const agenda = [];
    for (const r of ruleset.rules) for (const binds of match(r.when, wm)) {
      const key = r.name + '|' + Object.values(binds).map((f) => f._id).join(',');
      if (!fired.has(key)) agenda.push({ r, binds, key });
    }
    if (!agenda.length) break;                         // fixpoint: the real exit — nothing new to fire
    agenda.sort((a, b) => (b.r.priority || 0) - (a.r.priority || 0));  // priority = conflict resolution
    const { r, binds } = agenda[0];
    fired.add(agenda[0].key);
    for (const a of r.then) {                          // apply consequences to DATA
      if ('set' in a) {
        const F = binds[a.set]; const changed = Object.keys(a.fields);
        Object.assign(F, a.fields);
        // property reactivity: re-enable rules that READ a changed field of F. no-loop: not the firing rule.
        for (const q of ruleset.rules) {
          if (!changed.some((c) => reads.get(q).has(c))) continue;
          if (q === r && r.noLoop) continue;
          for (const k of [...fired]) { const [qn, ids] = k.split('|'); if (qn === q.name && ids.split(',').includes(F._id)) fired.delete(k); }
        }
      } else if ('delete' in a) { const ix = wm.indexOf(binds[a.delete]); if (ix >= 0) wm.splice(ix, 1); }
      else if ('insert' in a) wm.push({ _id: `f${nextId++}`, _type: a.insert, ...(a.fields || {}) });
      else if ('call' in a) invoke(helpers, a.call, a.args);
    }
    trace.push(`fired: ${r.name}  on { ${Object.entries(binds).map(([k, f]) => `${k}=${f._id}`).join(', ')} }`);
  }
  return { facts: wm, trace };
}
