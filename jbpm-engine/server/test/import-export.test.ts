// Export an engine project to a kjar file map, then import it back — the processes survive the round-trip.
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.ts';
import { fakeClock } from '../src/infra/ids.ts';
import { makeContext } from '../src/context.ts';
import { WorkflowService } from '../src/modules/workflows/service.ts';
import { VersionService } from '../src/modules/versions/service.ts';
import { exportKjar } from '../src/modules/export/service.ts';
import { ImportService } from '../src/modules/import/service.ts';

test('export → import round-trip: a kjar file map re-imports as a project with the same processes', async () => {
  let n = 0;
  const store = new MemoryStore();
  const ctx = makeContext({ store, tenantId: 't1', clock: fakeClock().clock, newId: () => `id${++n}` });

  const wf = await new WorkflowService(ctx).create({ name: 'Round Trip' }, 'a');
  const engine = {
    id: wf.key, name: wf.name, processes: [{
      id: `${wf.key}.process`, name: 'Intake', package: 'com.acme', vars: [{ name: 'amount', type: 'double' }],
      nodes: [{ id: 's', type: 'start' }, { id: 't', type: 'manual', name: 'Register' }, { id: 'e', type: 'end' }],
      flows: [{ id: 'f1', from: 's', to: 't' }, { id: 'f2', from: 't', to: 'e' }],
    }],
  };
  await new VersionService(ctx).saveDraft(wf.defaultBranchId, engine as any, 'a');

  const { files } = exportKjar(engine as any);
  assert.ok(Object.keys(files).some((f) => f.endsWith('.bpmn')), 'export produced a bpmn');

  const imported = await new ImportService(ctx).importKjar(files, 'Imported RT', 'a');
  assert.ok(imported.processes >= 1, 'imported has a process');

  // the imported project's draft engine has the process (round-tripped through BPMN)
  const iwf = await new WorkflowService(ctx).get(imported.workflowId);
  const versions = await new VersionService(ctx).listByBranch(iwf.defaultBranchId);
  const proc = versions.at(-1)!.engine.processes?.[0] as any;
  assert.ok(proc, 'imported process present');
  assert.ok(proc.nodes.some((x: any) => x.type === 'start') && proc.nodes.some((x: any) => x.type === 'end'), 'start + end survived');
  assert.ok(proc.nodes.some((x: any) => x.type === 'manual'), 'manual task survived');
});
