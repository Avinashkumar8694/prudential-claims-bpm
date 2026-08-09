// Full real-world pipeline: a real BPMN businessRuleTask wired to DMN the way real jBPM/PAM actually
// does it (namespace/model passed as literal dataInputAssociation values, not static XML attributes)
// plus a real decisionTable-driven .dmn file, imported as a kjar file map -> deployed -> run, proving
// the DMN gap found against real downloaded examples (jbpm-examples2/dmn-jbpm-example) is now closed
// for the subset that's actually recoverable (decisionTable; literalExpression/BKM stay unsupported —
// see dmnToDecisionModel's own doc comment).
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.ts';
import { fakeClock } from '../src/infra/ids.ts';
import { makeContext } from '../src/context.ts';
import { WorkflowService } from '../src/modules/workflows/service.ts';
import { VersionService } from '../src/modules/versions/service.ts';
import { DeploymentService } from '../src/modules/deployments/service.ts';
import { InstanceService } from '../src/modules/instances/service.ts';
import { kjarToEngine, convertAssets } from '../src/modules/import/service.ts';

const newCtx = () => { let n = 0; return makeContext({ store: new MemoryStore(), tenantId: 't1', clock: fakeClock().clock, newId: () => `id${++n}` }); };

const BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.omg.org/bpmn20"
    xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:drools="http://www.jboss.org/drools"
    id="_defs" targetNamespace="http://www.jboss.org/drools">
  <bpmn2:process id="account.process" name="account" isExecutable="true">
    <bpmn2:startEvent id="s"><bpmn2:outgoing>f1</bpmn2:outgoing></bpmn2:startEvent>
    <bpmn2:businessRuleTask id="br" name="Decide" implementation="http://www.jboss.org/drools/dmn">
      <bpmn2:incoming>f1</bpmn2:incoming>
      <bpmn2:outgoing>f2</bpmn2:outgoing>
      <bpmn2:ioSpecification>
        <bpmn2:dataInput id="br_namespaceInputX" name="namespace"/>
        <bpmn2:dataInput id="br_modelInputX" name="model"/>
        <bpmn2:inputSet><bpmn2:dataInputRefs>br_namespaceInputX</bpmn2:dataInputRefs><bpmn2:dataInputRefs>br_modelInputX</bpmn2:dataInputRefs></bpmn2:inputSet>
      </bpmn2:ioSpecification>
      <bpmn2:dataInputAssociation>
        <bpmn2:targetRef>br_namespaceInputX</bpmn2:targetRef>
        <bpmn2:assignment><bpmn2:from><![CDATA[https://acme/dmn]]></bpmn2:from><bpmn2:to>br_namespaceInputX</bpmn2:to></bpmn2:assignment>
      </bpmn2:dataInputAssociation>
      <bpmn2:dataInputAssociation>
        <bpmn2:targetRef>br_modelInputX</bpmn2:targetRef>
        <bpmn2:assignment><bpmn2:from><![CDATA[Eligibility]]></bpmn2:from><bpmn2:to>br_modelInputX</bpmn2:to></bpmn2:assignment>
      </bpmn2:dataInputAssociation>
    </bpmn2:businessRuleTask>
    <bpmn2:endEvent id="e"><bpmn2:incoming>f2</bpmn2:incoming></bpmn2:endEvent>
    <bpmn2:sequenceFlow id="f1" sourceRef="s" targetRef="br"/>
    <bpmn2:sequenceFlow id="f2" sourceRef="br" targetRef="e"/>
  </bpmn2:process>
</bpmn2:definitions>`;

const DMN = `<?xml version="1.0"?>
<dmn:definitions xmlns:dmn="http://www.omg.org/spec/DMN/20180521/MODEL/" id="_d" name="Eligibility" namespace="https://acme/dmn">
  <dmn:decision id="_dec" name="Eligibility">
    <dmn:variable name="Eligibility"/>
    <dmn:decisionTable id="_dt" hitPolicy="UNIQUE">
      <dmn:input id="_in_amount" label="amount"><dmn:inputExpression typeRef="number"><dmn:text>amount</dmn:text></dmn:inputExpression></dmn:input>
      <dmn:output id="_out_approved" name="approved" typeRef="boolean"/>
      <dmn:rule id="_r0"><dmn:inputEntry><dmn:text>&gt; 1000</dmn:text></dmn:inputEntry><dmn:outputEntry><dmn:text>true</dmn:text></dmn:outputEntry></dmn:rule>
      <dmn:rule id="_r1"><dmn:inputEntry><dmn:text>-</dmn:text></dmn:inputEntry><dmn:outputEntry><dmn:text>false</dmn:text></dmn:outputEntry></dmn:rule>
    </dmn:decisionTable>
  </dmn:decision>
</dmn:definitions>`;

test('real businessRuleTask + real decisionTable DMN, imported as a kjar file map, evaluates correctly at runtime', async () => {
  const files = {
    'src/main/resources/account.bpmn': BPMN,
    'src/main/resources/Eligibility.dmn': DMN,
  };
  const engine = kjarToEngine(files);
  const report = convertAssets(engine);
  assert.deepStrictEqual(report.decisionsImported, ['Eligibility'], 'the decisionTable-driven DMN file converts');
  assert.deepStrictEqual(report.skipped, [], 'nothing unexpected skipped in this minimal kjar');

  const rule = engine.processes[0]!.nodes.find((n) => n.type === 'rule') as any;
  assert.deepStrictEqual(rule.dmn, { namespace: 'https://acme/dmn', model: 'Eligibility', decision: '' },
    'namespace/model recovered from the real dataInputAssociation convention; decision defaults empty (see decisioning.ts)');

  const ctx = newCtx();
  const wf = await new WorkflowService(ctx).create({ name: 'Account' }, 'a');
  const draft = await new VersionService(ctx).saveDraft(wf.defaultBranchId, engine, 'a');
  const pub = await new VersionService(ctx).publish(draft.id, 'a');
  await new DeploymentService(ctx).deploy(pub.published.id, { environment: 'prod', activate: true }, 'a');

  const instSvc = new InstanceService(ctx);
  const high = await instSvc.start({ workflowId: wf.id, environment: 'prod', variables: { amount: 5000 } }, 'bob');
  assert.strictEqual(high.status, 'completed');
  assert.strictEqual(high.variables.approved, true, 'amount > 1000 -> approved (real decision table rule 1)');

  const low = await instSvc.start({ workflowId: wf.id, environment: 'prod', variables: { amount: 100 } }, 'bob');
  assert.strictEqual(low.status, 'completed');
  assert.strictEqual(low.variables.approved, false, 'amount <= 1000 -> not approved (catch-all rule 2)');
});
