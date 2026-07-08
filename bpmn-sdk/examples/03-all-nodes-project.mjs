// Example 3 — MULTI-PROCESS project exercising EVERY node type & gateway the SDK models first-class.
//
// Coverage: all gateways (exclusive/parallel/inclusive/event-based/complex); all tasks
// (script[Java+JS]/user/businessRule/send/receive/manual); callActivity (reusable/rest/multiInstance);
// embedded + transaction + event sub-processes; every start (none/signal/message/timer/conditional);
// every end (none/terminate/signal/error/message/escalation); intermediate catch (timer/message/
// signal/conditional) and throw (signal/message/escalation); boundary events (error/timer/message/
// signal/conditional/escalation, interrupting + non-interrupting); data objects; data stores; lanes;
// and signal/error/message/escalation declarations.
//
// `autowire` derives each node's incoming/outgoing from the flow list (recursing sub-processes),
// so we only declare flows — no hand-maintained incoming/outgoing arrays.
import { writeProject, validateModel, autowire } from '../dist/index.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const JS = 'http://www.javascript.com/javascript';
// give every node (and nested node) a non-overlapping position for a readable diagram
function layout(proc) {
  let i = 0;
  const place = (nodes, row) => {
    for (const n of nodes) {
      n.position = n.position || { x: 60 + (i++ % 12) * 150, y: row + Math.floor(i / 12) * 140, width: 110, height: 60 };
      if (n.type.endsWith('Gateway') || n.type.endsWith('Event')) { n.position.width = 40; n.position.height = 40; }
      if (n.nodes) { n.position.expanded = true; n.position.width = 300; n.position.height = 120; place(n.nodes, row + 400); }
    }
  };
  place(proc.nodes, 120);
  return proc;
}
const build = (p) => layout(autowire(p));

// ---------- P2: reusable child (called by P1 reusable + multi-instance) ----------
const child = build({
  id: 'com.acme.cov.child', name: 'cov-child', packageName: 'org.jbpm',
  declarations: { signals: [], errors: [] },
  variables: [{ name: 'caseId', type: 'String' }, { name: 'currentItem', type: 'String' }, { name: 'itemResult', type: 'java.lang.Object' }],
  nodes: [
    { id: 'c_s', type: 'startEvent', subtype: 'none', name: 'Start' },
    { id: 'c_t', type: 'manualTask', name: 'Handle item' },
    { id: 'c_e', type: 'endEvent', subtype: 'none', name: 'End' },
  ],
  flows: [{ id: 'cf1', sourceRef: 'c_s', targetRef: 'c_t' }, { id: 'cf2', sourceRef: 'c_t', targetRef: 'c_e' }],
});

