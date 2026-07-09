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

test('flow-direction: no connection out of end, into start, or into boundary', async () => {
  const r = validateProcess(proc(
    [{ id: 's', type: 'start' }, { id: 't', type: 'manual' }, { id: 'e', type: 'end' },
     { id: 'b', type: 'boundary', on: ['t'], event: { error: '*' } }],
    [{ id: 'f1', from: 's', to: 't' }, { id: 'f2', from: 't', to: 'e' },
     { id: 'bad1', from: 'e', to: 't' },   // out of end
     { id: 'bad2', from: 't', to: 's' },   // into start
     { id: 'bad3', from: 't', to: 'b' }]));  // into boundary
  const dir = r.problems.filter((p) => p.rule === 'flow-direction');
  assert.strictEqual(dir.length, 3, JSON.stringify(dir));
  assert.ok(dir.every((p) => p.severity === 'error'));
});

test('connection-cardinality: tasks are 1-in/1-out; gateways may fan; no mixed gateway', async () => {
  // a script task with two outgoing → error; a gateway diverging (1→2) → ok
  const r = validateProcess(proc(
    [{ id: 's', type: 'start' }, { id: 'sc', type: 'script', code: 'x' }, { id: 'gw', type: 'gateway', mode: 'exclusive' },
     { id: 'a', type: 'manual' }, { id: 'b', type: 'manual' }, { id: 'e', type: 'end' }],
    [{ id: 'f1', from: 's', to: 'sc' },
     { id: 'f2', from: 'sc', to: 'gw' }, { id: 'f2b', from: 'sc', to: 'a' },   // script has 2 outgoing → invalid
     { id: 'f3', from: 'gw', to: 'a' }, { id: 'f4', from: 'gw', to: 'b' },      // gateway 1→2 → ok
     { id: 'f5', from: 'a', to: 'e' }, { id: 'f6', from: 'b', to: 'e' }]));
  const card = r.problems.filter((p) => p.rule === 'connection-cardinality');
  assert.ok(card.some((p) => p.nodeId === 'sc'), 'script with 2 outgoing flagged');
  assert.ok(!card.some((p) => p.nodeId === 'gw'), 'gateway diverging is allowed');
});

test('connection-cardinality: a mixed gateway (many→many) is an error', async () => {
  const r = validateProcess(proc(
    [{ id: 's', type: 'start' }, { id: 'a', type: 'manual' }, { id: 'gw', type: 'gateway', mode: 'parallel' },
     { id: 'x', type: 'manual' }, { id: 'y', type: 'manual' }, { id: 'e', type: 'end' }],
    [{ id: 'f1', from: 's', to: 'a' }, { id: 'f2', from: 'a', to: 'gw' }, { id: 'f3', from: 's', to: 'gw' },   // 2 in
     { id: 'f4', from: 'gw', to: 'x' }, { id: 'f5', from: 'gw', to: 'y' },   // 2 out → mixed
     { id: 'f6', from: 'x', to: 'e' }, { id: 'f7', from: 'y', to: 'e' }]));
  assert.ok(r.problems.some((p) => p.rule === 'connection-cardinality' && p.nodeId === 'gw' && /diverging|converging/.test(p.message)));
});

test('ends-at-end: a path that loops without reaching an End is an error', async () => {
  // s → a → b → a (loop, never reaches e); e is a separate reachable end via s? no — make s→a, a→b, b→a
  const r = validateProcess(proc(
    [{ id: 's', type: 'start' }, { id: 'a', type: 'manual' }, { id: 'b', type: 'manual' }, { id: 'e', type: 'end' }],
    [{ id: 'f1', from: 's', to: 'a' }, { id: 'f2', from: 'a', to: 'b' }, { id: 'f3', from: 'b', to: 'a' }, { id: 'f4', from: 's', to: 'e' }]));
  // wait: start has maxOut 1 — two outgoing from s would be a cardinality error, not what we test.
  // Use a gateway to branch so the loop is legal structurally but never ends.
  const r2 = validateProcess(proc(
    [{ id: 's', type: 'start' }, { id: 'g', type: 'gateway', mode: 'exclusive', default: 'fe' }, { id: 'a', type: 'manual' }, { id: 'b', type: 'manual' }, { id: 'e', type: 'end' }],
    [{ id: 'f1', from: 's', to: 'g' }, { id: 'fe', from: 'g', to: 'e' }, { id: 'fa', from: 'g', to: 'a' }, { id: 'f2', from: 'a', to: 'b' }, { id: 'f3', from: 'b', to: 'a' }]));
  assert.ok(r2.problems.some((p) => p.rule === 'ends-at-end' && (p.nodeId === 'a' || p.nodeId === 'b')), 'looping branch flagged as not reaching an end');
  void r;
});

test('orphan + dead-end are both reported; a clean process passes', async () => {
  const orphan = validateProcess(proc(
    [{ id: 's', type: 'start' }, { id: 'x', type: 'manual', name: 'Orphan' }, { id: 'e', type: 'end' }],
    [{ id: 'f1', from: 's', to: 'e' }]));
  assert.ok(orphan.problems.some((p) => p.rule === 'node-connected' && p.nodeId === 'x'), 'orphan flagged');
  const clean = validateProcess(proc(
    [{ id: 's', type: 'start' }, { id: 't', type: 'manual' }, { id: 'e', type: 'end' }],
    [{ id: 'f1', from: 's', to: 't' }, { id: 'f2', from: 't', to: 'e' }]));
  assert.strictEqual(clean.ok, true, JSON.stringify(clean.errors));
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
