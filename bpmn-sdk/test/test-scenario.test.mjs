// Test scenario — engine suite -> .scesim (GIVEN/EXPECT columns + scenario rows, round-trip, well-
// formed) + the case runner that actually EXECUTES cases against an evaluator (real pass/fail in Node).
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testSuiteToScesim, buildAsset, parseAsset, fromEngineProject } from '../dist/index.mjs';
import { runScenarios, assertScenarios } from '../examples/functions/test-scenario.mjs';
import { evaluateDecision } from '../examples/functions/dmn-engine.mjs';
import { SUITE, DECISION } from '../examples/tests/21-test-scenario.mjs';

test('testSuiteToScesim — GIVEN/EXPECT columns + one scenario row per case', () => {
  const x = buildAsset({ kind: 'testScenario', model: testSuiteToScesim(SUITE) });
  assert.ok(x.includes('<ScenarioSimulationModel version="1.8">'));
  assert.ok(x.includes('<type>GIVEN</type><factName>amount</factName>'), 'GIVEN column for input');
  assert.ok(x.includes('<type>EXPECT</type><factName>tier</factName>'), 'EXPECT column for output');
  assert.ok(x.includes('<name>high value</name>') && x.includes('<raw>250000</raw>') && x.includes('<raw>HIGH</raw>'), 'a scenario row with pinned values');
  assert.ok(x.includes('<target>Eligibility</target>'), 'target recorded');
  assert.strictEqual((x.match(/<Scenario>/g) || []).length, 3, 'one row per case');
});

test('testSuiteToScesim — round-trip stable + well-formed (xmllint)', () => {
  const x = buildAsset({ kind: 'testScenario', model: testSuiteToScesim(SUITE) });
  assert.strictEqual(buildAsset(parseAsset('t.scesim', x)), x, 'round-trip stable');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scesim-')); const p = path.join(tmp, 't.scesim'); fs.writeFileSync(p, x);
  execSync(`xmllint --noout "${p}"`, { stdio: 'pipe' });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('fromEngineProject — tests -> .scesim under src/test/resources', () => {
  const proj = fromEngineProject({
    decisions: [{ name: 'ClaimDecisions', decisions: [DECISION] }],
    tests: [SUITE],
    processes: [{ id: 'p', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }],
  });
  assert.ok(proj.descriptor.files['src/test/resources/Eligibility.scesim'], 'test-scope .scesim path');
});

// ---- runtime case runner (the real value — runs in Node) ----
test('runScenarios — cases execute against the decision (all pass)', () => {
  const results = runScenarios(SUITE.cases, (g) => evaluateDecision(DECISION, g));
  assert.deepStrictEqual(results.map((r) => r.pass), [true, true, true]);
});

test('runScenarios / assertScenarios — a wrong expectation fails loudly', () => {
  const bad = [{ name: 'wrong', given: { amount: 250000 }, expect: { tier: 'STANDARD' } }];  // actually HIGH
  const [r] = runScenarios(bad, (g) => evaluateDecision(DECISION, g));
  assert.strictEqual(r.pass, false);
  assert.deepStrictEqual(r.failures, [{ field: 'tier', expected: 'STANDARD', actual: 'HIGH' }]);
  assert.throws(() => assertScenarios(bad, (g) => evaluateDecision(DECISION, g)), /1\/1 scenario/);
});
