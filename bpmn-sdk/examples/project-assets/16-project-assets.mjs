// Example 16 — the build-time "supporting" assets you declare on an EngineProject and the SDK writes
// into the kjar: work-item definitions (custom service-task types), DSL (rule readability), and i18n
// MESSAGES (labels keyed by locale). Configuration, not runtime-executed logic (except message lookup).
// See docs/bpm-assets/{work-item-definition,dsl,properties}/.
import { fromEngineProject, writeProject } from '../../dist/index.mjs';
import { resolve } from '../functions/properties.mjs';
import { isMain, outDir } from '../functions/io.mjs';
import { printWritten } from '../functions/report.mjs';

// custom service-task types — a task node references one by name; params/results are simple maps
export const WORK_ITEMS = [
  { name: 'SendEmail', displayName: 'Send Email', category: 'Communication',
    parameters: { to: 'String', subject: 'String', body: 'String' }, results: { messageId: 'String' } },
];
// DSL: natural-language phrases that expand to DRL (for guided rules)
export const DSL = [
  { scope: 'when', nl: 'a high value claim', mapping: 'Claim( amount > 100000 )' },
  { scope: 'then', nl: 'flag it as {level}', mapping: 'flag($c, "{level}");' },
];
// i18n messages — keyed by LOCALE (the SDK owns the .properties filenames). `default` = base bundle.
export const MESSAGES = {
  default: { 'review.title': 'Review claim', 'review.amount': 'Claim amount' },
  fr: { 'review.title': 'Examiner la demande', 'review.amount': 'Montant de la demande' },
};

export function buildProjectAssets(dir) {
  const engine = {
    workItems: WORK_ITEMS,
    dsl: DSL,
    messages: MESSAGES,
    processes: [{ id: 'p', name: 'p', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }],
  };
  const project = fromEngineProject(engine);
  const written = writeProject(project, dir);
  return { project, written };
}

if (isMain(import.meta.url)) {
  const dir = outDir(import.meta.url, 'project-assets');
  const { written } = buildProjectAssets(dir);
  printWritten('project config assets', dir, written);
  const fs = await import('node:fs'); const path = await import('node:path');
  const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');
  console.log('\n--- global/WorkDefinitions.wid ---\n' + read('global/WorkDefinitions.wid'));
  console.log('--- src/main/resources/dsl/definitions.dsl ---\n' + read('src/main/resources/dsl/definitions.dsl'));
  console.log('--- messages.properties (default) ---\n' + read('src/main/resources/messages.properties'));
  console.log('--- messages_fr.properties ---\n' + read('src/main/resources/messages_fr.properties'));
  // runtime: resolve a label by locale, falling back to default
  console.log('resolve(review.title, fr)  ->', resolve(MESSAGES, 'review.title', 'fr'));
  console.log('resolve(review.title, es)  ->', resolve(MESSAGES, 'review.title', 'es'), '(no es bundle -> default)');
}
