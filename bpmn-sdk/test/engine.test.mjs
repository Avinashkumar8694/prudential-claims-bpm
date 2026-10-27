import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fromEngine, fromEngineProject, toEngine, makeTypeResolver, parseBpmn, serializeProcess, validateModel } from '../dist/index.mjs';
import { buildEngineProject } from '../examples/engine-model/07-engine-to-jbpm.mjs';

test('type resolver: name -> FQN, primitives -> structureRef, FQN passthrough', () => {
  const r = makeTypeResolver([{ name: 'Claim', package: 'com.acme.model' }]);
  assert.strictEqual(r('Claim'), 'com.acme.model.Claim');
  assert.strictEqual(r('string'), 'String');
  assert.strictEqual(r('list'), 'java.util.List');
  assert.strictEqual(r('com.foo.Bar'), 'com.foo.Bar');
});

test('fromEngineProject resolves the className question: var FQN + generated .java + form className', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'eng-'));
  const { project, written } = buildEngineProject(out);
  const claim = project.processes[0].variables.find((v) => v.name === 'claim');
  assert.strictEqual(claim.type, 'com.acme.model.Claim', 'type NAME resolved to FQN for structureRef');
  const java = 'src/main/java/com/acme/model/Claim.java';
  assert.ok(project.descriptor.files[java], 'POJO auto-generated from the type schema');
  assert.ok(project.descriptor.files[java].includes('public double getAmount()'), 'POJO has accessors');
  const frm = project.descriptor.files['src/main/resources/forms/review.frm'];
  assert.ok(frm.includes('com.acme.model.Claim'), 'form className resolved from the type name');
  fs.rmSync(out, { recursive: true, force: true });
});

test('engine nodes convert to the right jBPM nodes; JS dialect + http wiring preserved', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'eng2-'));
  const { project } = buildEngineProject(out);
  const m = project.processes[0];
  const t = Object.fromEntries(m.nodes.map((n) => [n.id, n]));
  assert.strictEqual(t.status.type, 'callActivity'); assert.strictEqual(t.status.subtype, 'rest');
  assert.strictEqual(t.status.url, '/v1/claims/status');
  assert.ok(t.status.onEntry.includes('json.put("status"') || t.status.onEntry.includes('putPOJO("status"'), 'http body -> reqPayload');
  assert.ok(t.status.onExit.includes('kcontext.setVariable("tier"'), 'http resultTo -> setVariable');
  assert.strictEqual(t.derive.scriptFormat, 'http://www.javascript.com/javascript', 'JS dialect');
  assert.strictEqual(t.items.subtype, 'multiInstance');
  assert.strictEqual(t.rules.type, 'businessRuleTask');
  assert.strictEqual(t.xg.type, 'exclusiveGateway');
  assert.strictEqual(t.e2.subtype, 'terminate');
  // JS condition on the flow
  const high = m.flows.find((f) => f.id === 'high');
  assert.strictEqual(high.conditionLanguage, 'http://www.javascript.com/javascript');
  // baseUrl/reqPayload/resPayload auto-added because of the http node
  const vnames = m.variables.map((v) => v.name);
  for (const v of ['baseUrl', 'reqPayload', 'resPayload']) assert.ok(vnames.includes(v), `${v} ensured`);
  fs.rmSync(out, { recursive: true, force: true });
});

test('converted process validates, serializes to well-formed BPMN, and round-trips', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'eng3-'));
  const { project } = buildEngineProject(out);
  const m = project.processes[0];
  assert.ok(validateModel(m).ok, 'valid: ' + validateModel(m).errors.join('; '));
  const xml = serializeProcess(m);
  const tmp = path.join(out, 'p.bpmn'); fs.writeFileSync(tmp, xml);
  execSync(`xmllint --noout "${tmp}"`, { stdio: 'pipe' });
  const m2 = parseBpmn(xml);
  assert.deepStrictEqual(m2.nodes.map((n) => n.id).sort(), m.nodes.map((n) => n.id).sort());
  fs.rmSync(out, { recursive: true, force: true });
});

test('toEngine (reverse) maps jBPM nodes back to engine node types', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'eng4-'));
  const { project } = buildEngineProject(out);
  const back = toEngine(project.processes[0]);
  const types = Object.fromEntries(back.nodes.map((n) => [n.id, n.type]));
  assert.strictEqual(types.derive, 'script');
  assert.strictEqual(types.status, 'http');
  assert.strictEqual(types.rules, 'rule');
  assert.strictEqual(types.xg, 'gateway');
  assert.strictEqual(types.review, 'userTask');
  assert.strictEqual(types.items, 'forEach');
  assert.strictEqual(back.vars.find((v) => v.name === 'claim').type, 'com.acme.model.Claim');
  fs.rmSync(out, { recursive: true, force: true });
});
