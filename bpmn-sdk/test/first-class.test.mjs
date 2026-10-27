import { test } from 'node:test';
import assert from 'node:assert';
import { serializeProcess, parseBpmn, validateModel } from '../dist/index.mjs';

const model = {
  id: 'p.fc', name: 'first-class', packageName: 'org.jbpm',
  declarations: {
    signals: [{ id: '_sig_go', name: 'Go' }],
    errors: [{ id: 'ERR', errorCode: 'ERR' }],
    messages: [{ id: 'MSG', name: 'Msg', itemRef: '_msgItem' }],
    escalations: [{ id: 'ESC', escalationCode: 'ESC1', name: 'Esc' }],
  },
  variables: [{ name: 'x', type: 'String' }, { name: 'items', type: 'java.util.List' }],
  dataObjects: [{ id: 'doc', name: 'Document', type: 'java.lang.Object', isCollection: false }],
  dataStores: [{ id: 'dsr', name: 'Archive', dataStoreRef: 'store1' }],
  lanes: [{ id: 'lane1', name: 'Ops', flowNodeRefs: ['_pg', '_br'] }],
  nodes: [
    { id: '_s', type: 'startEvent', eventType: 'message', messageRef: 'MSG', name: 'Start', position: { x: 60, y: 100, width: 40, height: 40 }, outgoing: ['f1'] },
    { id: '_pg', type: 'parallelGateway', name: 'Fork', gatewayDirection: 'Diverging', position: { x: 140, y: 100, width: 40, height: 40 }, incoming: ['f1'], outgoing: ['f2', 'f3'] },
    { id: '_br', type: 'businessRuleTask', name: 'Rules', ruleFlowGroup: 'grp', position: { x: 220, y: 60, width: 110, height: 60 }, incoming: ['f2'], outgoing: ['f4'] },
    { id: '_snd', type: 'sendTask', name: 'Send', messageRef: 'MSG', implementation: '##WebService', position: { x: 220, y: 160, width: 110, height: 60 }, incoming: ['f3'], outgoing: ['f5'] },
    { id: '_ig', type: 'inclusiveGateway', name: 'Join', gatewayDirection: 'Converging', position: { x: 360, y: 100, width: 40, height: 40 }, incoming: ['f4', 'f5'], outgoing: ['f6'] },
    { id: '_rcv', type: 'receiveTask', name: 'Receive', messageRef: 'MSG', position: { x: 420, y: 90, width: 110, height: 60 }, incoming: ['f6'], outgoing: ['f7'] },
    { id: '_man', type: 'manualTask', name: 'Manual', position: { x: 560, y: 90, width: 110, height: 60 }, incoming: ['f7'], outgoing: ['f8'] },
    { id: '_sub', type: 'subProcess', subtype: 'embedded', name: 'Embedded', position: { x: 700, y: 80, width: 260, height: 120, expanded: true }, incoming: ['f8'], outgoing: ['f9'],
      nodes: [
        { id: '_ss', type: 'startEvent', eventType: 'none', name: 'S', position: { x: 720, y: 110, width: 30, height: 30 }, outgoing: ['sf1'] },
        { id: '_sc', type: 'scriptTask', name: 'Do', script: 'kcontext.setVariable("x","1");', position: { x: 780, y: 100, width: 100, height: 50 }, incoming: ['sf1'], outgoing: ['sf2'] },
        { id: '_se', type: 'endEvent', eventType: 'none', name: 'E', position: { x: 910, y: 110, width: 30, height: 30 }, incoming: ['sf2'] },
      ],
      flows: [{ id: 'sf1', sourceRef: '_ss', targetRef: '_sc' }, { id: 'sf2', sourceRef: '_sc', targetRef: '_se' }] },
    { id: '_txn', type: 'subProcess', subtype: 'transaction', name: 'Txn', position: { x: 1000, y: 90, width: 120, height: 60 }, incoming: ['f9'], outgoing: ['f10'], nodes: [], flows: [] },
    { id: '_eg', type: 'eventBasedGateway', name: 'Wait', gatewayDirection: 'Diverging', eventGatewayType: 'Exclusive', position: { x: 1160, y: 100, width: 40, height: 40 }, incoming: ['f10'], outgoing: ['f11', 'f12'] },
    { id: '_ct', type: 'intermediateCatchEvent', eventType: 'timer', timeDuration: 'PT5M', name: 'Timer', position: { x: 1220, y: 60, width: 40, height: 40 }, incoming: ['f11'], outgoing: ['f13'] },
    { id: '_cc', type: 'intermediateCatchEvent', eventType: 'conditional', conditionExpr: 'return x != null;', name: 'Cond', position: { x: 1220, y: 150, width: 40, height: 40 }, incoming: ['f12'], outgoing: ['f14'] },
    { id: '_ig2', type: 'exclusiveGateway', gatewayDirection: 'Converging', position: { x: 1300, y: 100, width: 40, height: 40 }, incoming: ['f13', 'f14'], outgoing: ['f15'] },
    { id: '_thr', type: 'intermediateThrowEvent', eventType: 'signal', signalName: 'Go', name: 'Throw Go', position: { x: 1360, y: 90, width: 40, height: 40 }, incoming: ['f15'], outgoing: ['f16'] },
    { id: '_e', type: 'endEvent', eventType: 'escalation', escalationRef: 'ESC', name: 'End', position: { x: 1440, y: 100, width: 40, height: 40 }, incoming: ['f16'] },
  ],
  flows: [
    { id: 'f1', sourceRef: '_s', targetRef: '_pg' }, { id: 'f2', sourceRef: '_pg', targetRef: '_br' },
    { id: 'f3', sourceRef: '_pg', targetRef: '_snd' }, { id: 'f4', sourceRef: '_br', targetRef: '_ig' },
    { id: 'f5', sourceRef: '_snd', targetRef: '_ig' }, { id: 'f6', sourceRef: '_ig', targetRef: '_rcv' },
    { id: 'f7', sourceRef: '_rcv', targetRef: '_man' }, { id: 'f8', sourceRef: '_man', targetRef: '_sub' },
    { id: 'f9', sourceRef: '_sub', targetRef: '_txn' }, { id: 'f10', sourceRef: '_txn', targetRef: '_eg' },
    { id: 'f11', sourceRef: '_eg', targetRef: '_ct' }, { id: 'f12', sourceRef: '_eg', targetRef: '_cc' },
    { id: 'f13', sourceRef: '_ct', targetRef: '_ig2' }, { id: 'f14', sourceRef: '_cc', targetRef: '_ig2' },
    { id: 'f15', sourceRef: '_ig2', targetRef: '_thr' }, { id: 'f16', sourceRef: '_thr', targetRef: '_e' },
  ],
};

