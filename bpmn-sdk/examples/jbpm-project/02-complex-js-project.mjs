// Example 2 — a COMPLEX jBPM project authored in JavaScript, using the JavaScript script dialect.
//
// Demonstrates: JS-dialect script task + JS-dialect gateway condition, parallel gateway, user task
// with a 30-day boundary timer, a multi-instance call activity over a reusable child process, an
// event sub-process, signal/terminate ends, custom work-item definitions (.wid), and a full kjar.
//
// NOTE on the JS dialect: it runs server-side in the KIE engine and needs a JS script engine on the
// classpath (Nashorn on JDK 8/11; GraalVM JS on JDK 15+). See docs/bpm-nodes/_scripting-reference.md.
import { writeProject, validateModel, parseBpmn, serializeProcess } from '../../dist/index.mjs';
import { isMain, outDir as defaultOutDir } from '../functions/io.mjs';
import { printWritten } from '../functions/report.mjs';

const JS = 'http://www.javascript.com/javascript';

export function buildComplexProject(outDir) {
  // ---- reusable child process: evaluate ONE claim ----
  const child = {
    id: 'com.acme.claims.single', name: 'process-single-claim', packageName: 'org.jbpm',
    declarations: { signals: [], errors: [] },
    variables: [
      { name: 'caseId', type: 'String' }, { name: 'claimId', type: 'String' },
      { name: 'currentPolicy', type: 'String' }, { name: 'claimResult', type: 'java.lang.Object' },
      { name: 'claimStpEligible', type: 'java.lang.Boolean' },
      { name: 'baseUrl', type: 'String' }, { name: 'reqPayload', type: 'String' }, { name: 'resPayload', type: 'String' },
    ],
    nodes: [
      { id: '_cs', type: 'startEvent', subtype: 'none', name: 'Start', position: { x: 60, y: 100, width: 40, height: 40 }, outgoing: ['cf1'] },
      { id: '_cboot', type: 'scriptTask', name: 'Bootstrap', position: { x: 150, y: 90, width: 110, height: 60 }, incoming: ['cf1'], outgoing: ['cf2'],
        script: 'String u=System.getProperty("INTEGRATION_LAYER_URL"); if(u==null||u.isEmpty()) u="http://localhost:3000"; kcontext.setVariable("baseUrl", u);' },
      { id: '_ceval', type: 'callActivity', subtype: 'rest', name: 'Fast Track / STP', position: { x: 300, y: 90, width: 130, height: 60 }, incoming: ['cf2'], outgoing: ['cf3'],
        url: '/v1/claims/check-fast-track-rule', method: 'POST',
        reqExtra: 'json.put("policyNumber", String.valueOf(kcontext.getVariable("currentPolicy")));\n',
        setVars: ['    boolean clear = root.path("isFastTrackRuleClear").asBoolean();\n',
                  '    kcontext.setVariable("claimStpEligible", clear);\n'] },
      { id: '_ce', type: 'endEvent', subtype: 'none', name: 'End', position: { x: 470, y: 100, width: 40, height: 40 }, incoming: ['cf3'] },
    ],
    flows: [
      { id: 'cf1', sourceRef: '_cs', targetRef: '_cboot' },
      { id: 'cf2', sourceRef: '_cboot', targetRef: '_ceval' },
      { id: 'cf3', sourceRef: '_ceval', targetRef: '_ce' },
    ],
  };

  // ---- main process ----
  const main = {
    id: 'com.acme.claims.system', name: 'system-claim-process', packageName: 'org.jbpm',
    declarations: { signals: [{ id: '_sig_pay', name: 'PaymentProcess' }, { id: '_sig_exm', name: 'ClaimExaminer' }], errors: [{ id: 'TERMINATE_CASE', errorCode: 'TERMINATE_CASE' }] },
    variables: [
      { name: 'caseId', type: 'String' }, { name: 'claimId', type: 'String' },
      { name: 'applicablePolicies', type: 'java.util.List' }, { name: 'currentPolicy', type: 'String' },
      { name: 'claimResult', type: 'java.lang.Object' }, { name: 'claimResults', type: 'java.util.List' },
      { name: 'caseStpEligible', type: 'java.lang.Boolean' }, { name: 'outcome', type: 'String' },
      { name: 'baseUrl', type: 'String' }, { name: 'reqPayload', type: 'String' }, { name: 'resPayload', type: 'String' },
    ],
    lanes: [{ id: 'lane_sys', name: 'System', flowNodeRefs: ['_pend', '_agg'] }],
    nodes: [
      { id: '_s', type: 'startEvent', subtype: 'none', name: 'Start', position: { x: 60, y: 200, width: 40, height: 40 }, outgoing: ['f1'] },
      // JAVA bootstrap
      { id: '_boot', type: 'scriptTask', name: 'Bootstrap', position: { x: 150, y: 190, width: 110, height: 60 }, incoming: ['f1'], outgoing: ['f2'],
        script: 'String u=System.getProperty("INTEGRATION_LAYER_URL"); if(u==null||u.isEmpty()) u="http://localhost:3000"; kcontext.setVariable("baseUrl", u);' },
      // JAVASCRIPT script task (dialect = JS)
      { id: '_jsflag', type: 'scriptTask', name: 'JS: derive flag', scriptFormat: JS, position: { x: 300, y: 190, width: 120, height: 60 }, incoming: ['f2'], outgoing: ['f3'],
        script: 'var n = (applicablePolicies == null) ? 0 : applicablePolicies.size();\nkcontext.setVariable("caseStpEligible", n > 0);' },
      { id: '_pend', type: 'callActivity', subtype: 'rest', name: 'Pend Death', position: { x: 460, y: 190, width: 110, height: 60 }, incoming: ['f3'], outgoing: ['f4'],
        url: '/v1/policy/status', method: 'PUT', reqExtra: 'json.put("status","PEND_DEATH");\n' },
      // parallel fork/join around two checks
      { id: '_fork', type: 'parallelGateway', name: 'Fork', gatewayDirection: 'Diverging', position: { x: 610, y: 200, width: 40, height: 40 }, incoming: ['f4'], outgoing: ['f5', 'f6'] },
      { id: '_mrx', type: 'callActivity', subtype: 'rest', name: 'MRX Check', position: { x: 680, y: 130, width: 110, height: 60 }, incoming: ['f5'], outgoing: ['f7'],
        url: '/v1/claims/mrx-check', method: 'POST' },
      { id: '_contest', type: 'callActivity', subtype: 'rest', name: 'Contestability', position: { x: 680, y: 250, width: 110, height: 60 }, incoming: ['f6'], outgoing: ['f8'],
        url: '/v1/claims/validate-policy', method: 'POST' },
      { id: '_join', type: 'parallelGateway', name: 'Join', gatewayDirection: 'Converging', position: { x: 840, y: 200, width: 40, height: 40 }, incoming: ['f7', 'f8'], outgoing: ['f9'] },
      // multi-instance over applicablePolicies -> child process
      { id: '_perclaim', type: 'callActivity', subtype: 'multiInstance', name: 'Per-Claim Evaluation', position: { x: 900, y: 190, width: 170, height: 70 }, incoming: ['f9'], outgoing: ['f10'],
        calledElement: 'com.acme.claims.single',
        multiInstance: { isSequential: false, collectionIn: 'applicablePolicies', collectionOut: 'claimResults', itemVar: 'currentPolicy', itemOutVar: 'claimResult', passthru: ['caseId', 'claimId'] } },
      { id: '_agg', type: 'callActivity', subtype: 'rest', name: 'Aggregate STP', position: { x: 1100, y: 190, width: 120, height: 60 }, incoming: ['f10'], outgoing: ['f11'],
        url: '/v1/claims/stp-aggregate', method: 'POST',
        setVars: ['    kcontext.setVariable("outcome", root.path("outcome").asText());\n'] },
      // Outcome gateway with a JAVASCRIPT condition on one branch
      { id: '_out', type: 'exclusiveGateway', name: 'Outcome', gatewayDirection: 'Diverging', position: { x: 1250, y: 200, width: 40, height: 40 }, incoming: ['f11'], outgoing: ['fStp', 'fPend', 'fExm'] },
      { id: '_calc', type: 'callActivity', subtype: 'rest', name: 'Calculate Benefit', position: { x: 1320, y: 100, width: 120, height: 60 }, incoming: ['fStp'], outgoing: ['f12'],
        url: '/v1/claims/calculate', method: 'POST' },
      { id: '_endPay', type: 'endEvent', subtype: 'signalThrow', eventType: 'signal', signalName: 'PaymentProcess', name: 'Payment Process', position: { x: 1490, y: 110, width: 40, height: 40 }, incoming: ['f12'] },
      // pending branch: user task with 30-day boundary timer
      { id: '_await', type: 'userTask', name: 'Await documents', taskName: 'AwaitDocs', group: 'System', position: { x: 1320, y: 200, width: 120, height: 60 }, incoming: ['fPend'], outgoing: ['f13'] },
      { id: '_timer', type: 'boundaryEvent', eventType: 'timer', timeDuration: 'P30D', name: 'Day 30', attachedTo: '_await', cancelActivity: true, position: { x: 1360, y: 250, width: 36, height: 36 }, outgoing: ['fTo'] },
      { id: '_reclass', type: 'callActivity', subtype: 'rest', name: 'AI Reclassify', position: { x: 1490, y: 200, width: 120, height: 60 }, incoming: ['f13'], outgoing: ['fLoop'],
        url: '/v1/claims/nigo/rerun-idp', method: 'POST' },
      { id: '_assign1', type: 'callActivity', subtype: 'rest', name: 'Assign Examiner', position: { x: 1490, y: 300, width: 120, height: 60 }, incoming: ['fTo'], outgoing: ['f14'],
        url: '/v1/claims/status', method: 'POST', reqExtra: 'json.put("status","ASSIGNED_TO_EXAMINER");\n' },
      { id: '_endExm', type: 'endEvent', subtype: 'signalThrow', eventType: 'signal', signalName: 'ClaimExaminer', name: 'Claim Examiner', position: { x: 1660, y: 310, width: 40, height: 40 }, incoming: ['f14'] },
      // refer-to-examiner branch (JS condition)
      { id: '_assign2', type: 'callActivity', subtype: 'rest', name: 'Refer to Examiner', position: { x: 1320, y: 380, width: 120, height: 60 }, incoming: ['fExm'], outgoing: ['f15'],
        url: '/v1/claims/status', method: 'POST', reqExtra: 'json.put("status","REFERRED");\n' },
      { id: '_endExm2', type: 'endEvent', subtype: 'signalThrow', eventType: 'signal', signalName: 'ClaimExaminer', name: 'Claim Examiner', position: { x: 1490, y: 390, width: 40, height: 40 }, incoming: ['f15'] },
      // global terminate
      { id: '_term', type: 'subProcess', subtype: 'event', name: 'Global Terminate', error: 'TERMINATE_CASE', position: { x: 150, y: 470, width: 260, height: 100, expanded: true } },
    ],
    flows: [
      { id: 'f1', sourceRef: '_s', targetRef: '_boot' },
      { id: 'f2', sourceRef: '_boot', targetRef: '_jsflag' },
      { id: 'f3', sourceRef: '_jsflag', targetRef: '_pend' },
      { id: 'f4', sourceRef: '_pend', targetRef: '_fork' },
      { id: 'f5', sourceRef: '_fork', targetRef: '_mrx' },
      { id: 'f6', sourceRef: '_fork', targetRef: '_contest' },
      { id: 'f7', sourceRef: '_mrx', targetRef: '_join' },
      { id: 'f8', sourceRef: '_contest', targetRef: '_join' },
      { id: 'f9', sourceRef: '_join', targetRef: '_perclaim' },
      { id: 'f10', sourceRef: '_perclaim', targetRef: '_agg' },
      { id: 'f11', sourceRef: '_agg', targetRef: '_out' },
      // JAVASCRIPT-dialect condition
      { id: 'fStp', name: 'STP', sourceRef: '_out', targetRef: '_calc', condition: 'outcome == "STP"', conditionLanguage: JS },
      { id: 'fPend', name: 'Pending', sourceRef: '_out', targetRef: '_await', condition: 'return "PENDING_REQ".equals(outcome);' },
      { id: 'fExm', name: 'Examiner', sourceRef: '_out', targetRef: '_assign2', condition: 'return "EXAMINER".equals(outcome);' },
      { id: 'f12', sourceRef: '_calc', targetRef: '_endPay' },
      { id: 'f13', sourceRef: '_await', targetRef: '_reclass' },
      { id: 'fLoop', sourceRef: '_reclass', targetRef: '_join' },
      { id: 'fTo', sourceRef: '_timer', targetRef: '_assign1' },
      { id: 'f14', sourceRef: '_assign1', targetRef: '_endExm' },
      { id: 'f15', sourceRef: '_assign2', targetRef: '_endExm2' },
    ],
  };

  for (const p of [child, main]) {
    const v = validateModel(p);
    if (!v.ok) throw new Error(`invalid ${p.id}: ${v.errors.join('; ')}`);
  }

  const project = {
    root: outDir,
    descriptor: {
      gav: { groupId: 'com.acme', artifactId: 'complex-claims-bpm', version: '2.0.0-SNAPSHOT', name: 'Complex Claims BPM', kieVersion: '7.73.0.Final' },
      deployment: {
        runtimeStrategy: 'PER_PROCESS_INSTANCE',
        workItemHandlers: [{ name: 'Rest', resolver: 'mvel', identifier: 'new org.jbpm.process.workitem.rest.RESTWorkItemHandler(classLoader)' }],
        environmentEntries: [{ name: 'INTEGRATION_LAYER_URL', resolver: 'mvel', identifier: '"http://localhost:3000"' }],
      },
      // author a custom work-item palette entry from JSON -> generates global/WorkDefinitions.wid
      workDefinitions: [
        { name: 'Rest', displayName: 'REST', category: 'Communication', icon: 'defaultresticon.png',
          defaultHandler: 'mvel: new org.jbpm.process.workitem.rest.RESTWorkItemHandler(classLoader)',
          parameters: { Url: 'StringDataType', Method: 'StringDataType', ContentData: 'StringDataType' },
          results: { Result: 'ObjectDataType' } },
      ],
    },
    processes: [child, main],
  };

  const written = writeProject(project, outDir);
  return { outDir, written, project };
}

if (isMain(import.meta.url)) {
  const outDir = defaultOutDir(import.meta.url, 'complex');
  const { written } = buildComplexProject(outDir);
  printWritten('complex jBPM project', outDir, written);
}
