import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseBpmn, serializeProcess, validateModel } from '../dist/index.mjs';
import { buildAllNodesProject } from '../examples/jbpm-project/03-all-nodes-project.mjs';

function findBpmn(dir) {
  const out = [];
  (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) w(f); else if (e.name.endsWith('.bpmn')) out.push(f); } })(dir);
  return out;
}

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-'));
const { written, project } = buildAllNodesProject(out);
const bpmnFiles = findBpmn(out);
const allXml = bpmnFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

test('multi-process project exported (6 processes) + kjar scaffolding', () => {
  assert.strictEqual(project.processes.length, 6);
  assert.strictEqual(bpmnFiles.length, 6, 'six .bpmn files');
  assert.ok(written.some((f) => f.endsWith('pom.xml')));
  assert.ok(written.some((f) => f.includes('kie-deployment-descriptor.xml')));
});

test('every process validates and round-trips', () => {
  for (const f of bpmnFiles) {
    const m = parseBpmn(fs.readFileSync(f, 'utf8'));
    const r = validateModel(m);
    assert.ok(r.ok, `validate ${m.id}: ${r.errors.join('; ')}`);
    const m2 = parseBpmn(serializeProcess(m));
    assert.deepStrictEqual(m2.nodes.map((n) => n.id).sort(), m.nodes.map((n) => n.id).sort(), `nodes ${m.id}`);
    assert.deepStrictEqual(m2.flows.map((x) => x.id).sort(), m.flows.map((x) => x.id).sort(), `flows ${m.id}`);
  }
});

test('all gateways present', () => {
  for (const el of ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway', 'complexGateway'])
    assert.ok(allXml.includes(`<bpmn2:${el}`), `missing ${el}`);
});

test('all task types present', () => {
  for (const el of ['scriptTask', 'userTask', 'businessRuleTask', 'sendTask', 'receiveTask', 'manualTask', 'callActivity'])
    assert.ok(allXml.includes(`<bpmn2:${el}`), `missing ${el}`);
});

test('sub-processes: embedded, transaction, event (triggeredByEvent) + multi-instance', () => {
  assert.ok(allXml.includes('<bpmn2:subProcess'), 'embedded/event subProcess');
  assert.ok(allXml.includes('<bpmn2:transaction'), 'transaction');
  assert.ok(allXml.includes('triggeredByEvent="true"'), 'event sub-process');
  assert.ok(allXml.includes('multiInstanceLoopCharacteristics'), 'multi-instance');
});

test('all event definitions present (message/escalation/conditional/timer/signal/error/terminate)', () => {
  for (const el of ['messageEventDefinition', 'escalationEventDefinition', 'conditionalEventDefinition',
    'timerEventDefinition', 'signalEventDefinition', 'errorEventDefinition', 'terminateEventDefinition'])
    assert.ok(allXml.includes(el), `missing ${el}`);
});

test('event positions: start/intermediate-catch/intermediate-throw/end/boundary', () => {
  assert.ok(allXml.includes('<bpmn2:startEvent'), 'start');
  assert.ok(allXml.includes('<bpmn2:intermediateCatchEvent'), 'intermediate catch');
  assert.ok(allXml.includes('<bpmn2:intermediateThrowEvent'), 'intermediate throw');
  assert.ok(allXml.includes('<bpmn2:endEvent'), 'end');
  assert.ok(allXml.includes('<bpmn2:boundaryEvent'), 'boundary');
  assert.ok(allXml.includes('cancelActivity="false"'), 'non-interrupting boundary');
});

test('all start-event trigger types across processes', () => {
  const starts = project.processes.flatMap((p) => p.nodes.filter((n) => n.type === 'startEvent').map((n) => n.eventType || n.subtype));
  for (const t of ['none', 'signal', 'message', 'timer', 'conditional'])
    assert.ok(starts.includes(t), `missing start trigger ${t}`);
});

test('data objects, data store, lanes present', () => {
  assert.ok(allXml.includes('<bpmn2:dataObject'), 'dataObject');
  assert.ok(allXml.includes('<bpmn2:dataStoreReference'), 'dataStoreReference');
  assert.ok(allXml.includes('<bpmn2:laneSet'), 'laneSet');
  assert.ok(allXml.includes('<bpmn2:flowNodeRef'), 'lane flowNodeRefs');
});

test('JavaScript dialect present (script + condition)', () => {
  assert.ok(allXml.includes('scriptFormat="http://www.javascript.com/javascript"'), 'JS script');
});

test.after(() => fs.rmSync(out, { recursive: true, force: true }));
