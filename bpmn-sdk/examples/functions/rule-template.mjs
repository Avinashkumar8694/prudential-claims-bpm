// functions/rule-template.mjs — expand an engine GUIDED RULE TEMPLATE into concrete rules by
// substituting each `rows` entry into the `{param}` placeholders of the when/then skeleton. The result
// is a ruleset the reference rule engine (functions/rule-engine.mjs) executes. Pure JS, no SDK dep.

// substitute {param} placeholders in a value (deep). A whole-value "{p}" preserves the row value's
// type; an embedded "{p}" is string-interpolated.
function subst(v, row) {
  if (typeof v === 'string') {
    const whole = /^\{(\w+)\}$/.exec(v);
    if (whole) return row[whole[1]];
    return v.replace(/\{(\w+)\}/g, (_, k) => String(row[k]));
  }
  if (Array.isArray(v)) return v.map((x) => subst(x, row));
  if (v && typeof v === 'object') { const o = {}; for (const [k, val] of Object.entries(v)) o[k] = subst(val, row); return o; }
  return v;
}

// expand a template into a ruleset: { rules: [ one rule per row ] }
export function expandTemplate(tmpl) {
  return {
    rules: tmpl.rows.map((row, i) => ({
      name: `${tmpl.name}_${i + 1}`,
      ...(tmpl.priority != null ? { priority: tmpl.priority } : {}),
      ...(tmpl.noLoop ? { noLoop: true } : {}),
      when: subst(tmpl.when, row),
      then: subst(tmpl.then, row),
    })),
  };
}
