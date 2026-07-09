// Single source of truth for every bpm-node's engine.json example AND its runnable example.
// For each node it holds a full, valid ENGINE (nodejs) process (`proc`) plus which element is the
// documented focus. From that it writes:
//   docs/bpm-nodes/<folder>/engine.json      -> the focus element (the "full JSON example")
//   examples/nodes/<folder>.mjs              -> a runnable example that converts + round-trips it
// Then re-run scripts/gen-node-props.mjs so node_properties.md's Example picks up the new engine.json.
// Run: node scripts/gen-node-examples.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODES_DIR = path.join(ROOT, '..', 'docs', 'bpm-nodes');
const EX_DIR = path.join(ROOT, 'examples', 'nodes');

const S = { id: 'start', type: 'start', name: 'Start' };
const E = { id: 'end', type: 'end', name: 'End' };
const P = (o) => ({ id: 'com.acme.demo', name: 'demo', package: 'com.acme', ...o });

// folder -> { title, story, kind, focus, proc }.  kind: 'node' | 'flow' | 'data' | 'lane'
const NODES = {
  'start-event-none': {
    title: 'Start event (none)', story: 'A plain start with no trigger — the process is started explicitly (API / manual).',
    kind: 'node', focus: '_start',
    proc: P({ vars: [{ name: 'caseId', type: 'string' }], nodes: [
      { id: '_start', name: 'Claim started', type: 'start' }, { id: '_t', type: 'manual', name: 'Register claim' }, E,
    ], flows: [{ from: '_start', to: '_t' }, { from: '_t', to: 'end' }] }),
  },
  'start-event-signal': {
    title: 'Start event (signal)', story: 'A signal start — a broadcast signal spins up a new instance.',
    kind: 'node', focus: '_start',
    proc: P({ signals: ['StartSystemClaim'], vars: [{ name: 'caseId', type: 'string' }], nodes: [
      { id: '_start', name: 'On system claim', type: 'start', on: { signal: 'StartSystemClaim' } }, { id: '_t', type: 'manual', name: 'Handle claim' }, E,
    ], flows: [{ from: '_start', to: '_t' }, { from: '_t', to: 'end' }] }),
  },
  'end-event-none': {
    title: 'End event (none)', story: 'A plain end — this path finishes; other tokens keep running.',
    kind: 'node', focus: '_end',
    proc: P({ nodes: [S, { id: '_end', name: 'Path done', type: 'end' }], flows: [{ from: 'start', to: '_end' }] }),
  },
  'end-event-terminate': {
    title: 'End event (terminate)', story: 'A terminate end — cancels every other token and ends the whole instance.',
    kind: 'node', focus: '_end',
    proc: P({ nodes: [S, { id: '_end', name: 'Terminate all', type: 'end', result: 'terminate' }], flows: [{ from: 'start', to: '_end' }] }),
  },
  'end-event-signal-throw': {
    title: 'End event (signal throw)', story: 'A signal-throwing end — finishes the path and broadcasts a signal to start downstream work.',
    kind: 'node', focus: '_end',
    proc: P({ signals: ['PaymentProcess'], nodes: [S, { id: '_end', name: 'Trigger payment', type: 'end', throw: { signal: 'PaymentProcess' } }], flows: [{ from: 'start', to: '_end' }] }),
  },
  'end-event-error-throw': {
    title: 'End event (error throw)', story: 'An error-throwing end — aborts the path with an error the caller/boundary can catch.',
    kind: 'node', focus: '_end',
    proc: P({ errors: ['TERMINATE_CASE'], nodes: [S, { id: '_end', name: 'Abort case', type: 'end', throw: { error: 'TERMINATE_CASE' } }], flows: [{ from: 'start', to: '_end' }] }),
  },
  'script-task': {
    title: 'Script task', story: 'Runs inline code against the kcontext API (here: resolve a base URL into a process variable).',
    kind: 'node', focus: '_boot',
    proc: P({ vars: [{ name: 'baseUrl', type: 'string' }], nodes: [
      S, { id: '_boot', name: 'Bootstrap base URL', type: 'script', lang: 'java',
        code: 'String u = System.getProperty("INTEGRATION_LAYER_URL");\nif (u == null || u.isEmpty()) u = "http://localhost:3000";\nkcontext.setVariable("baseUrl", u);' }, E,
    ], flows: [{ from: 'start', to: '_boot' }, { from: '_boot', to: 'end' }] }),
  },
  'service-task-rest': {
    title: 'Service task (REST)', story: 'A REST call via the pru-rest-executor — the SDK builds the request payload and parses the response back into variables.',
    kind: 'node', focus: '_status',
    proc: P({ vars: [{ name: 'caseId', type: 'string' }, { name: 'verifierId', type: 'string' }], nodes: [
      S, { id: '_status', name: 'Set claim status', type: 'http', method: 'POST', url: '/v1/claims/status',
        headers: { 'Content-Type': 'application/json' }, body: { status: 'FOR_VERIFICATION', caseId: '$caseId' }, resultTo: { verifierId: '$.verifierId' } }, E,
    ], flows: [{ from: 'start', to: '_status' }, { from: '_status', to: 'end' }] }),
  },
  'user-task': {
    title: 'User task', story: 'A human task assigned to a group, bound to a form, non-skippable.',
    kind: 'node', focus: '_review',
    proc: P({ vars: [{ name: 'caseId', type: 'string' }], nodes: [
      S, { id: '_review', name: 'Review claim', type: 'userTask', group: 'Verifier', form: 'review', skippable: false }, E,
    ], flows: [{ from: 'start', to: '_review' }, { from: '_review', to: 'end' }] }),
  },
  'manual-task': {
    title: 'Manual task', story: 'An offline task the engine only tracks — no work item is executed.',
    kind: 'node', focus: '_file',
    proc: P({ nodes: [S, { id: '_file', name: 'File paperwork', type: 'manual' }, E], flows: [{ from: 'start', to: '_file' }, { from: '_file', to: 'end' }] }),
  },
  'business-rule-task': {
    title: 'Business rule task', story: 'Fires a DRL ruleflow-group to classify the claim. (Swap `ruleflowGroup` for `dmn:{...}` to evaluate a DMN decision instead.)',
    kind: 'node', focus: '_classify',
    proc: P({ vars: [{ name: 'claimType', type: 'string' }, { name: 'tier', type: 'string' }], nodes: [
      S, { id: '_classify', name: 'Classify claim', type: 'rule', ruleflowGroup: 'classify' }, E,
    ], flows: [{ from: 'start', to: '_classify' }, { from: '_classify', to: 'end' }] }),
  },
  'send-task': {
    title: 'Send task', story: 'Sends a message to a downstream system.',
    kind: 'node', focus: '_notify',
    proc: P({ messages: ['ClaimSubmitted'], nodes: [
      S, { id: '_notify', name: 'Notify downstream', type: 'send', message: 'ClaimSubmitted', implementation: '##WebService' }, E,
    ], flows: [{ from: 'start', to: '_notify' }, { from: '_notify', to: 'end' }] }),
  },
  'receive-task': {
    title: 'Receive task', story: 'Waits for an inbound message before continuing.',
    kind: 'node', focus: '_await',
    proc: P({ messages: ['Ack'], nodes: [
      S, { id: '_await', name: 'Await acknowledgement', type: 'receive', message: 'Ack', implementation: '##WebService' }, E,
    ], flows: [{ from: 'start', to: '_await' }, { from: '_await', to: 'end' }] }),
  },
  'call-activity': {
    title: 'Call activity (reusable)', story: 'Calls a reusable sub-process, mapping a variable in and a result out.',
    kind: 'node', focus: '_child',
    proc: P({ vars: [{ name: 'caseId', type: 'string' }, { name: 'result', type: 'string' }], nodes: [
      S, { id: '_child', name: 'Run sub-claim', type: 'call', process: 'com.acme.child', inputs: { caseId: '$caseId' }, outputs: { result: 'result' } }, E,
    ], flows: [{ from: 'start', to: '_child' }, { from: '_child', to: 'end' }] }),
  },
  'call-activity-multi-instance': {
    title: 'Call activity (multi-instance)', story: 'Runs a child process once per item in a collection (parallel), collecting each result.',
    kind: 'node', focus: '_perPolicy',
    proc: P({ vars: [{ name: 'caseId', type: 'string' }, { name: 'claimId', type: 'string' }, { name: 'applicablePolicies', type: 'list' }, { name: 'claimResults', type: 'list' }], nodes: [
      S, { id: '_perPolicy', name: 'Assess each policy', type: 'forEach', process: 'com.acme.assess', over: 'applicablePolicies', as: 'currentPolicy', collectInto: 'claimResults', itemResult: 'claimResult', parallel: true, pass: ['caseId', 'claimId'] }, E,
    ], flows: [{ from: 'start', to: '_perPolicy' }, { from: '_perPolicy', to: 'end' }] }),
  },
  'exclusive-gateway': {
    title: 'Exclusive gateway', story: 'Takes exactly one branch — the first flow whose condition is true, else the default.',
    kind: 'node', focus: '_route',
    proc: P({ vars: [{ name: 'claimType', type: 'string' }], nodes: [
      S, { id: '_route', name: 'Route by type', type: 'gateway', mode: 'exclusive', default: 'fOther' },
      { id: '_death', type: 'manual', name: 'Death claim' }, { id: '_other', type: 'manual', name: 'Other claim' }, E,
    ], flows: [
      { from: 'start', to: '_route' },
      { id: 'fDeath', from: '_route', to: '_death', when: 'return "DEATH".equals(claimType);', lang: 'java' },
      { id: 'fOther', from: '_route', to: '_other' },
      { from: '_death', to: 'end' }, { from: '_other', to: 'end' },
    ] }),
  },
  'parallel-gateway': {
    title: 'Parallel gateway', story: 'Forks into concurrent paths (Diverging) and later joins them (Converging).',
    kind: 'node', focus: '_fork',
    proc: P({ nodes: [
      S, { id: '_fork', name: 'Fork', type: 'gateway', mode: 'parallel', direction: 'Diverging' },
      { id: '_a', type: 'manual', name: 'Task A' }, { id: '_b', type: 'manual', name: 'Task B' },
      { id: '_join', name: 'Join', type: 'gateway', mode: 'parallel', direction: 'Converging' }, E,
    ], flows: [
      { from: 'start', to: '_fork' }, { from: '_fork', to: '_a' }, { from: '_fork', to: '_b' },
      { from: '_a', to: '_join' }, { from: '_b', to: '_join' }, { from: '_join', to: 'end' },
    ] }),
  },
  'inclusive-gateway': {
    title: 'Inclusive gateway', story: 'Takes every branch whose condition is true (plus the default), then joins.',
    kind: 'node', focus: '_split',
    proc: P({ vars: [{ name: 'needsReview', type: 'bool' }], nodes: [
      S, { id: '_split', name: 'Inclusive split', type: 'gateway', mode: 'inclusive', default: 'fDefault' },
      { id: '_review', type: 'manual', name: 'Review' }, { id: '_audit', type: 'manual', name: 'Audit' },
      { id: '_join', name: 'Join', type: 'gateway', mode: 'inclusive' }, E,
    ], flows: [
      { from: 'start', to: '_split' },
      { id: 'fReview', from: '_split', to: '_review', when: 'return needsReview != null && needsReview;', lang: 'java' },
      { id: 'fDefault', from: '_split', to: '_audit' },
      { from: '_review', to: '_join' }, { from: '_audit', to: '_join' }, { from: '_join', to: 'end' },
    ] }),
  },
  'event-based-gateway': {
    title: 'Event-based gateway', story: 'Waits for whichever event fires first (a message or a timeout) and follows that path.',
    kind: 'node', focus: '_wait',
    proc: P({ messages: ['Approval'], nodes: [
      S, { id: '_wait', name: 'Wait for event', type: 'gateway', mode: 'event' },
      { id: '_onMsg', type: 'catch', name: 'Approval received', event: { message: 'Approval' } },
      { id: '_onTimer', type: 'catch', name: 'Timed out', event: { timer: { duration: 'PT1H' } } }, E,
    ], flows: [
      { from: 'start', to: '_wait' }, { from: '_wait', to: '_onMsg' }, { from: '_wait', to: '_onTimer' },
      { from: '_onMsg', to: 'end' }, { from: '_onTimer', to: 'end' },
    ] }),
  },
  'intermediate-catch-timer': {
    title: 'Intermediate catch (timer)', story: 'Pauses the token for a fixed duration before continuing.',
    kind: 'node', focus: '_delay',
    proc: P({ nodes: [S, { id: '_delay', name: 'Wait 5 minutes', type: 'catch', event: { timer: { duration: 'PT5M' } } }, E], flows: [{ from: 'start', to: '_delay' }, { from: '_delay', to: 'end' }] }),
  },
  'intermediate-throw-event': {
    title: 'Intermediate throw (signal)', story: 'Broadcasts a signal mid-flow, then continues.',
    kind: 'node', focus: '_throw',
    proc: P({ signals: ['Go'], nodes: [S, { id: '_throw', name: 'Signal Go', type: 'throw', event: { signal: 'Go' } }, E], flows: [{ from: 'start', to: '_throw' }, { from: '_throw', to: 'end' }] }),
  },
  'event-message': {
    title: 'Intermediate catch (message)', story: 'Waits mid-flow for a named message to arrive.',
    kind: 'node', focus: '_msg',
    proc: P({ messages: ['ClaimUpdated'], nodes: [S, { id: '_msg', name: 'Await update', type: 'catch', event: { message: 'ClaimUpdated' } }, E], flows: [{ from: 'start', to: '_msg' }, { from: '_msg', to: 'end' }] }),
  },
  'event-conditional': {
    title: 'Intermediate catch (conditional)', story: 'Waits until a data condition becomes true.',
    kind: 'node', focus: '_cond',
    proc: P({ vars: [{ name: 'flag', type: 'bool' }], nodes: [S, { id: '_cond', name: 'Wait until flag set', type: 'catch', event: { condition: 'return flag != null && flag;', lang: 'java' } }, E], flows: [{ from: 'start', to: '_cond' }, { from: '_cond', to: 'end' }] }),
  },
  'event-escalation': {
    title: 'Intermediate throw (escalation)', story: 'Raises an escalation mid-flow (handled by an outer boundary/event sub-process) and continues.',
    kind: 'node', focus: '_esc',
    proc: P({ escalations: ['ESC'], nodes: [S, { id: '_esc', name: 'Escalate', type: 'throw', event: { escalation: 'ESC' } }, E], flows: [{ from: 'start', to: '_esc' }, { from: '_esc', to: 'end' }] }),
  },
  'boundary-event-error': {
    title: 'Boundary event (error)', story: 'An interrupting error boundary on a call activity — on error, cancels the host and runs the error path.',
    kind: 'node', focus: '_onErr',
    proc: P({ errors: ['CALL_ERR'], vars: [{ name: 'caseId', type: 'string' }], nodes: [
      S, { id: '_validate', name: 'Validate claim', type: 'call', process: 'com.acme.validate', inputs: { caseId: '$caseId' } },
      { id: '_onErr', name: 'On call error', type: 'boundary', on: '_validate', event: { error: 'CALL_ERR' }, interrupting: true },
      { id: '_log', type: 'script', lang: 'java', code: 'System.out.println("validation failed");' },
      { id: 'end', type: 'end', name: 'Done' }, { id: '_endErr', type: 'end', name: 'Aborted', throw: { error: 'CALL_ERR' } },
    ], flows: [
      { from: 'start', to: '_validate' }, { from: '_validate', to: 'end' },
      { from: '_onErr', to: '_log' }, { from: '_log', to: '_endErr' },
    ] }),
  },
  'boundary-event-timer': {
    title: 'Boundary event (timer)', story: 'A non-interrupting timer boundary on a user task — fires a reminder after 30 days while the task stays open.',
    kind: 'node', focus: '_reminder',
    proc: P({ messages: ['Reminder'], nodes: [
      S, { id: '_review', name: 'Review claim', type: 'userTask', group: 'Verifier' },
      { id: '_reminder', name: 'Reminder after 30 days', type: 'boundary', on: '_review', event: { timer: { duration: 'P30D' } }, interrupting: false },
      { id: '_notify', type: 'send', name: 'Send reminder', message: 'Reminder' }, { id: 'end', type: 'end', name: 'Done' },
    ], flows: [
      { from: 'start', to: '_review' }, { from: '_review', to: 'end' },
      { from: '_reminder', to: '_notify' }, { from: '_notify', to: 'end' },
    ] }),
  },
  'subprocess-embedded': {
    title: 'Embedded sub-process', story: 'An inline sub-process with its own start/script/end — shares the parent variables.',
    kind: 'node', focus: '_sub',
    proc: P({ vars: [{ name: 'valid', type: 'bool' }], nodes: [
      S, { id: '_sub', name: 'Validate & enrich', type: 'subprocess',
        nodes: [{ id: 's_s', type: 'start' }, { id: 's_check', type: 'script', lang: 'java', code: 'kcontext.setVariable("valid", true);' }, { id: 's_e', type: 'end' }],
        flows: [{ from: 's_s', to: 's_check' }, { from: 's_check', to: 's_e' }] }, E,
    ], flows: [{ from: 'start', to: '_sub' }, { from: '_sub', to: 'end' }] }),
  },
  'subprocess-transaction': {
    title: 'Transaction sub-process', story: 'A transactional sub-process — its work commits or compensates as a unit.',
    kind: 'node', focus: '_txn',
    proc: P({ nodes: [
      S, { id: '_txn', name: 'Payment transaction', type: 'subprocess', transaction: true,
        nodes: [{ id: 't_s', type: 'start' }, { id: 't_pay', type: 'call', name: 'Pay', process: 'com.acme.pay' }, { id: 't_e', type: 'end' }],
        flows: [{ from: 't_s', to: 't_pay' }, { from: 't_pay', to: 't_e' }] }, E,
    ], flows: [{ from: 'start', to: '_txn' }, { from: '_txn', to: 'end' }] }),
  },
  'event-subprocess': {
    title: 'Event sub-process', story: 'An error-triggered event sub-process — runs cleanup whenever the given error is thrown anywhere in the parent. Not connected by sequence flow.',
    kind: 'node', focus: '_handler',
    proc: P({ errors: ['TERMINATE_CASE'], nodes: [
      S, { id: '_work', type: 'manual', name: 'Do work' },
      { id: '_handler', name: 'On terminate', type: 'subprocess', on: { error: 'TERMINATE_CASE' },
        nodes: [{ id: 'h_s', type: 'start' }, { id: 'h_log', type: 'script', lang: 'java', code: 'System.out.println("cleanup");' }, { id: 'h_e', type: 'end' }],
        flows: [{ from: 'h_s', to: 'h_log' }, { from: 'h_log', to: 'h_e' }] }, E,
    ], flows: [{ from: 'start', to: '_work' }, { from: '_work', to: 'end' }] }),
  },
  'data-object': {
    title: 'Data object', story: 'Process-scoped typed variables (data objects) — including a collection.',
    kind: 'data',
    proc: P({ data: [
      { name: 'Document', type: 'object', collection: false },
      { name: 'ClaimAmount', type: 'double' },
      { name: 'AttachmentIds', type: 'string', collection: true },
    ], nodes: [
      S, { id: '_use', type: 'script', lang: 'java', code: 'kcontext.setVariable("ClaimAmount", 1000.0);' }, E,
    ], flows: [{ from: 'start', to: '_use' }, { from: '_use', to: 'end' }] }),
  },
  'lane': {
    title: 'Lane', story: 'Swimlanes group nodes by the role that performs them.',
    kind: 'lane',
    proc: P({ lanes: [{ name: 'System', nodes: ['_boot', '_route'] }, { name: 'Ops', nodes: ['_review'] }], nodes: [
      S, { id: '_boot', type: 'script', lang: 'java', code: 'kcontext.setVariable("ready", true);' },
      { id: '_route', type: 'gateway', mode: 'exclusive' }, { id: '_review', type: 'userTask', name: 'Review', group: 'Ops' }, E,
    ], flows: [{ from: 'start', to: '_boot' }, { from: '_boot', to: '_route' }, { from: '_route', to: '_review' }, { from: '_review', to: 'end' }] }),
  },
  'sequence-flow': {
    title: 'Sequence flow', story: 'A connection between nodes; with `when`+`lang` it becomes a conditional branch on a gateway.',
    kind: 'flow', focus: 'fDeath',
    proc: P({ vars: [{ name: 'claimType', type: 'string' }], nodes: [
      S, { id: '_route', type: 'gateway', mode: 'exclusive', default: 'fOther' },
      { id: '_death', type: 'manual', name: 'Death claim' }, { id: '_other', type: 'manual', name: 'Other claim' }, E,
    ], flows: [
      { from: 'start', to: '_route' },
      { id: 'fDeath', from: '_route', to: '_death', when: 'return "DEATH".equals(claimType);', lang: 'java' },
      { id: 'fOther', from: '_route', to: '_other' },
      { from: '_death', to: 'end' }, { from: '_other', to: 'end' },
    ] }),
  },
};

