// Import a jBPM (kjar) project — a { relativePath -> content } file map (as produced by export) — back
// into an engine project, then create a new project + draft version from it. Uses the SDK reader.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseProject, toEngineProject, type EngineProject } from '../../sdk/index.ts';
import type { AppContext } from '../../context.ts';
import { WorkflowService } from '../workflows/service.ts';
import { VersionService } from '../versions/service.ts';
import { validation } from '../../infra/errors.ts';

/** Reconstruct an EngineProject from a kjar file map (writes to a temp dir, parses, converts). */
export function kjarToEngine(files: Record<string, string>): EngineProject {
  if (!files || !Object.keys(files).length) throw validation('no files to import');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kjar-in-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const p = path.join(dir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    }
    return toEngineProject(parseProject(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export class ImportService {
  constructor(private ctx: AppContext) {}
  /** Import a kjar file map as a new project (workflow) + initial draft. */
  async importKjar(files: Record<string, string>, name: string | undefined, actor: string): Promise<{ workflowId: string; processes: number }> {
    const engine = kjarToEngine(files);
    const wf = await new WorkflowService(this.ctx).create({ name: name || (engine as any).name || (engine as any).id || 'Imported project' }, actor);
    await new VersionService(this.ctx).saveDraft(wf.defaultBranchId, engine, actor);
    await this.ctx.audit({ actor, kind: 'project.imported', workflowId: wf.id, data: { processes: engine.processes?.length || 0 } });
    return { workflowId: wf.id, processes: engine.processes?.length || 0 };
  }
}
