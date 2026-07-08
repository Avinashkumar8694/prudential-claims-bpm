// Example 4 — a process whose LOGIC IS JAVASCRIPT: script tasks and gateway conditions written in
// the JavaScript dialect, exported to jBPM format. This is the core goal — author JS, export jBPM.
//
// The JS runs server-side in the KIE engine (Nashorn on JDK 8/11, GraalVM JS on JDK 15+). It has
// direct access to process variables and `kcontext`. See docs/bpm-nodes/_scripting-reference.md.
import { writeProject, validateModel, autowire } from '../../dist/index.mjs';
import { isMain, outDir as defaultOutDir } from '../functions/io.mjs';
import { printWritten } from '../functions/report.mjs';

const JS = 'http://www.javascript.com/javascript';

// non-trivial JS: multiline, &&, >, quotes, string concat, object/var access — a CDATA stress test
export const CLASSIFY_JS = [
  'var amt = kcontext.getVariable("amount");',
  'var tier;',
  'if (amt != null && amt > 100000) {',
  '  tier = "HIGH";',
  '} else if (amt != null && amt > 10000) {',
  '  tier = "MEDIUM";',
  '} else {',
  '  tier = "LOW";',
  '}',
  'kcontext.setVariable("tier", tier);',
].join('\n');

export const BOOT_JS = 'kcontext.setVariable("baseUrl", "http://localhost:3000");';
export const NOTIFY_JS = 'print("high tier for case " + kcontext.getVariable("caseId"));';
export const COND_HIGH_JS = 'tier == "HIGH"';        // JavaScript-dialect condition
export const COND_OTHER_JS = 'tier != "HIGH" && tier != null';

export function buildJsProject(outDir) {
  const process = autowire({
    id: 'com.acme.js.classify', name: 'js-classify', packageName: 'org.jbpm',
    declarations: { signals: [], errors: [] },
    variables: [
      { name: 'caseId', type: 'String' }, { name: 'amount', type: 'java.lang.Double' },
      { name: 'tier', type: 'String' }, { name: 'baseUrl', type: 'String' },
    ],
    nodes: [
      { id: '_s', type: 'startEvent', subtype: 'none', name: 'Start', position: { x: 60, y: 140, width: 40, height: 40 } },
      { id: '_boot', type: 'scriptTask', name: 'Bootstrap (JS)', scriptFormat: JS, script: BOOT_JS, position: { x: 140, y: 130, width: 120, height: 60 } },
      { id: '_classify', type: 'scriptTask', name: 'Classify tier (JS)', scriptFormat: JS, script: CLASSIFY_JS, position: { x: 300, y: 130, width: 130, height: 60 } },
      { id: '_xg', type: 'exclusiveGateway', name: 'Tier?', gatewayDirection: 'Diverging', default: 'fOther', position: { x: 470, y: 140, width: 40, height: 40 } },
      { id: '_notify', type: 'scriptTask', name: 'Notify (JS)', scriptFormat: JS, script: NOTIFY_JS, position: { x: 540, y: 80, width: 120, height: 60 } },
      { id: '_endHigh', type: 'endEvent', subtype: 'none', name: 'High', position: { x: 700, y: 90, width: 40, height: 40 } },
      { id: '_endOther', type: 'endEvent', subtype: 'none', name: 'Other', position: { x: 700, y: 190, width: 40, height: 40 } },
    ],
    flows: [
      { id: 'f1', sourceRef: '_s', targetRef: '_boot' },
      { id: 'f2', sourceRef: '_boot', targetRef: '_classify' },
      { id: 'f3', sourceRef: '_classify', targetRef: '_xg' },
      { id: 'fHigh', name: 'HIGH', sourceRef: '_xg', targetRef: '_notify', condition: COND_HIGH_JS, conditionLanguage: JS },
      { id: 'fOther', name: 'other', sourceRef: '_xg', targetRef: '_endOther', condition: COND_OTHER_JS, conditionLanguage: JS },
      { id: 'f4', sourceRef: '_notify', targetRef: '_endHigh' },
    ],
  });

  const v = validateModel(process);
  if (!v.ok) throw new Error('invalid: ' + v.errors.join('; '));

  const project = {
    root: outDir,
    descriptor: {
      gav: { groupId: 'com.acme', artifactId: 'js-classify-bpm', version: '1.0.0-SNAPSHOT', name: 'JS Classify BPM', kieVersion: '7.73.0.Final' },
      deployment: { runtimeStrategy: 'SINGLETON', workItemHandlers: [], environmentEntries: [{ name: 'INTEGRATION_LAYER_URL', resolver: 'mvel', identifier: '"http://localhost:3000"' }] },
    },
    processes: [process],
  };
  const written = writeProject(project, outDir);
  return { outDir, written, project };
}

if (isMain(import.meta.url)) {
  const outDir = defaultOutDir(import.meta.url, 'js');
  const { written } = buildJsProject(outDir);
  printWritten('JS-scripted jBPM project', outDir, written);
}
