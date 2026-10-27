// Folder CRUD + tree integrity (cycle prevention, non-empty delete blocked) + Workflow.folderId wiring.
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.ts';
import { fakeClock } from '../src/infra/ids.ts';
import { makeContext } from '../src/context.ts';
import { FolderService } from '../src/modules/folders/service.ts';
import { WorkflowService } from '../src/modules/workflows/service.ts';

const newCtx = () => { let n = 0; return makeContext({ store: new MemoryStore(), tenantId: 't1', clock: fakeClock().clock, newId: () => `id${++n}` }); };

test('folder CRUD: create, rename, list sorted by name, delete', async () => {
  const ctx = newCtx();
  const folders = new FolderService(ctx);
  const a = await folders.create({ name: 'Claims' }, 'admin');
  const b = await folders.create({ name: 'Archived' }, 'admin');
  assert.strictEqual((await folders.list()).map((f) => f.name).join(','), 'Archived,Claims');

  const renamed = await folders.update(a.id, { name: 'Claims 2024' }, 'admin');
  assert.strictEqual(renamed.name, 'Claims 2024');

  await folders.delete(b.id);
  assert.strictEqual((await folders.list()).length, 1);
  await assert.rejects(() => folders.get(b.id), /not found/);
});

test('folder nesting: subfolder move, self-parent and cyclic-parent rejected', async () => {
  const ctx = newCtx();
  const folders = new FolderService(ctx);
  const parent = await folders.create({ name: 'Parent' }, 'admin');
  const child = await folders.create({ name: 'Child', parentId: parent.id }, 'admin');

  await assert.rejects(() => folders.update(parent.id, { parentId: parent.id }, 'admin'), /own parent/);
  await assert.rejects(() => folders.update(parent.id, { parentId: child.id }, 'admin'), /own descendant/);

  const grandchild = await folders.create({ name: 'Grandchild', parentId: child.id }, 'admin');
  assert.strictEqual(grandchild.parentId, child.id);
});

test('deleting a non-empty folder is blocked (subfolders and projects both count)', async () => {
  const ctx = newCtx();
  const folders = new FolderService(ctx);
  const workflows = new WorkflowService(ctx);
  const parent = await folders.create({ name: 'Parent' }, 'admin');
  await folders.create({ name: 'Child', parentId: parent.id }, 'admin');
  await assert.rejects(() => folders.delete(parent.id), /not empty/);

  const empty = await folders.create({ name: 'Empty' }, 'admin');
  await workflows.create({ name: 'Leave Request', folderId: empty.id }, 'admin');
  await assert.rejects(() => folders.delete(empty.id), /not empty/);
});

test('workflow create/update validates folderId exists and supports moving to root', async () => {
  const ctx = newCtx();
  const folders = new FolderService(ctx);
  const workflows = new WorkflowService(ctx);
  const f = await folders.create({ name: 'Ops' }, 'admin');

  await assert.rejects(() => workflows.create({ name: 'Bad', folderId: 'nope' }, 'admin'), /Folder not found/);

  const w = await workflows.create({ name: 'Onboarding', folderId: f.id }, 'admin');
  assert.strictEqual(w.folderId, f.id);

  const moved = await workflows.update(w.id, { folderId: null }, 'admin');
  assert.strictEqual(moved.folderId, null);
});
