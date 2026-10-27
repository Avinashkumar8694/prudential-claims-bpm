// Real-project ground truth: every lang:'java' script/onEntry/onExit/condition in the ACTUAL bundled
// sample project must dry-compile against the real JVM sidecar — the same check the publish-time
// validator (rules.ts's java-support rule) runs, but exercised directly against real project data
// instead of synthetic test fixtures. This is what caught a genuine Jackson-shim gap this session
// (ObjectNode.putArray was missing entirely — a real onEntry script in pru-verification-process.bpmn
// uses it to build a JSON array field) that no synthetic unit test happened to exercise. Re-run this
// after ANY change to ScriptRunner.java/the Jackson shim classes, not just after adding tests for the
// specific thing you changed.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBpmn } from '@fabrixly/bpmn-sdk';
import { validateJava, stopJavaSidecar } from '../src/engine/java-sidecar.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..', '..', '..'); // prudential-claims-bpm

test.after(() => stopJavaSidecar());

function findBpmnFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) findBpmnFiles(p, out);
    else if (entry.name.endsWith('.bpmn')) out.push(p);
  }
  return out;
}

function collectVarTypes(m: any): Record<string, string> {
  const vt: Record<string, string> = {};
  for (const v of m.variables || []) vt[v.name] = v.type;
  return vt;
}

test('every lang:java script/onEntry/onExit/condition in the real bundled sample project dry-compiles against the JVM sidecar', { timeout: 60000 }, async () => {
  const files = findBpmnFiles(PROJECT);
  assert.ok(files.length > 0, `expected to find real .bpmn files under ${PROJECT}`);

  let scriptCount = 0, condCount = 0;
  const failures: string[] = [];

  const walkNodes = async (nodes: any[], varTypes: Record<string, string>, label: string): Promise<void> => {
    for (const n of nodes || []) {
      if (n.type === 'scriptTask' && n.scriptFormat?.includes('java') && n.script) {
        scriptCount++;
        const r = await validateJava(n.script, false, varTypes);
        if (!r.ok) failures.push(`${label} script "${n.id}": ${r.error}`);
      }
      if (n.onEntry && n.onEntryFormat?.includes('java')) {
        scriptCount++;
        const r = await validateJava(n.onEntry, false, varTypes);
        if (!r.ok) failures.push(`${label} onEntry "${n.id}": ${r.error}`);
      }
      if (n.onExit && n.onExitFormat?.includes('java')) {
        scriptCount++;
        const r = await validateJava(n.onExit, false, varTypes);
        if (!r.ok) failures.push(`${label} onExit "${n.id}": ${r.error}`);
      }
      if (Array.isArray(n.nodes)) await walkNodes(n.nodes, varTypes, label);
    }
  };
  const walkFlows = async (flows: any[], varTypes: Record<string, string>, label: string): Promise<void> => {
    for (const f of flows || []) {
      if (f.condition && f.conditionLanguage?.includes('java')) {
        condCount++;
        const r = await validateJava(f.condition, true, varTypes);
        if (!r.ok) failures.push(`${label} condition "${f.id}": ${r.error}`);
      }
    }
  };
  const walkAllFlows = async (nodes: any[], flows: any[], varTypes: Record<string, string>, label: string): Promise<void> => {
    await walkFlows(flows, varTypes, label);
    for (const n of nodes || []) if (Array.isArray(n.nodes)) await walkAllFlows(n.nodes, n.flows, varTypes, label);
  };

  for (const file of files) {
    const xml = fs.readFileSync(file, 'utf8');
    const m = parseBpmn(xml);
    const varTypes = collectVarTypes(m);
    const label = path.relative(PROJECT, file);
    await walkNodes(m.nodes, varTypes, label);
    await walkAllFlows(m.nodes, m.flows, varTypes, label);
  }

  assert.ok(scriptCount > 0 && condCount > 0, `expected to find real scripts/conditions in the project (found ${scriptCount} scripts, ${condCount} conditions)`);
  assert.deepStrictEqual(failures, [], `${failures.length}/${scriptCount + condCount} real scripts/conditions failed to compile:\n${failures.join('\n')}`);
});
