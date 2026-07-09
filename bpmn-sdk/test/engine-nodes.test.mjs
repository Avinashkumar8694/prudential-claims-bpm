// Every engine node type/subtype, authored as nodejs-supported JSON, converts to the right jBPM node,
// produces valid BPMN, and round-trips (fromEngine -> serialize -> parse -> validate; toEngine recovers).
import { test } from 'node:test';
import assert from 'node:assert';
import { fromEngine, toEngine, serializeProcess, parseBpmn, validateModel } from '../dist/index.mjs';

// convert an engine process, validate the BPMN, and round-trip it back to the engine model
function rt(nodes, flows, vars = []) {
  const ep = { id: 'com.acme.p', name: 'p', package: 'com.acme', vars, nodes, flows };
  const model = fromEngine(ep);
  assert.ok(validateModel(model).ok, 'model validates:\n' + JSON.stringify(validateModel(model).errors));
  const reparsed = parseBpmn(serializeProcess(model));           // BPMN is well-formed + re-parseable
  assert.deepStrictEqual(reparsed.nodes.map((n) => n.id).sort(), model.nodes.map((n) => n.id).sort(), 'nodes survive BPMN round-trip');
  const back = toEngine(model);                                  // jBPM -> engine again
  return { model, back };
}
const jType = (m, id) => m.nodes.find((n) => n.id === id)?.type;
const jSub = (m, id) => m.nodes.find((n) => n.id === id)?.subtype;
const engType = (b, id) => b.nodes.find((n) => n.id === id)?.type;
const S = { id: 's', type: 'start' }, E = { id: 'e', type: 'end' };
// start -> node -> end
const linear = (node) => rt([S, node, E], [{ from: 's', to: node.id }, { from: node.id, to: 'e' }]);

test('task nodes — script/http/call/forEach/userTask/rule/send/receive/manual', () => {
  const cases = [
    [{ id: 'n', type: 'script', lang: 'js', code: 'kcontext.setVariable("x",1);' }, 'scriptTask', 'script'],
    [{ id: 'n', type: 'http', method: 'POST', url: '/v1/claims', body: { id: 'x' }, resultTo: { ok: '$.ok' } }, 'callActivity', 'http'],
    [{ id: 'n', type: 'call', process: 'child', inputs: { a: 'x' }, outputs: { r: 'y' } }, 'callActivity', 'call'],
    [{ id: 'n', type: 'forEach', process: 'child', over: 'items', as: 'item', collectInto: 'results' }, 'callActivity', 'forEach'],
    [{ id: 'n', type: 'userTask', name: 'Review', group: 'Examiner', form: 'ClaimReview' }, 'userTask', 'userTask'],
    [{ id: 'n', type: 'rule', ruleflowGroup: 'classify' }, 'businessRuleTask', 'rule'],
    [{ id: 'n', type: 'rule', dmn: { namespace: 'ns', model: 'M', decision: 'D' } }, 'businessRuleTask', 'rule'],
    [{ id: 'n', type: 'send', message: 'Notify' }, 'sendTask', 'send'],
    [{ id: 'n', type: 'receive', message: 'Ack' }, 'receiveTask', 'receive'],
    [{ id: 'n', type: 'manual', name: 'Inspect' }, 'manualTask', 'manual'],
  ];
  for (const [node, jbpm, eng] of cases) {
    const { model, back } = linear(node);
    assert.strictEqual(jType(model, 'n'), jbpm, `${node.type} -> ${jbpm}`);
    assert.strictEqual(engType(back, 'n'), eng, `${node.type} round-trips`);
  }
  // http/call subtypes
  assert.strictEqual(jSub(linear({ id: 'n', type: 'http', method: 'GET', url: '/x' }).model, 'n'), 'rest');
  assert.strictEqual(jSub(linear({ id: 'n', type: 'call', process: 'c' }).model, 'n'), 'reusable');
  assert.strictEqual(jSub(linear({ id: 'n', type: 'forEach', process: 'c', over: 'xs' }).model, 'n'), 'multiInstance');
});

