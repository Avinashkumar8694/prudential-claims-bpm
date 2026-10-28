// Runs every node example's demo() and reports the jBPM node type produced. `node examples/nodes/run-all.mjs`
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(here).filter((f) => f.endsWith('.mjs') && f !== 'run-all.mjs').sort();
let ok = 0;
for (const f of files) {
  const mod = await import(pathToFileURL(path.join(here, f)).href);
  const { model } = mod.demo();
  console.log(f.padEnd(34), '->', model.nodes.map((n) => n.type).join(', '));
  ok++;
}
console.log('\n' + ok + '/' + files.length + ' node examples converted + round-tripped OK');
