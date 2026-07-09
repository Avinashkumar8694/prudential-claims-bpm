// Export an engine project to a complete jBPM kjar file map (pom.xml, kmodule.xml, .bpmn per process,
// and all assets). Uses the SDK writer into a temp dir, then reads the tree back into a map.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fromEngineProject, writeProject, type EngineProject } from '../../sdk/index.ts';

const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.zip', '.jar', '.xls', '.xlsx']);

/** Build the kjar as a { relativePath -> content } map (text files; binaries as base64). */
export function exportKjar(engine: EngineProject): { files: Record<string, string> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kjar-'));
  try {
    const project = fromEngineProject(engine);
    project.root = dir;
    // ensure a GAV so a deployable pom.xml is emitted (UI projects have none by default)
    project.descriptor ||= {};
    project.descriptor.gav ||= { groupId: 'com.acme', artifactId: String((engine as any).id || 'process').replace(/[^A-Za-z0-9_-]/g, '-'), version: '1.0.0-SNAPSHOT', name: (engine as any).name };
    writeProject(project, dir);
    const files: Record<string, string> = {};
    const walk = (d: string, rel = '') => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name); const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(p, r);
        else files[r] = BINARY.has(path.extname(e.name).toLowerCase()) ? fs.readFileSync(p).toString('base64') : fs.readFileSync(p, 'utf8');
      }
    };
    walk(dir);
    return { files };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