// ---------- P1: the big coverage process (none start) ----------
const main = build({
  id: 'com.acme.cov.main', name: 'cov-main', packageName: 'org.jbpm',
  declarations: {
    signals: [{ id: '_sig_go', name: 'Go' }],
    errors: [{ id: 'TERMINATE_CASE', errorCode: 'TERMINATE_CASE' }, { id: 'CALL_ERR', errorCode: 'CALL_ERR' }],
    messages: [{ id: 'MSG', name: 'Msg', itemRef: '_msgItem' }],
    escalations: [{ id: 'ESC', escalationCode: 'ESC1', name: 'Esc' }],
  },
  variables: [
    { name: 'caseId', type: 'String' }, { name: 'claimId', type: 'String' },
    { name: 'items', type: 'java.util.List' }, { name: 'currentItem', type: 'String' },
    { name: 'itemResult', type: 'java.lang.Object' }, { name: 'itemResults', type: 'java.util.List' },
    { name: 'flag', type: 'java.lang.Boolean' }, { name: 'baseUrl', type: 'String' },
    { name: 'reqPayload', type: 'String' }, { name: 'resPayload', type: 'String' },
  ],
  dataObjects: [{ id: 'doc', name: 'Document', type: 'java.lang.Object' }, { id: 'list', name: 'Items', type: 'java.util.List', isCollection: true }],
  dataStores: [{ id: 'archiveRef', name: 'Archive', dataStoreRef: 'archive' }],
  lanes: [{ id: 'laneSys', name: 'System', flowNodeRefs: ['_boot', '_br', '_validate'] }, { id: 'laneOps', name: 'Ops', flowNodeRefs: ['_man', '_user'] }],
  nodes: [
    { id: '_s', type: 'startEvent', subtype: 'none', name: 'Start' },
    { id: '_boot', type: 'scriptTask', name: 'Bootstrap (Java)',
      script: 'String u=System.getProperty("INTEGRATION_LAYER_URL"); if(u==null||u.isEmpty()) u="http://localhost:3000"; kcontext.setVariable("baseUrl", u);' },
    { id: '_br', type: 'businessRuleTask', name: 'Rules', ruleFlowGroup: 'coverage', implementation: '##unspecified' },
    { id: '_pf', type: 'parallelGateway', name: 'Fork', gatewayDirection: 'Diverging' },
    { id: '_snd', type: 'sendTask', name: 'Send', messageRef: 'MSG', implementation: '##WebService' },
    { id: '_rcv', type: 'receiveTask', name: 'Receive', messageRef: 'MSG', implementation: 'Other' },
    { id: '_pj', type: 'parallelGateway', name: 'Join', gatewayDirection: 'Converging' },
    { id: '_if', type: 'inclusiveGateway', name: 'Inc split', gatewayDirection: 'Diverging', default: 'fInc2' },
    { id: '_man', type: 'manualTask', name: 'Manual' },
    { id: '_js', type: 'scriptTask', name: 'Derive flag (JS)', scriptFormat: JS,
      script: 'var n = (items == null) ? 0 : items.size();\nkcontext.setVariable("flag", n > 0);' },
    { id: '_ij', type: 'inclusiveGateway', name: 'Inc join', gatewayDirection: 'Converging' },
    { id: '_eg', type: 'eventBasedGateway', name: 'Wait for event', gatewayDirection: 'Diverging', eventGatewayType: 'Exclusive' },
    { id: '_cm', type: 'intermediateCatchEvent', eventType: 'message', messageRef: 'MSG', name: 'Catch msg' },
    { id: '_ct', type: 'intermediateCatchEvent', eventType: 'timer', timeDuration: 'PT5M', name: 'Catch timer' },
    { id: '_cs', type: 'intermediateCatchEvent', eventType: 'signal', signalName: 'Go', name: 'Catch signal' },
    { id: '_cc', type: 'intermediateCatchEvent', eventType: 'conditional', conditionExpr: 'return flag != null && flag;', name: 'Catch cond' },
    { id: '_xm', type: 'exclusiveGateway', name: 'Merge', gatewayDirection: 'Converging' },
    { id: '_call', type: 'callActivity', subtype: 'reusable', name: 'Call child', calledElement: 'com.acme.cov.child' },
    { id: '_mi', type: 'callActivity', subtype: 'multiInstance', name: 'Per-item loop', calledElement: 'com.acme.cov.child',
      multiInstance: { isSequential: false, collectionIn: 'items', collectionOut: 'itemResults', itemVar: 'currentItem', itemOutVar: 'itemResult', passthru: ['caseId'] } },
    { id: '_user', type: 'userTask', name: 'Review', taskName: 'Review', group: 'Ops' },
    { id: '_bt', type: 'boundaryEvent', eventType: 'timer', timeDuration: 'P30D', name: 'Day 30', attachedTo: '_user', cancelActivity: true },
    { id: '_bmsg', type: 'boundaryEvent', eventType: 'message', messageRef: 'MSG', name: 'Msg while reviewing', attachedTo: '_user', cancelActivity: false },
    { id: '_validate', type: 'callActivity', subtype: 'rest', name: 'Validate (REST)', url: '/v1/claims/validate-data', method: 'POST' },
    { id: '_be', type: 'boundaryEvent', eventType: 'error', errorRef: 'CALL_ERR', name: 'On error', attachedTo: '_validate', cancelActivity: true },
    { id: '_bcond', type: 'boundaryEvent', eventType: 'conditional', conditionExpr: 'return flag != null && !flag;', name: 'Cond', attachedTo: '_validate', cancelActivity: false },
    { id: '_besc', type: 'boundaryEvent', eventType: 'escalation', escalationRef: 'ESC', name: 'Esc', attachedTo: '_validate', cancelActivity: false },
    { id: '_bsig', type: 'boundaryEvent', eventType: 'signal', signalName: 'Go', name: 'Sig', attachedTo: '_validate', cancelActivity: false },
    { id: '_emb', type: 'subProcess', subtype: 'embedded', name: 'Embedded',
      nodes: [{ id: 'e_s', type: 'startEvent', subtype: 'none', name: 'S' }, { id: 'e_t', type: 'scriptTask', name: 'Work', script: 'kcontext.setVariable("caseId", kcontext.getVariable("caseId"));' }, { id: 'e_e', type: 'endEvent', subtype: 'none', name: 'E' }],
      flows: [{ id: 'ef1', sourceRef: 'e_s', targetRef: 'e_t' }, { id: 'ef2', sourceRef: 'e_t', targetRef: 'e_e' }] },
    { id: '_txn', type: 'subProcess', subtype: 'transaction', name: 'Transaction',
      nodes: [{ id: 't_s', type: 'startEvent', subtype: 'none', name: 'S' }, { id: 't_t', type: 'manualTask', name: 'Commit' }, { id: 't_e', type: 'endEvent', subtype: 'none', name: 'E' }],
      flows: [{ id: 'tf1', sourceRef: 't_s', targetRef: 't_t' }, { id: 'tf2', sourceRef: 't_t', targetRef: 't_e' }] },
    { id: '_cx', type: 'complexGateway', name: 'Complex', gatewayDirection: 'Diverging' },
    { id: '_thr', type: 'intermediateThrowEvent', eventType: 'signal', signalName: 'Go', name: 'Throw Go' },
    { id: '_thrMsg', type: 'intermediateThrowEvent', eventType: 'message', messageRef: 'MSG', name: 'Throw msg' },
    { id: '_end1', type: 'endEvent', subtype: 'none', name: 'End' },
    { id: '_endEsc', type: 'endEvent', eventType: 'escalation', escalationRef: 'ESC', name: 'End escalate' },
    { id: '_endSig', type: 'endEvent', subtype: 'signalThrow', eventType: 'signal', signalName: 'Go', name: 'End signal' },
    { id: '_assign', type: 'callActivity', subtype: 'rest', name: 'Assign', url: '/v1/claims/status', method: 'POST', reqExtra: 'json.put("status","EX");\n' },
    { id: '_logerr', type: 'scriptTask', name: 'Log error', script: 'System.out.println("err");' },
    { id: '_endErr', type: 'endEvent', subtype: 'errorThrow', eventType: 'error', errorRef: 'TERMINATE_CASE', name: 'Throw terminate' },
    { id: '_term', type: 'subProcess', subtype: 'event', name: 'Global Terminate', error: 'TERMINATE_CASE' },
  ],
  flows: [
    { id: 'f1', sourceRef: '_s', targetRef: '_boot' },
    { id: 'f2', sourceRef: '_boot', targetRef: '_br' },
    { id: 'f3', sourceRef: '_br', targetRef: '_pf' },
    { id: 'f4', name: 'A', sourceRef: '_pf', targetRef: '_snd' },
    { id: 'f5', name: 'B', sourceRef: '_pf', targetRef: '_rcv' },
    { id: 'f6', sourceRef: '_snd', targetRef: '_pj' },
    { id: 'f7', sourceRef: '_rcv', targetRef: '_pj' },
    { id: 'f8', sourceRef: '_pj', targetRef: '_if' },
    { id: 'fInc1', name: 'has items', sourceRef: '_if', targetRef: '_man', condition: 'return flag != null && flag;' },
    { id: 'fInc2', name: 'default', sourceRef: '_if', targetRef: '_js' },
    { id: 'f9', sourceRef: '_man', targetRef: '_ij' },
    { id: 'f10', sourceRef: '_js', targetRef: '_ij' },
    { id: 'f11', sourceRef: '_ij', targetRef: '_eg' },
    { id: 'fe1', sourceRef: '_eg', targetRef: '_cm' },
    { id: 'fe2', sourceRef: '_eg', targetRef: '_ct' },
    { id: 'fe3', sourceRef: '_eg', targetRef: '_cs' },
    { id: 'fe4', sourceRef: '_eg', targetRef: '_cc' },
    { id: 'f12', sourceRef: '_cm', targetRef: '_xm' },
    { id: 'f13', sourceRef: '_ct', targetRef: '_xm' },
    { id: 'f14', sourceRef: '_cs', targetRef: '_xm' },
    { id: 'f14b', sourceRef: '_cc', targetRef: '_xm' },
    { id: 'f15', sourceRef: '_xm', targetRef: '_call' },
    { id: 'f16', sourceRef: '_call', targetRef: '_mi' },
    { id: 'f17', sourceRef: '_mi', targetRef: '_user' },
    { id: 'f18', sourceRef: '_user', targetRef: '_validate' },
    { id: 'f19', sourceRef: '_validate', targetRef: '_emb' },
    { id: 'f20', sourceRef: '_emb', targetRef: '_txn' },
    { id: 'f21', sourceRef: '_txn', targetRef: '_cx' },
    { id: 'f22', name: 'p1', sourceRef: '_cx', targetRef: '_thr' },
    { id: 'f23', name: 'p2', sourceRef: '_cx', targetRef: '_endEsc' },
    { id: 'f24', sourceRef: '_thr', targetRef: '_thrMsg' },
    { id: 'f25', sourceRef: '_thrMsg', targetRef: '_end1' },
    // boundary handler paths
    { id: 'fbt', sourceRef: '_bt', targetRef: '_assign' },
    { id: 'fbmsg', sourceRef: '_bmsg', targetRef: '_endSig' },
    { id: 'fbe', sourceRef: '_be', targetRef: '_logerr' },
    { id: 'fbcond', sourceRef: '_bcond', targetRef: '_endSig' },
    { id: 'fbesc', sourceRef: '_besc', targetRef: '_endSig' },
    { id: 'fbsig', sourceRef: '_bsig', targetRef: '_endSig' },
    { id: 'f26', sourceRef: '_assign', targetRef: '_endSig' },
    { id: 'f27', sourceRef: '_logerr', targetRef: '_endErr' },
  ],
});