test('start events — none / signal / message / timer / conditional', () => {
  const starts = [
    [{ id: 's', type: 'start' }, 'none'],
    [{ id: 's', type: 'start', on: { signal: 'Go' } }, 'signal'],
    [{ id: 's', type: 'start', on: { message: 'In' } }, 'message'],
    [{ id: 's', type: 'start', on: { timer: { cycle: 'R/PT1H' } } }, 'timer'],
    [{ id: 's', type: 'start', on: { condition: 'amount > 0', lang: 'js' } }, 'conditional'],
  ];
  for (const [start, evt] of starts) {
    const { model, back } = rt([start, E], [{ from: 's', to: 'e' }]);
    assert.strictEqual(jType(model, 's'), 'startEvent');
    if (evt !== 'none') assert.strictEqual(model.nodes.find((n) => n.id === 's').eventType, evt, `start ${evt}`);
    assert.strictEqual(engType(back, 's'), 'start');
  }
});

test('end events — none / terminate / signal / error / escalation / message', () => {
  const ends = [
    [{ id: 'e', type: 'end' }, undefined],
    [{ id: 'e', type: 'end', result: 'terminate' }, 'terminate'],
    [{ id: 'e', type: 'end', throw: { signal: 'Done' } }, 'signal'],
    [{ id: 'e', type: 'end', throw: { error: 'ERR' } }, 'error'],
    [{ id: 'e', type: 'end', throw: { escalation: 'ESC' } }, 'escalation'],
    [{ id: 'e', type: 'end', throw: { message: 'Out' } }, 'message'],
  ];
  for (const [end, evt] of ends) {
    const { model, back } = rt([S, end], [{ from: 's', to: 'e' }]);
    assert.strictEqual(jType(model, 'e'), 'endEvent');
    if (evt) assert.ok(model.nodes.find((n) => n.id === 'e').eventType === evt || model.nodes.find((n) => n.id === 'e').subtype === evt, `end ${evt}`);
    assert.strictEqual(engType(back, 'e'), 'end');
  }
});

test('intermediate catch / throw events', () => {
  for (const event of [{ timer: { duration: 'PT1H' } }, { message: 'M' }, { signal: 'Sig' }, { condition: 'x > 1', lang: 'js' }]) {
    const { model, back } = linear({ id: 'n', type: 'catch', event });
    assert.strictEqual(jType(model, 'n'), 'intermediateCatchEvent');
    assert.strictEqual(engType(back, 'n'), 'catch');
  }
  for (const event of [{ signal: 'Sig' }, { message: 'M' }, { escalation: 'ESC' }]) {
    const { model, back } = linear({ id: 'n', type: 'throw', event });
    assert.strictEqual(jType(model, 'n'), 'intermediateThrowEvent');
    assert.strictEqual(engType(back, 'n'), 'throw');
  }
});

test('gateways — exclusive / parallel / inclusive / event / complex', () => {
  // exclusive with a default + a conditional branch
  {
    const { model, back } = rt(
      [S, { id: 'g', type: 'gateway', mode: 'exclusive', default: 'f2' }, { id: 'e1', type: 'end' }, { id: 'e2', type: 'end' }],
      [{ from: 's', to: 'g' }, { id: 'f1', from: 'g', to: 'e1', when: 'x == 1', lang: 'mvel' }, { id: 'f2', from: 'g', to: 'e2' }]);
    assert.strictEqual(jType(model, 'g'), 'exclusiveGateway');
    assert.strictEqual(engType(back, 'g'), 'gateway');
  }
  for (const [mode, jbpm] of [['parallel', 'parallelGateway'], ['inclusive', 'inclusiveGateway'], ['complex', 'complexGateway']]) {
    const { model } = rt(
      [S, { id: 'g', type: 'gateway', mode }, { id: 'e1', type: 'end' }, { id: 'e2', type: 'end' }],
      [{ from: 's', to: 'g' }, { from: 'g', to: 'e1' }, { from: 'g', to: 'e2' }]);
    assert.strictEqual(jType(model, 'g'), jbpm, `${mode} -> ${jbpm}`);
  }
  // event-based gateway -> catch events
  {
    const { model } = rt(
      [S, { id: 'g', type: 'gateway', mode: 'event' }, { id: 'c1', type: 'catch', event: { message: 'A' } }, { id: 'c2', type: 'catch', event: { timer: { duration: 'PT1H' } } }, { id: 'e', type: 'end' }],
      [{ from: 's', to: 'g' }, { from: 'g', to: 'c1' }, { from: 'g', to: 'c2' }, { from: 'c1', to: 'e' }, { from: 'c2', to: 'e' }]);
    assert.strictEqual(jType(model, 'g'), 'eventBasedGateway');
  }
});