test('authors all first-class node types without validation errors', () => {
  const r = validateModel(model);
  assert.ok(r.ok, 'errors: ' + r.errors.join('; '));
});

test('every authored node round-trips as first-class (not raw)', () => {
  const m2 = parseBpmn(serializeProcess(model));
  const byId = Object.fromEntries(m2.nodes.map((n) => [n.id, n]));
  for (const orig of model.nodes) {
    const got = byId[orig.id];
    assert.ok(got, `missing node ${orig.id}`);
    assert.strictEqual(got.type, orig.type, `type of ${orig.id}`);
    assert.notStrictEqual(got.type, 'raw', `${orig.id} fell back to raw`);
  }
  // key attributes preserved
  assert.strictEqual(byId['_br'].ruleFlowGroup, 'grp');
  assert.strictEqual(byId['_snd'].messageRef, 'MSG');
  assert.strictEqual(byId['_eg'].eventGatewayType, 'Exclusive');
  assert.strictEqual(byId['_ct'].timeDuration, 'PT5M');
  assert.strictEqual(byId['_thr'].eventType, 'signal');
  assert.strictEqual(byId['_e'].eventType, 'escalation');
  // nested subprocess children survive
  assert.strictEqual(byId['_sub'].nodes.length, 3, 'embedded children');
  assert.strictEqual(byId['_sub'].flows.length, 2, 'embedded flows');
  // process-level extras
  assert.strictEqual(m2.dataObjects.length, 1);
  assert.strictEqual(m2.lanes.length, 1);
  assert.deepStrictEqual(m2.lanes[0].flowNodeRefs, ['_pg', '_br']);
  assert.strictEqual((m2.declarations.messages || []).length, 1);
  assert.strictEqual((m2.declarations.escalations || []).length, 1);
});
