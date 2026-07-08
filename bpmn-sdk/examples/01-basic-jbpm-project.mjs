// Example 1 — build a COMPLETE jBPM project in plain JavaScript, then export to jBPM format.
//
// This is the core use case: your own JS-based BPM designer produces a ProcessModel (JSON);
// the SDK exports it to jBPM-compatible BPMN + a deployable kjar (pom, kmodule, deployment
// descriptor). `mvn clean install` on the output builds a kjar you can deploy to a KIE server.
import { writeProject, validateModel } from '../dist/index.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

/** A small end-to-end claims process, built the way your engine would emit it. */
export function buildBasicProject(outDir) {
  const process = {
    id: 'com.acme.claims.intake',
    name: 'claims-intake',
    packageName: 'org.jbpm',
    processType: 'Public',
    declarations: { signals: [], errors: [{ id: 'TERMINATE_CASE', errorCode: 'TERMINATE_CASE' }] },
    variables: [
      { name: 'caseId', type: 'String' },
      { name: 'claimId', type: 'String' },
      { name: 'claimType', type: 'String' },
      { name: 'baseUrl', type: 'String' },
      { name: 'reqPayload', type: 'String' },
      { name: 'resPayload', type: 'String' },
      { name: 'validationPassed', type: 'java.lang.Boolean' },
    ],
    nodes: [
      { id: '_start', type: 'startEvent', subtype: 'none', name: 'Start', position: { x: 60, y: 140, width: 40, height: 40 }, outgoing: ['f1'] },
      { id: '_boot', type: 'scriptTask', name: 'Bootstrap', position: { x: 150, y: 130, width: 110, height: 60 }, incoming: ['f1'], outgoing: ['f2'],
        script: 'String url=System.getProperty("INTEGRATION_LAYER_URL"); if(url==null||url.isEmpty()) url="http://localhost:3000"; kcontext.setVariable("baseUrl", url);' },
      { id: '_validate', type: 'callActivity', subtype: 'rest', name: 'Validate Data', position: { x: 300, y: 130, width: 120, height: 60 }, incoming: ['f2'], outgoing: ['f3'],
        url: '/v1/claims/validate-data', method: 'POST',
        setVars: ['    kcontext.setVariable("validationPassed", root.path("validationPassed").asBoolean());\n'] },
      { id: '_xg', type: 'exclusiveGateway', name: 'Claim Type', gatewayDirection: 'Diverging', position: { x: 460, y: 140, width: 40, height: 40 }, incoming: ['f3'], outgoing: ['fDeath', 'fOther'] },
      { id: '_calc', type: 'callActivity', subtype: 'rest', name: 'Calculate Benefit', position: { x: 540, y: 80, width: 120, height: 60 }, incoming: ['fDeath'], outgoing: ['f4'],
        url: '/v1/claims/calculate', method: 'POST' },
      { id: '_review', type: 'userTask', name: 'Manual Review', taskName: 'Review', group: 'ClaimsExaminer', position: { x: 540, y: 190, width: 120, height: 60 }, incoming: ['fOther'], outgoing: ['f5'] },
      { id: '_endOk', type: 'endEvent', subtype: 'none', name: 'Done', position: { x: 720, y: 90, width: 40, height: 40 }, incoming: ['f4'] },
      { id: '_endRev', type: 'endEvent', subtype: 'none', name: 'To Examiner', position: { x: 720, y: 200, width: 40, height: 40 }, incoming: ['f5'] },
      // global terminate handler (error sub-process) — shorthand form
      { id: '_term', type: 'subProcess', subtype: 'event', name: 'Global Terminate', error: 'TERMINATE_CASE', position: { x: 150, y: 300, width: 260, height: 100, expanded: true } },
    ],
    flows: [
      { id: 'f1', sourceRef: '_start', targetRef: '_boot' },
      { id: 'f2', sourceRef: '_boot', targetRef: '_validate' },
      { id: 'f3', sourceRef: '_validate', targetRef: '_xg' },
      { id: 'fDeath', name: 'Death', sourceRef: '_xg', targetRef: '_calc', condition: 'return "DEATH".equals(claimType);' },
      { id: 'fOther', name: 'Other', sourceRef: '_xg', targetRef: '_review', condition: 'return !"DEATH".equals(claimType);' },
      { id: 'f4', sourceRef: '_calc', targetRef: '_endOk' },
      { id: 'f5', sourceRef: '_review', targetRef: '_endRev' },
    ],
  };

  const v = validateModel(process);
  if (!v.ok) throw new Error('invalid model: ' + v.errors.join('; '));

  const project = {
    root: outDir,
    descriptor: {
      gav: { groupId: 'com.acme', artifactId: 'claims-intake-bpm', version: '1.0.0-SNAPSHOT', name: 'Claims Intake BPM', kieVersion: '7.73.0.Final' },
      deployment: {
        runtimeStrategy: 'SINGLETON',
        workItemHandlers: [{ name: 'Rest', resolver: 'mvel', identifier: 'new org.jbpm.process.workitem.rest.RESTWorkItemHandler(classLoader)' }],
        environmentEntries: [{ name: 'INTEGRATION_LAYER_URL', resolver: 'mvel', identifier: '"http://localhost:3000"' }],
      },
    },
    processes: [process],
  };

  const written = writeProject(project, outDir);
  return { outDir, written };
}

// runnable directly: `node examples/01-basic-jbpm-project.mjs [outDir]`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outDir = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'basic');
  const { written } = buildBasicProject(outDir);
  console.log(`Exported jBPM project to ${outDir}:\n  ${written.join('\n  ')}`);
}
