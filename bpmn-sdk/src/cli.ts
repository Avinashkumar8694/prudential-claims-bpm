import fs from 'node:fs';
import { parseBpmn, serializeProcess, parseProject, writeProject, validateModel } from './index.js';
import type { Project, ProcessModel } from './types.js';

function usage(): void {
  console.log(`bpmn-sdk — jBPM BPMN <-> JSON

Usage:
  bpmn-sdk to-json <projectDir> [out.json]     Parse a BPM project's .bpmn files -> JSON model
  bpmn-sdk to-bpm  <in.json> [projectDir]      Serialize JSON model -> .bpmn files
  bpmn-sdk parse   <file.bpmn> [out.json]      Parse one .bpmn -> JSON
  bpmn-sdk build   <process.json> <out.bpmn>   Serialize one process JSON -> .bpmn
  bpmn-sdk validate <file.bpmn | projectDir>   Structural validation`);
}

export function run(argv: string[]): void {
  const [cmd, a, b] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help') return usage();

  if (cmd === 'to-json') {
    const project = parseProject(a);
    const json = JSON.stringify(project, null, 2);
    if (b) { fs.writeFileSync(b, json); console.log(`Wrote ${b} (${project.processes.length} processes)`); }
    else console.log(json);
    return;
  }
  if (cmd === 'to-bpm') {
    const project = JSON.parse(fs.readFileSync(a, 'utf8')) as Project;
    const written = writeProject(project, b || project.root);
    console.log(`Wrote ${written.length} file(s):\n  ${written.join('\n  ')}`);
    return;
  }
  if (cmd === 'parse') {
    const model = parseBpmn(fs.readFileSync(a, 'utf8'));
    const json = JSON.stringify(model, null, 2);
    if (b) { fs.writeFileSync(b, json); console.log(`Wrote ${b}`); } else console.log(json);
    return;
  }
  if (cmd === 'build') {
    const model = JSON.parse(fs.readFileSync(a, 'utf8')) as ProcessModel;
    fs.writeFileSync(b, serializeProcess(model));
    console.log(`Wrote ${b}`);
    return;
  }
  if (cmd === 'validate') {
    const stat = fs.statSync(a);
    const models = stat.isDirectory() ? parseProject(a).processes : [parseBpmn(fs.readFileSync(a, 'utf8'))];
    let bad = 0;
    for (const m of models) {
      const r = validateModel(m);
      console.log(`\n${m.id || m.name} — ${r.ok ? 'OK' : 'ERRORS'}`);
      r.errors.forEach((e) => { bad++; console.log('  ERROR: ' + e); });
      r.warnings.forEach((w) => console.log('  warn:  ' + w));
    }
    process.exit(bad ? 1 : 0);
  }
  usage();
}
