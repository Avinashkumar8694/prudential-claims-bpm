import type { AppContext } from '../../context.ts';
import { Collections, type Folder, type Workflow } from '../../domain.ts';
import { notFound, conflict, validation } from '../../infra/errors.ts';

export class FoldersService {
  constructor(private ctx: AppContext) {}
  private repo() { return this.ctx.store.repo<Folder>(Collections.folders); }

  async list(): Promise<Folder[]> {
    return (await this.repo().query((f) => f.tenantId === this.ctx.tenantId)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<Folder> {
    const f = await this.repo().get(id);
    if (!f || f.tenantId !== this.ctx.tenantId) throw notFound('folder');
    return f;
  }

  async create(name: string, parentId: string | null, actor: string): Promise<Folder> {
    if (!name.trim()) throw validation('folder name is required');
    if (parentId) await this.get(parentId);
    const now = this.ctx.clock();
    const folder: Folder = {
      id: this.ctx.newId(), tenantId: this.ctx.tenantId, name: name.trim(), parentId,
      createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor,
    };
    await this.repo().put(folder);
    await this.ctx.audit({ kind: 'folder.created', actor, data: { name: folder.name } });
    return folder;
  }

  async rename(id: string, name: string, actor: string): Promise<Folder> {
    if (!name.trim()) throw validation('folder name is required');
    const folder = await this.get(id);
    folder.name = name.trim(); folder.updatedAt = this.ctx.clock(); folder.updatedBy = actor;
    await this.repo().put(folder);
    return folder;
  }

  async move(id: string, parentId: string | null, actor: string): Promise<Folder> {
    const folder = await this.get(id);
    if (parentId === id) throw validation('a folder cannot be its own parent');
    if (parentId) {
      await this.get(parentId);
      if (await this.isDescendantOf(parentId, id)) throw validation('cannot move a folder into its own descendant');
    }
    folder.parentId = parentId; folder.updatedAt = this.ctx.clock(); folder.updatedBy = actor;
    await this.repo().put(folder);
    return folder;
  }

  private async isDescendantOf(candidateId: string, ancestorId: string): Promise<boolean> {
    let cur = await this.repo().get(candidateId);
    while (cur?.parentId) {
      if (cur.parentId === ancestorId) return true;
      cur = await this.repo().get(cur.parentId);
    }
    return false;
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    const subfolders = await this.repo().query((f) => f.tenantId === this.ctx.tenantId && f.parentId === id);
    if (subfolders.length) throw conflict('folder is not empty (contains sub-folders)');
    const inFolder = await this.ctx.store.repo<Workflow>(Collections.workflows).query((w) => w.tenantId === this.ctx.tenantId && w.folderId === id);
    if (inFolder.length) throw conflict('folder is not empty (contains workflows)');
    await this.repo().delete(id);
  }
}
