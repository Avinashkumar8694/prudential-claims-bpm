// Round the other way: take the SDK's own EXPORTED project and parse it back to JSON.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseProject, validateModel } from '../dist/index.mjs';
import { buildAllAssetsProject } from '../examples/assets/05-all-assets-project.mjs';
import { buildComplexProject } from '../examples/jbpm-project/02-complex-js-project.mjs';

test('generated project -> JSON: parseProject reads back the exported kjar', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gen2json-'));
  buildAllAssetsProject(out);

  const project = parseProject(out);              // BPMN + kjar -> JSON model
  const json = JSON.stringify(project);           // must be plain JSON (no cycles)
  assert.ok(json.length > 500, 'serializable JSON');

  // the exported process comes back with its nodes/flows and validates
  const main = project.processes.find((p) => p.id === 'com.acme.assets.main');
  assert.ok(main, 'main process parsed from generated output');
  assert.ok(main.nodes.some((n) => n.type === 'scriptTask' && n.scriptFormat && n.scriptFormat.includes('javascript')), 'JS script node survived export->parse');
  assert.ok(main.nodes.some((n) => n.type === 'businessRuleTask' && n.ruleFlowGroup === 'classify'), 'business rule task parsed');
  assert.ok(validateModel(main).ok, 'parsed-from-generated model validates');

  // scaffolding + assets recaptured from the generated project
  assert.ok(project.descriptor.gav && project.descriptor.gav.artifactId === 'all-assets-bpm', 'gav');
  assert.ok((project.descriptor.deployment.workItemHandlers || []).some((h) => h.name === 'Rest'), 'deployment');
  assert.ok(project.descriptor.files['src/main/java/com/acme/model/Claim.java'], 'java asset recaptured');
  assert.ok(Object.keys(project.descriptor.files).some((f) => f.endsWith('.drl')), 'drl recaptured');
  fs.rmSync(out, { recursive: true, force: true });
});

test('generated complex project -> JSON: node ids/flows stable through export->parse', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gen2json2-'));
  const { project: built } = buildComplexProject(out);
  const parsed = parseProject(out);
  for (const src of built.processes) {
    const got = parsed.processes.find((p) => p.id === src.id);
    assert.ok(got, `process ${src.id} parsed back`);
    assert.deepStrictEqual(got.nodes.map((n) => n.id).sort(), src.nodes.map((n) => n.id).sort(), `nodes ${src.id}`);
    assert.deepStrictEqual(got.flows.map((f) => f.id).sort(), src.flows.map((f) => f.id).sort(), `flows ${src.id}`);
  }
  fs.rmSync(out, { recursive: true, force: true });
});
