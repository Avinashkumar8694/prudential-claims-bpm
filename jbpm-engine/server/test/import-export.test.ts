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

test('exportKjar denies export if a script task uses JavaScript (lang: "js") with a proper message of denial', () => {
  const engine = {
    id: 'test_js', name: 'Test JS', processes: [{
      id: 'test.js_proc', name: 'JS Process', package: 'com.acme', vars: [],
      nodes: [
        { id: 's', type: 'start' },
        { id: 'sc', type: 'script', name: 'Compute Discount', lang: 'js', code: 'const discount = 10;' },
        { id: 'e', type: 'end' },
      ],
      flows: [{ id: 'f1', from: 's', to: 'sc' }, { id: 'f2', from: 'sc', to: 'e' }],
    }],
  };

  assert.throws(() => exportKjar(engine as any), (err: any) => {
    assert.strictEqual(err.code, 'JBPM_EXPORT_DENIED');
    assert.ok(err.message.includes('Export to jBPM denied'), 'error message contains denial prefix');
    assert.ok(err.message.includes('JavaScript'), 'identifies JavaScript as unsupported');
    assert.ok(err.details?.issues?.some((i: any) => i.nodeId === 'sc' && i.kind === 'unsupported_code'));
    return true;
  });
});

test('exportKjar denies export if a sequence flow condition uses JavaScript', () => {
  const engine = {
    id: 'test_cond_js', name: 'Test Cond JS', processes: [{
      id: 'test.cond_proc', name: 'Cond Process', package: 'com.acme', vars: [{ name: 'amount', type: 'int' }],
      nodes: [
        { id: 's', type: 'start' },
        { id: 'gw', type: 'gateway', mode: 'exclusive' },
        { id: 'e1', type: 'end' },
        { id: 'e2', type: 'end' },
      ],
      flows: [
        { id: 'f1', from: 's', to: 'gw' },
        { id: 'f2', from: 'gw', to: 'e1', when: 'amount > 100', lang: 'js' },
        { id: 'f3', from: 'gw', to: 'e2', when: 'amount <= 100', lang: 'js' },
      ],
    }],
  };

  assert.throws(() => exportKjar(engine as any), (err: any) => {
    assert.strictEqual(err.code, 'JBPM_EXPORT_DENIED');
    assert.ok(err.details?.issues?.some((i: any) => i.flowId === 'f2' && i.rule === 'condition-lang-javascript'));
    return true;
  });
});

test('exportKjar denies export if an onEntry script uses JavaScript', () => {
  const engine = {
    id: 'test_entry_js', name: 'Test Entry JS', processes: [{
      id: 'test.entry_proc', name: 'Entry Process', package: 'com.acme', vars: [],
      nodes: [
        { id: 's', type: 'start' },
        { id: 't', type: 'manual', name: 'Manual Step', onEntry: 'console.log("hello");', onEntryLang: 'js' },
        { id: 'e', type: 'end' },
      ],
      flows: [{ id: 'f1', from: 's', to: 't' }, { id: 'f2', from: 't', to: 'e' }],
    }],
  };

  assert.throws(() => exportKjar(engine as any), (err: any) => {
    assert.strictEqual(err.code, 'JBPM_EXPORT_DENIED');
    assert.ok(err.details?.issues?.some((i: any) => i.nodeId === 't' && i.rule === 'on-entry-lang-javascript'));
    return true;
  });
});

test('exportKjar denies export if a node has unsupported raw type', () => {
  const engine = {
    id: 'test_raw', name: 'Test Raw', processes: [{
      id: 'test.raw_proc', name: 'Raw Process', package: 'com.acme', vars: [],
      nodes: [
        { id: 's', type: 'start' },
        { id: 'raw1', type: 'raw', name: 'Unknown Task', bpmnLocal: 'customTask' },
        { id: 'e', type: 'end' },
      ],
      flows: [{ id: 'f1', from: 's', to: 'raw1' }, { id: 'f2', from: 'raw1', to: 'e' }],
    }],
  };

  assert.throws(() => exportKjar(engine as any), (err: any) => {
    assert.strictEqual(err.code, 'JBPM_EXPORT_DENIED');
    assert.ok(err.details?.issues?.some((i: any) => i.nodeId === 'raw1' && i.kind === 'unsupported_node'));
    return true;
  });
});

test('exportKjar succeeds when all scripts and conditions use Java', () => {
  const engine = {
    id: 'test_java_clean', name: 'Test Java Clean', processes: [{
      id: 'test.java_proc', name: 'Java Process', package: 'com.acme', vars: [{ name: 'amount', type: 'int' }],
      nodes: [
        { id: 's', type: 'start' },
        { id: 'sc', type: 'script', name: 'Java Script', lang: 'java', code: 'kcontext.setVariable("amount", 200);' },
        { id: 'gw', type: 'gateway', mode: 'exclusive' },
        { id: 'e1', type: 'end' },
        { id: 'e2', type: 'end' },
      ],
      flows: [
        { id: 'f1', from: 's', to: 'sc' },
        { id: 'f2', from: 'sc', to: 'gw' },
        { id: 'f3', from: 'gw', to: 'e1', when: 'return ((Integer) kcontext.getVariable("amount")) > 100;', lang: 'java' },
        { id: 'f4', from: 'gw', to: 'e2', when: 'return ((Integer) kcontext.getVariable("amount")) <= 100;', lang: 'java' },
      ],
    }],
  };

  const { files } = exportKjar(engine as any);
  assert.ok(files['src/main/resources/com/acme/test.java_proc.bpmn'] || Object.keys(files).some((f) => f.endsWith('.bpmn')));
});
