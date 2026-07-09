// Project config assets — work-item definitions (.wid), DSL (.dsl), and .properties: generated from
// EngineProject + codec round-trips. Mirrors docs/bpm-assets/{work-item-definition,dsl,properties}.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fromEngineProject, writeProject, parseWid, widMvel, buildAsset, parseAsset, DEFAULT_WORK_ITEMS } from '../dist/index.mjs';
import { buildProjectAssets, WORK_ITEMS, DSL, MESSAGES } from '../examples/project-assets/16-project-assets.mjs';
import { resolve, labelsFor } from '../examples/functions/properties.mjs';

test('standard work items are auto-included with NO declaration', () => {
  const proj = fromEngineProject({ processes: [{ id: 'p', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }] });
  const names = proj.descriptor.workDefinitions.map((w) => w.name);
  for (const std of ['Rest', 'Email', 'WebService', 'Log']) assert.ok(names.includes(std), `default ${std} defined`);
  const handlers = proj.descriptor.deployment.workItemHandlers.map((h) => h.name);
  for (const std of ['Rest', 'Email', 'WebService', 'Log']) assert.ok(handlers.includes(std), `default ${std} handler registered`);
  assert.ok(proj.descriptor.deployment.workItemHandlers.find((h) => h.name === 'Rest').identifier.includes('RESTWorkItemHandler'));
  assert.strictEqual(DEFAULT_WORK_ITEMS.length, 4);
});

test('custom work item extends the defaults (by name)', () => {
  const proj = fromEngineProject({ workItems: WORK_ITEMS, processes: [{ id: 'p', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }] });
  const names = proj.descriptor.workDefinitions.map((w) => w.name);
  assert.ok(names.includes('Rest') && names.includes('SendEmail'), 'defaults + custom both present');
});

test('fromEngineProject — workItems -> global/WorkDefinitions.wid', () => {
  const proj = fromEngineProject({ workItems: WORK_ITEMS, processes: [{ id: 'p', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }] });
  assert.ok(proj.descriptor.workDefinitions, 'workDefinitions on descriptor');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wid-'));
  writeProject(proj, dir);
  const wid = fs.readFileSync(path.join(dir, 'global/WorkDefinitions.wid'), 'utf8');
  assert.ok(wid.includes('"name" : "SendEmail"') && wid.includes('"displayName" : "Send Email"'));
  assert.ok(wid.includes('"to" : new String()'), 'parameter typed');
  assert.ok(wid.includes('"messageId" : new String()'), 'result typed');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fromEngineProject — dsl -> .dsl, messages -> locale .properties (SDK-owned filenames)', () => {
  const { project } = buildProjectAssets(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-')));
  const dsl = project.descriptor.files['src/main/resources/dsl/definitions.dsl'];
  assert.ok(dsl.includes('[when]a high value claim=Claim( amount > 100000 )'));
  assert.ok(dsl.includes('[then]flag it as {level}=flag($c, "{level}");'));
  // locale "default" -> messages.properties ; locale "fr" -> messages_fr.properties (no kjar path authored)
  assert.ok(project.descriptor.files['src/main/resources/messages.properties'].includes('review.title=Review claim'));
  assert.ok(project.descriptor.files['src/main/resources/messages_fr.properties'].includes('review.title=Examiner la demande'));
});

test('messages runtime — resolve by locale with fallback to default', () => {
  assert.strictEqual(resolve(MESSAGES, 'review.title', 'fr'), 'Examiner la demande');
  assert.strictEqual(resolve(MESSAGES, 'review.amount', 'fr'), 'Montant de la demande');
  assert.strictEqual(resolve(MESSAGES, 'review.title', 'es'), 'Review claim', 'no es bundle -> default');
  assert.strictEqual(resolve(MESSAGES, 'missing.key', 'fr'), undefined);
  assert.deepStrictEqual(labelsFor(MESSAGES, 'review.', 'fr'), { 'review.title': 'Examiner la demande', 'review.amount': 'Montant de la demande' });
});

test('WID codec — widMvel/parseWid round-trip', () => {
  const wid = widMvel(WORK_ITEMS);
  const back = parseWid(wid);
  assert.strictEqual(back[0].name, 'SendEmail');
  assert.deepStrictEqual(Object.keys(back[0].parameters).sort(), ['body', 'subject', 'to']);
  assert.deepStrictEqual(Object.keys(back[0].results), ['messageId']);
});

test('DSL + properties codecs — round-trip stable', () => {
  const dsl = buildAsset({ kind: 'dsl', model: { entries: DSL } });
  assert.strictEqual(buildAsset(parseAsset('x.dsl', dsl)), dsl, 'dsl stable');
  const props = buildAsset({ kind: 'properties', model: { props: { a: '1', b: '2' } } });
  assert.strictEqual(buildAsset(parseAsset('x.properties', props)), props, 'properties stable');
});