function focusEj(spec) {
  const { kind, focus, proc } = spec;
  if (kind === 'data') return { 'process-level': true, data: proc.data };
  if (kind === 'lane') return { 'process-level': true, lanes: proc.lanes };
  if (kind === 'flow') return proc.flows.find((f) => f.id === focus);
  return proc.nodes.find((n) => n.id === focus);
}

const exampleSrc = (folder, spec, ej) => {
  const focusLine = spec.kind === 'flow'
    ? `  const f = back.flows.find((x) => x.from === node.from && x.to === node.to);\n  console.log('  focus flow  :', JSON.stringify({ from: f.from, to: f.to, when: f.when }));`
    : spec.kind === 'data'
      ? `  console.log('  data objects:', back.data.map((d) => d.name + ':' + d.type + (d.collection ? '[]' : '')).join(', '));`
      : spec.kind === 'lane'
        ? `  console.log('  lanes       :', back.lanes.map((l) => l.name + '=' + l.nodes.join('+')).join(', '));`
        : `  const f = model.nodes.find((n) => n.id === ${JSON.stringify(spec.focus)});\n  console.log('  focus node  :', f.id + ' -> ' + f.type + (f.subtype ? '/' + f.subtype : ''));`;
  return `// ${spec.title} — ${spec.story}
//
// Authors the element in the ENGINE (nodejs) JSON model, converts to jBPM (fromEngine), validates the
// model, serializes BPMN, and round-trips back (toEngine). \`node\` is exactly
// docs/bpm-nodes/${folder}/engine.json.
import { fromEngine, toEngine, serializeProcess, validateModel } from '../../dist/index.mjs';
import { isMain } from '../functions/io.mjs';

// The documented engine element (engine.json):
export const node = ${JSON.stringify(ej, null, 2)};

// A minimal, valid engine process that exercises it end-to-end:
export function build() {
  return ${JSON.stringify(spec.proc, null, 2)};
}

export function demo() {
  const proc = build();
  const model = fromEngine(proc);                 // engine JSON -> jBPM ProcessModel
  const v = validateModel(model);
  if (!v.ok) throw new Error('invalid model: ' + v.errors.join('; '));
  const bpmn = serializeProcess(model);           // -> BPMN 2.0 XML
  const back = toEngine(model);                   // jBPM -> engine JSON again
  return { model, bpmn, back };
}

if (isMain(import.meta.url)) {
  const { model, back } = demo();
  console.log(${JSON.stringify(spec.title)});
  console.log('  jBPM nodes  :', model.nodes.map((n) => n.id + ':' + n.type + (n.subtype ? '/' + n.subtype : '')).join(', '));
${focusLine}
  console.log('  round-trip  :', back.nodes.length + ' nodes recovered');
}
`;
};