// ---------- P3/P4/P5/P6: cover the remaining START types ----------
const startVariants = [
  { id: 'com.acme.cov.sig', name: 'cov-signal-start', decl: { signals: [{ id: '_sig_s', name: 'Kick' }], errors: [] }, st: { type: 'startEvent', eventType: 'signal', signalName: 'Kick' } },
  { id: 'com.acme.cov.msg', name: 'cov-message-start', decl: { signals: [], errors: [], messages: [{ id: 'M2', name: 'M2' }] }, st: { type: 'startEvent', eventType: 'message', messageRef: 'M2' } },
  { id: 'com.acme.cov.timer', name: 'cov-timer-start', decl: { signals: [], errors: [] }, st: { type: 'startEvent', eventType: 'timer', timeCycle: 'R/PT1H' } },
  { id: 'com.acme.cov.cond', name: 'cov-cond-start', decl: { signals: [], errors: [] }, st: { type: 'startEvent', eventType: 'conditional', conditionExpr: 'return true;' } },
].map((v) => build({
  id: v.id, name: v.name, packageName: 'org.jbpm', declarations: v.decl, variables: [{ name: 'caseId', type: 'String' }],
  nodes: [
    { id: 's', name: 'Start', ...v.st },
    { id: 't', type: 'manualTask', name: 'Do' },
    { id: 'e', type: 'endEvent', subtype: 'terminate', eventType: 'terminate', name: 'End' },
  ],
  flows: [{ id: 'a', sourceRef: 's', targetRef: 't' }, { id: 'b', sourceRef: 't', targetRef: 'e' }],
}));

export function buildAllNodesProject(outDir) {
  const processes = [child, main, ...startVariants];
  for (const p of processes) { const v = validateModel(p); if (!v.ok) throw new Error(`invalid ${p.id}: ${v.errors.join('; ')}`); }
  const project = {
    root: outDir,
    descriptor: {
      gav: { groupId: 'com.acme', artifactId: 'coverage-bpm', version: '3.0.0-SNAPSHOT', name: 'Coverage BPM', kieVersion: '7.73.0.Final' },
      deployment: {
        runtimeStrategy: 'SINGLETON',
        workItemHandlers: [{ name: 'Rest', resolver: 'mvel', identifier: 'new org.jbpm.process.workitem.rest.RESTWorkItemHandler(classLoader)' }],
        environmentEntries: [{ name: 'INTEGRATION_LAYER_URL', resolver: 'mvel', identifier: '"http://localhost:3000"' }],
      },
    },
    processes,
  };
  const written = writeProject(project, outDir);
  return { outDir, written, project };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outDir = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'coverage');
  const { written, project } = buildAllNodesProject(outDir);
  console.log(`Exported ${project.processes.length}-process coverage project to ${outDir} (${written.length} files)`);
}
