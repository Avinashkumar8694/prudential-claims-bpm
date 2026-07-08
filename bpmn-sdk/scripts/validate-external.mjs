// Validate the SDK against arbitrary real .bpmn/.bpmn2 files.
// Usage: node scripts/validate-external.mjs <dir-of-bpmn-files>
// For each: parse -> JSON, serialize -> BPMN, xmllint, re-parse, and check node/flow id sets survive.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { parseBpmn, serializeProcess, validateModel } from '../dist/index.mjs';

const dir = process.argv[2];
if (!dir) { console.error('usage: validate-external.mjs <dir>'); process.exit(2); }
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.bpmn') || f.endsWith('.bpmn2')).sort();

let ok = 0, diff = 0, fail = 0;
const set = (a) => a.map((x) => x.id).sort().join(',');
for (const f of files) {
  const p = path.join(dir, f);
  try {
    const m = parseBpmn(fs.readFileSync(p, 'utf8'));
    const out = serializeProcess(m);
    const tmp = p + '.sdkout.bpmn';
    fs.writeFileSync(tmp, out);
    execSync(`xmllint --noout "${tmp}"`, { stdio: 'pipe' });   // well-formedness
    const m2 = parseBpmn(out);
    const nodesOk = set(m.nodes) === set(m2.nodes);
    const flowsOk = set(m.flows) === set(m2.flows);
    const raw = m.nodes.filter((n) => n.type === 'raw').length;
    if (nodesOk && flowsOk) {
      ok++;
      console.log(`ok   ${f.padEnd(52)} nodes=${m.nodes.length} flows=${m.flows.length} vars=${m.variables.length}${raw ? ` raw=${raw}` : ''}`);
    } else {
      diff++;
      console.log(`DIFF ${f.padEnd(52)} nodes ${nodesOk ? 'ok' : 'MISMATCH'} flows ${flowsOk ? 'ok' : 'MISMATCH'}`);
    }
    fs.unlinkSync(tmp);
  } catch (e) {
    fail++;
    console.log(`FAIL ${f.padEnd(52)} ${String(e.message).split('\n')[0].slice(0, 80)}`);
  }
}
console.log(`\n${ok} ok · ${diff} id-diff · ${fail} error   (of ${files.length} files)`);
process.exit(fail || diff ? 1 : 0);
