import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseBpmn, serializeProcess, validateModel } from '../dist/index.mjs';
import { buildBasicProject } from '../examples/01-basic-jbpm-project.mjs';
import { buildComplexProject } from '../examples/02-complex-js-project.mjs';

function tmp(p) { return fs.mkdtempSync(path.join(os.tmpdir(), p)); }
function findBpmn(dir) {
  const out = [];
  (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) w(f); else if (e.name.endsWith('.bpmn')) out.push(f); } })(dir);
  return out;
}

test('example 1: exports a complete jBPM project (bpmn + kjar scaffolding)', () => {
  const out = tmp('ex1-');
  const { written } = buildBasicProject(out);
  assert.ok(written.some((f) => f.endsWith('.bpmn')), 'bpmn written');
  assert.ok(fs.existsSync(path.join(out, 'pom.xml')), 'pom.xml');
  assert.ok(fs.existsSync(path.join(out, 'src/main/resources/META-INF/kie-deployment-descriptor.xml')), 'deployment descriptor');
  // every bpmn re-parses and validates
  for (const f of findBpmn(out)) {
    const m = parseBpmn(fs.readFileSync(f, 'utf8'));
    assert.ok(validateModel(m).ok, `validate ${m.id}`);
    // round-trips
    const m2 = parseBpmn(serializeProcess(m));
    assert.deepStrictEqual(m2.nodes.map((n) => n.id).sort(), m.nodes.map((n) => n.id).sort());
  }
  fs.rmSync(out, { recursive: true, force: true });
});

test('example 2: complex project with JavaScript dialect, MI child, timer, signals', () => {
  const out = tmp('ex2-');
  const { written } = buildComplexProject(out);
  assert.strictEqual(findBpmn(out).length, 2, 'two processes (main + child) exported');
  assert.ok(written.some((f) => f.endsWith('.wid')), 'generated WorkDefinitions.wid');

  const mainPath = findBpmn(out).find((f) => f.includes('system-claim-process'));
  const xml = fs.readFileSync(mainPath, 'utf8');
  // JavaScript dialect preserved on the script task AND the condition
  assert.ok(xml.includes('scriptFormat="http://www.javascript.com/javascript"'), 'JS script dialect present');
  assert.ok(xml.includes('language="http://www.javascript.com/javascript"'), 'JS condition dialect present');
  // complex constructs present
  assert.ok(xml.includes('<bpmn2:parallelGateway'), 'parallel gateway');
  assert.ok(xml.includes('multiInstanceLoopCharacteristics'), 'multi-instance loop');
  assert.ok(xml.includes('timerEventDefinition') && xml.includes('P30D'), '30-day boundary timer');
  assert.ok(xml.includes('signalEventDefinition'), 'signal throw ends');
  assert.ok(xml.includes('triggeredByEvent="true"'), 'event sub-process');

  // round-trip preserves JS dialect and node set
  const m = parseBpmn(xml);
  const m2 = parseBpmn(serializeProcess(m));
  const js = m2.nodes.find((n) => n.id === '_jsflag');
  assert.strictEqual(js.scriptFormat, 'http://www.javascript.com/javascript', 'JS dialect survives round-trip');
  const fStp = m2.flows.find((f) => f.id === 'fStp');
  assert.strictEqual(fStp.conditionLanguage, 'http://www.javascript.com/javascript', 'JS condition survives round-trip');
  assert.ok(validateModel(m2).ok, 'complex model validates');
  fs.rmSync(out, { recursive: true, force: true });
});