fs.mkdirSync(EX_DIR, { recursive: true });
let n = 0;
const index = [];
for (const [folder, spec] of Object.entries(NODES)) {
  const ej = focusEj(spec);
  const dir = path.join(NODES_DIR, folder);
  if (fs.existsSync(dir)) fs.writeFileSync(path.join(dir, 'engine.json'), JSON.stringify(ej, null, 2) + '\n');
  else console.warn('missing docs folder:', folder);
  fs.writeFileSync(path.join(EX_DIR, folder + '.mjs'), exampleSrc(folder, spec, ej));
  index.push(`- [${spec.title}](${folder}.mjs) — ${spec.story}`);
  n++;
}
fs.writeFileSync(path.join(EX_DIR, 'README.md'), `# Node examples\n\nOne runnable example per BPMN node the SDK models. Each authors the node as nodejs-supported engine\nJSON, converts it to jBPM (\`fromEngine\`), validates + serializes BPMN, and round-trips it back\n(\`toEngine\`). The \`node\` export mirrors the matching \`docs/bpm-nodes/<folder>/engine.json\`.\n\nRun one: \`node examples/nodes/user-task.mjs\`  ·  run all: \`node examples/nodes/run-all.mjs\`\n\n${index.join('\n')}\n`);

// a tiny runner that executes every node example's demo() and reports pass/fail
const runAll = `// Runs every node example's demo() and reports the jBPM node type produced. \`node examples/nodes/run-all.mjs\`
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(here).filter((f) => f.endsWith('.mjs') && f !== 'run-all.mjs').sort();
let ok = 0;
for (const f of files) {
  const mod = await import(pathToFileURL(path.join(here, f)).href);
  const { model } = mod.demo();
  console.log(f.padEnd(34), '->', model.nodes.map((n) => n.type).join(', '));
  ok++;
}
console.log('\\n' + ok + '/' + files.length + ' node examples converted + round-tripped OK');
`;
fs.writeFileSync(path.join(EX_DIR, 'run-all.mjs'), runAll);
console.log('wrote', n, 'engine.json + examples (+ README, run-all)');
