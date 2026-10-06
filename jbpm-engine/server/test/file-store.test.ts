// Loads every REAL record that survived the data loss (server/.data/**) through FileStore + this
// project's own domain types — the strongest available ground-truth check that domain.ts's shapes
// actually match what was really persisted, not just what I remember/guessed.
import { test } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { FileStore } from '../src/store/file-store.ts';
import {
  Collections, type Workflow, type Folder, type Branch, type Version, type Deployment, type Instance,
  type Task, type TimerJob, type AuditEvent, type SystemSettings, type User, type Group, type Role,
  type WorkflowDefinition, type WorkflowInstance, type WorkflowInstanceAudit, type WorkflowInstanceComment,
  type SavedQuery,
} from '../src/domain.ts';

const dataDir = fileURLToPath(new URL('../.data', import.meta.url));
const store = new FileStore(dataDir);

// server/.data is gitignored (runtime data, incl. credential hashes), so a fresh clone won't have the
// surviving records these checks run against — skip them there instead of failing.
const needsRealData = { skip: existsSync(dataDir) ? false : 'server/.data is not present (gitignored)' };

test('workflows load with the expected shape', needsRealData, async () => {
  const rows = await store.repo<Workflow>(Collections.workflows).query(() => true);
  assert.ok(rows.length >= 30, `expected ~37 real workflows, got ${rows.length}`);
  for (const w of rows) {
    assert.strictEqual(typeof w.id, 'string');
    assert.strictEqual(typeof w.tenantId, 'string');
    assert.strictEqual(typeof w.key, 'string');
    assert.strictEqual(typeof w.name, 'string');
    assert.strictEqual(typeof w.defaultBranchId, 'string');
    assert.ok(Array.isArray(w.permissions));
    assert.ok(w.archived === undefined || typeof w.archived === 'boolean', 'archived is absent on older records — treat as false, never anything but boolean when present');
  }
});

test('folders, branches, versions load with the expected shape', needsRealData, async () => {
  const folders = await store.repo<Folder>(Collections.folders).query(() => true);
  for (const f of folders) { assert.strictEqual(typeof f.name, 'string'); assert.ok('parentId' in f); }

  const branches = await store.repo<Branch>(Collections.branches).query(() => true);
  assert.ok(branches.length >= 30, `expected ~37 branches, got ${branches.length}`);
  for (const b of branches) {
    assert.strictEqual(typeof b.workflowId, 'string');
    assert.strictEqual(typeof b.headVersionId, 'string');
    assert.strictEqual(typeof b.protected, 'boolean');
  }

  const versions = await store.repo<Version>(Collections.versions).query(() => true);
  assert.ok(versions.length >= 60, `expected ~75 versions, got ${versions.length}`);
  for (const v of versions) {
    assert.strictEqual(typeof v.number, 'number');
    assert.ok(v.state === 'draft' || v.state === 'published');
    if (v.engine) assert.ok(Array.isArray(v.engine.processes));
    else assert.strictEqual(v.state, 'draft', `version ${v.id} has no engine but is "${v.state}", not "draft"`);
  }
});

test('deployments load with a real engine.processes graph', needsRealData, async () => {
  const rows = await store.repo<Deployment>(Collections.deployments).query(() => true);
  assert.ok(rows.length >= 30, `expected ~37 deployments, got ${rows.length}`);
  for (const d of rows) {
    assert.ok(d.status === 'active' || d.status === 'inactive' || d.status === 'archived');
    assert.ok(d.engine && Array.isArray(d.engine.processes));
    for (const p of d.engine.processes) {
      assert.ok(Array.isArray(p.nodes), `deployment ${d.id} process ${p.id} has no nodes[]`);
      assert.ok(Array.isArray(p.flows), `deployment ${d.id} process ${p.id} has no flows[]`);
    }
  }
});

test('instances load and every parentInstanceId (if set) resolves to a real sibling instance', needsRealData, async () => {
  const rows = await store.repo<Instance>(Collections.instances).query(() => true);
  assert.ok(rows.length >= 100, `expected ~127 instances, got ${rows.length}`);
  const byId = new Map(rows.map((i) => [i.id, i]));
  for (const i of rows) {
    assert.ok(['running', 'waiting', 'suspended', 'completed', 'aborted', 'failed'].includes(i.status), `instance ${i.id} has unknown status "${i.status}"`);
    assert.ok(Array.isArray(i.tokens));
    assert.ok(Array.isArray(i.history));
    if (i.parentInstanceId) assert.ok(byId.has(i.parentInstanceId), `instance ${i.id}'s parentInstanceId ${i.parentInstanceId} does not exist`);
  }
});

