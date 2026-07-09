// Engine validation rules + the publish gate (no invalid/unconnected process is publishable).
import { test } from 'node:test';
import assert from 'node:assert';
import { validateProcess } from '../src/modules/validation/rules.ts';
import { MemoryStore } from '../src/store/memory-store.ts';
import { fakeClock } from '../src/infra/ids.ts';
import { makeContext } from '../src/context.ts';
import { WorkflowService } from '../src/modules/workflows/service.ts';
import { VersionService } from '../src/modules/versions/service.ts';

const proc = (nodes: any[], flows: any[]) => ({ id: 'p', name: 'p', package: 'com.acme', vars: [], nodes, flows }) as any;
const codes = (r: { problems: { rule: string }[] }) => r.problems.map((p) => p.rule);

test('valid linear process passes with no errors', () => {
  const r = validateProcess(proc(
    [{ id: 's', type: 'start', name: 'S' }, { id: 't', type: 'manual', name: 'Do' }, { id: 'e', type: 'end', name: 'E' }],
    [{ id: 'f1', from: 's', to: 't' }, { id: 'f2', from: 't', to: 'e' }]));
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.strictEqual(r.errors.length, 0);
});

test('unconnected node is an error', () => {
  const r = validateProcess(proc(
    [{ id: 's', type: 'start' }, { id: 'orphan', type: 'manual', name: 'Orphan' }, { id: 'e', type: 'end' }],
    [{ id: 'f1', from: 's', to: 'e' }]));
  assert.strictEqual(r.ok, false);
  assert.ok(codes(r).includes('node-connected'), 'orphan flagged');
  assert.ok(r.errors.some((p) => p.nodeId === 'orphan'));
});

test('missing start and end are errors', () => {
  const r = validateProcess(proc([{ id: 't', type: 'manual' }], []));
  assert.ok(codes(r).includes('start-exists'));
  assert.ok(codes(r).includes('end-exists'));
});

test('boundary attached to a missing host is an error', () => {
  const r = validateProcess(proc(
    [{ id: 's', type: 'start' }, { id: 't', type: 'manual' }, { id: 'b', type: 'boundary', on: 'ghost', event: { timer: { duration: 'PT1H' } } }, { id: 'e', type: 'end' }],
    [{ id: 'f1', from: 's', to: 't' }, { id: 'f2', from: 't', to: 'e' }, { id: 'f3', from: 'b', to: 'e' }]));
  assert.ok(codes(r).includes('boundary-host'));
});

test('flow to a non-existent node + empty script are errors', () => {
  const r = validateProcess(proc(
    [{ id: 's', type: 'start' }, { id: 'sc', type: 'script', lang: 'js', code: '' }, { id: 'e', type: 'end' }],
    [{ id: 'f1', from: 's', to: 'sc' }, { id: 'f2', from: 'sc', to: 'nope' }]));
  assert.ok(codes(r).includes('flow-endpoints'));
  assert.ok(codes(r).includes('node-config'), 'empty script flagged');
});

test('unreachable island is an error; user-task without assignment warns', () => {
  const r = validateProcess(proc(
    [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }, { id: 'a', type: 'manual' }, { id: 'b', type: 'userTask', name: 'Review' }],
    [{ id: 'f1', from: 's', to: 'e' }, { id: 'f2', from: 'a', to: 'b' }]));   // a->b island, unreachable
  assert.ok(codes(r).includes('reachable'));
  assert.ok(r.warnings.some((p) => p.rule === 'usertask-assignment'));
});

test('publish is blocked when the process has validation errors', async () => {
  const store = new MemoryStore(); let n = 0;
  const ctx = makeContext({ store, tenantId: 't1', clock: fakeClock().clock, newId: () => `id${++n}` });
  const wf = await new WorkflowService(ctx).create({ name: 'Bad WF' }, 'alice');
  // draft with an unconnected node
  const draft = await new VersionService(ctx).saveDraft(wf.defaultBranchId, {
    id: wf.key, name: wf.name, processes: [proc(
      [{ id: 's', type: 'start' }, { id: 'orphan', type: 'manual', name: 'Orphan' }, { id: 'e', type: 'end' }],
      [{ id: 'f1', from: 's', to: 'e' }])],
  } as any, 'alice');
  await assert.rejects(() => new VersionService(ctx).publish(draft.id, 'alice'), /Cannot publish/);
});
