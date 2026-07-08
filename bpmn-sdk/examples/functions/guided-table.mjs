// functions/guided-table.mjs — reusable runtime for an engine GUIDED decision table (a tabular
// ruleset over one fact). Condition columns read the fact's fields; action columns set them. Each row
// is a rule: if every condition holds (an empty cell = no constraint) the row's `then` sets apply.
// Rows fire in order (later rows override earlier for the same action field). Pure JS, no SDK dep.

const OPS = { eq: (a, b) => a === b, ne: (a, b) => a !== b, gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b };

const rowMatches = (table, row, input) =>
  table.conditions.every((c) => {
    const v = (row.when || {})[c.field];
    return v == null || (OPS[c.op] && OPS[c.op](input[c.field], v));   // empty cell = no constraint
  });

// apply the table to a fact object. Returns { fact: <updated copy>, fired: [rowNumbers] }.
export function evaluateGuidedTable(table, fact) {
  const input = { ...fact };            // conditions read the input snapshot
  const out = { ...fact };              // actions accumulate here
  const fired = [];
  table.rows.forEach((row, i) => {
    if (!rowMatches(table, row, input)) return;
    fired.push(i + 1);
    for (const a of table.actions) { const v = (row.then || {})[a.field]; if (v !== undefined) out[a.field] = v; }
  });
  return { fact: out, fired };
}