test('tasks, timers, audit, settings, users/groups/roles load with the expected shape', needsRealData, async () => {
  const tasks = await store.repo<Task>(Collections.tasks).query(() => true);
  assert.ok(tasks.length >= 30, `expected ~38 tasks, got ${tasks.length}`);
  for (const t of tasks) assert.ok(['created', 'reserved', 'inprogress', 'completed', 'skipped', 'error', 'exited'].includes(t.status), `task ${t.id} has unknown status "${t.status}"`);

  const timers = await store.repo<TimerJob>(Collections.timers).query(() => true);
  for (const j of timers) assert.ok(['duration', 'cycle', 'date', 'start'].includes(j.kind));

  const audit = await store.repo<AuditEvent>(Collections.audit).query(() => true);
  assert.ok(audit.length >= 500, `expected ~718 audit events, got ${audit.length}`);
  for (const a of audit) assert.strictEqual(typeof a.kind, 'string');

  const settings = await store.repo<SystemSettings>(Collections.settings).get('system');
  assert.ok(settings, 'expected a "system" settings record');
  assert.strictEqual(typeof settings!.defaultPageSize, 'number');

  const users = await store.repo<User>(Collections.users).query(() => true);
  for (const u of users) {
    assert.ok(Array.isArray(u.groups) && Array.isArray(u.roles));
    assert.strictEqual(typeof u.active, 'boolean');
  }

  const groups = await store.repo<Group>(Collections.groups).query(() => true);
  assert.ok(groups.length >= 10, `expected ~12 groups, got ${groups.length}`);

  const roles = await store.repo<Role>(Collections.roles).query(() => true);
  for (const r of roles) assert.ok(Array.isArray(r.permissions));
});

test('the workflow_definition/workflow_instance facade loads and its piid resolves to a real instance', needsRealData, async () => {
  const defs = await store.repo<WorkflowDefinition>(Collections.workflowDefinitions).query(() => true);
  assert.strictEqual(defs.length, 2);
  for (const d of defs) {
    assert.strictEqual(typeof d.name, 'string');
    assert.strictEqual(typeof d.deploymentId, 'string');
    assert.strictEqual(typeof d.schemaValidationEnabled, 'boolean');
  }

  const wis = await store.repo<WorkflowInstance>(Collections.workflowInstances).query(() => true);
  assert.strictEqual(wis.length, 2);
  const instances = store.repo<Instance>(Collections.instances);
  for (const wi of wis) {
    assert.ok(['active', 'completed', 'failed', 'aborted'].includes(wi.status));
    if (wi.piid) {
      const real = await instances.get(wi.piid);
      assert.ok(real, `workflow_instance ${wi.id}'s piid ${wi.piid} does not resolve to a real instance`);
    }
  }
  const failedOne = wis.find((wi) => wi.status === 'failed');
  assert.ok(failedOne?.startError, 'expected the known failed sample to carry a startError message');

  const wiAudit = await store.repo<WorkflowInstanceAudit>(Collections.workflowInstanceAudit).query(() => true);
  assert.ok(wiAudit.length >= 6, `expected ~8 workflow_instance_audit rows, got ${wiAudit.length}`);
  for (const a of wiAudit) assert.strictEqual(typeof a.workflowInstanceId, 'string');

  const wiComments = await store.repo<WorkflowInstanceComment>(Collections.workflowInstanceComments).query(() => true);
  for (const c of wiComments) assert.strictEqual(typeof c.body, 'string');
});

test('saved queries load with the expected shape', needsRealData, async () => {
  const rows = await store.repo<SavedQuery>(Collections.savedQueries).query(() => true);
  for (const q of rows) {
    assert.strictEqual(typeof q.name, 'string');
    assert.strictEqual(typeof q.definition.entity, 'string');
  }
});

test('get() returns undefined for a missing id and query() returns [] for a nonexistent collection', async () => {
  const missing = await store.repo<Workflow>(Collections.workflows).get('does-not-exist');
  assert.strictEqual(missing, undefined);
  const empty = await store.repo<Workflow>('totally-made-up-collection').query(() => true);
  assert.deepStrictEqual(empty, []);
});
