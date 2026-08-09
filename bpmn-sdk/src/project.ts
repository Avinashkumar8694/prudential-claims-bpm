import fs from 'node:fs';
import path from 'node:path';
import { parseBpmn } from './parse.js';
import { serializeProcess } from './serialize.js';
import { parseDescriptor, writeDescriptor } from './scaffold.js';
import type { Project } from './types.js';

export function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'target' && e.name !== '.git') walk(p, ext, out);
    } else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

/** Parse a jBPM project's .bpmn/.bpmn2 files (under src/main/resources) into one model. Real jBPM
 *  projects use both extensions interchangeably — the classic jbpm-playground examples (evaluation,
 *  human-resources, purchases, ...) all use .bpmn2, while newer/bpmn.io-authored files use .bpmn — so
 *  a project importing only one extension silently drops every process built with the other. */
export function parseProject(projectDir: string): Project {
  const resRoot = fs.existsSync(path.join(projectDir, 'src/main/resources'))
    ? path.join(projectDir, 'src/main/resources') : projectDir;
  const files = [...walk(resRoot, '.bpmn2'), ...walk(resRoot, '.bpmn')];
  const processes = files.map((f) => {
    const model = parseBpmn(fs.readFileSync(f, 'utf8'));
    model.sourcePath = path.relative(projectDir, f);
    return model;
  });
  return { root: projectDir, resourcesRoot: path.relative(projectDir, resRoot), descriptor: parseDescriptor(projectDir), processes };
}

/**
 * Write a complete project under projectDir: every process's .bpmn PLUS the kjar scaffolding
 * (pom.xml, kmodule.xml, kie-deployment-descriptor.xml, .wid, project.imports/repositories).
 * Pass { scaffold: false } to write only the .bpmn files.
 */
export function writeProject(project: Project, projectDir: string, opts: { scaffold?: boolean } = {}): string[] {
  const written: string[] = [];
  for (const proc of project.processes) {
    const rel = proc.sourcePath || path.join(project.resourcesRoot || 'src/main/resources', 'org/jbpm', `${proc.name}.bpmn`);
    const abs = path.join(projectDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, serializeProcess(proc));
    written.push(rel);
  }
  if (opts.scaffold !== false && (project.descriptor || opts.scaffold === true)) {
    written.push(...writeDescriptor(project.descriptor, projectDir));
  }
  return written;
}
