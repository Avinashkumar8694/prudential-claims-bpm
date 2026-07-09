// functions/test-scenario.mjs — RUN engine test cases in Node. Each case pins `given` inputs and
// asserts `expect` outputs; you supply an `evaluate(given) -> outputs` for the target (e.g.
// (g) => evaluateDecision(decision, g) for DMN, or a rule-engine wrapper for DRL). Pure JS, no SDK dep.

// run cases -> [{ name, pass, failures:[{ field, expected, actual }] }]. Only `expect` fields are checked.
export function runScenarios(cases, evaluate) {
  return cases.map((c, i) => {
    const actual = evaluate(c.given) || {};
    const failures = Object.entries(c.expect)
      .filter(([k, v]) => actual[k] !== v)
      .map(([k, v]) => ({ field: k, expected: v, actual: actual[k] }));
    return { name: c.name || `case ${i + 1}`, pass: failures.length === 0, failures };
  });
}

// run cases and throw if any fail (drop into a node:test). Returns the results when all pass.
export function assertScenarios(cases, evaluate) {
  const results = runScenarios(cases, evaluate);
  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    const detail = failed.map((r) => `  ${r.name}: ` + r.failures.map((f) => `${f.field} expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.actual)}`).join('; ')).join('\n');
    throw new Error(`${failed.length}/${results.length} scenario(s) failed:\n${detail}`);
  }
  return results;
}
