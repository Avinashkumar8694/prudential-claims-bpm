// Folders: organize Workflows into a tree for the Projects page. Purely presentational — no folder
// membership is ever consulted by execution or authz; see domain.ts's Folder/Workflow.folderId.
import type { AppContext } from '../../context.ts';
import { Collections, type Folder, type Workflow } from '../../domain.ts';
import { notFound, validation, conflict } from '../../infra/errors.ts';

export class FolderService {
  constructor(private ctx: AppContext) {}
  private fo() { return this.ctx.store.repo<Folder>(Collections.folders); }
  private wf() { return this.ctx.store.repo<Workflow>(Collections.workflows); }

  async list(): Promise<Folder[]> {
    return (await this.fo().query((f) => f.tenantId === this.ctx.tenantId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<Folder> {
    const f = await this.fo().get(id);
    if (!f || f.tenantId !== this.ctx.tenantId) throw notFound('Folder');
    return f;
  }

  private async assertParentValid(parentId: string | null | undefined, selfId?: string): Promise<void> {
    if (!parentId) return;
    if (parentId === selfId) throw validation('a folder cannot be its own parent');
    const parent = await this.fo().get(parentId);
    if (!parent || parent.tenantId !== this.ctx.tenantId) throw notFound('parent Folder');
    if (selfId) {
      // walk up from the proposed parent; if we hit selfId, this move would create a cycle
      let cur: Folder | undefined = parent;
      const seen = new Set<string>();
      while (cur?.parentId) {
        if (cur.parentId === selfId) throw validation('cannot move a folder into its own descendant');
        if (seen.has(cur.parentId)) break; // defensive: pre-existing cycle, don't infinite-loop
        seen.add(cur.parentId);
        cur = await this.fo().get(cur.parentId);
      }
    }
  }

  async create(input: { name: string; parentId?: string | null }, actor: string): Promise<Folder> {
    const name = (input.name || '').trim();
    if (!name) throw validation('name is required');
    await this.assertParentValid(input.parentId);

    const now = this.ctx.clock();
    const folder: Folder = {
      id: this.ctx.newId(), tenantId: this.ctx.tenantId, name, parentId: input.parentId || null,
      createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor,
    };
    await this.fo().put(folder);
    return folder;
  }

  async update(id: string, patch: { name?: string; parentId?: string | null }, actor: string): Promise<Folder> {
    const f = await this.get(id);
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw validation('name is required');
      f.name = name;
    }
    if (patch.parentId !== undefined) {
      await this.assertParentValid(patch.parentId, id);
      f.parentId = patch.parentId;
    }
    f.updatedAt = this.ctx.clock(); f.updatedBy = actor;
    await this.fo().put(f);
    return f;
  }

  async delete(id: string): Promise<void> {
    await this.get(id); // 404 if missing/wrong tenant
    const children = await this.fo().query((f) => f.tenantId === this.ctx.tenantId && f.parentId === id);
    if (children.length) throw conflict('folder is not empty — move or delete its subfolders first');
    const contents = await this.wf().query((w) => w.tenantId === this.ctx.tenantId && w.folderId === id && !w.archived);
    if (contents.length) throw conflict('folder is not empty — move its projects out first');
    await this.fo().delete(id);
  }
}