test('boundary events — timer (non-interrupting) + error (interrupting) on a host task', () => {
  for (const [event, interrupting] of [[{ timer: { duration: 'PT1H' } }, false], [{ error: 'ERR' }, true]]) {
    const { model, back } = rt(
      [S, { id: 't', type: 'manual', name: 'T' }, { id: 'b', type: 'boundary', on: 't', event, interrupting }, E, { id: 'e2', type: 'end' }],
      [{ from: 's', to: 't' }, { from: 't', to: 'e' }, { from: 'b', to: 'e2' }]);
    assert.strictEqual(jType(model, 'b'), 'boundaryEvent');
    assert.strictEqual(model.nodes.find((n) => n.id === 'b').attachedTo, 't', 'boundary attached to host');
    assert.strictEqual(engType(back, 'b'), 'boundary');
  }
});

test('subprocess — embedded / transaction / event(error)', () => {
  const inner = { nodes: [{ id: 's2', type: 'start' }, { id: 'e2', type: 'end' }], flows: [{ from: 's2', to: 'e2' }] };
  for (const extra of [{}, { transaction: true }, { on: { error: 'ERR' } }]) {
    const { model, back } = rt([S, { id: 'sp', type: 'subprocess', ...inner, ...extra }, E], [{ from: 's', to: 'sp' }, { from: 'sp', to: 'e' }]);
    assert.strictEqual(jType(model, 'sp'), 'subProcess');
    assert.strictEqual(engType(back, 'sp'), 'subprocess');
  }
});

test('INTEGRATION — one process using many node types is valid BPMN and round-trips', () => {
  const { model, back } = rt([
    { id: 's', type: 'start', on: { message: 'ClaimReceived' } },
    { id: 'validate', type: 'http', method: 'POST', url: '/v1/claims/validate', body: { id: 'x' } },
    { id: 'classify', type: 'rule', ruleflowGroup: 'classify' },
    { id: 'gw', type: 'gateway', mode: 'exclusive', default: 'toStd' },
    { id: 'review', type: 'userTask', name: 'Manual review', group: 'Examiner', form: 'ClaimReview' },
    { id: 'calc', type: 'script', lang: 'js', code: 'kcontext.setVariable("done", true);' },
    { id: 'notify', type: 'send', message: 'Notify' },
    { id: 'timeout', type: 'boundary', on: 'review', event: { timer: { duration: 'P3D' } }, interrupting: true },
    { id: 'eHigh', type: 'end', throw: { signal: 'Escalated' } },
    { id: 'eDone', type: 'end', result: 'terminate' },
  ], [
    { from: 's', to: 'validate' }, { from: 'validate', to: 'classify' }, { from: 'classify', to: 'gw' },
    { id: 'toReview', from: 'gw', to: 'review', when: 'priority == "HIGH"', lang: 'mvel' },
    { id: 'toStd', from: 'gw', to: 'calc' },
    { from: 'review', to: 'notify' }, { from: 'notify', to: 'eHigh' },
    { from: 'calc', to: 'eDone' }, { from: 'timeout', to: 'eHigh' },
  ], [{ name: 'priority', type: 'string' }, { name: 'done', type: 'bool' }]);
  // all 10 nodes present + valid + recovered
  assert.strictEqual(model.nodes.length, 10);
  assert.strictEqual(back.nodes.length, 10, 'all nodes recovered by toEngine');
  assert.ok(model.nodes.some((n) => n.type === 'boundaryEvent') && model.nodes.some((n) => n.type === 'exclusiveGateway'));
});
