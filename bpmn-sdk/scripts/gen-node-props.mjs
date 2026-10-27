// Generate docs/bpm-nodes/<node>/node_properties.md for every node folder: a full JSON Schema for the
// engine node (capability + usage) + the folder's engine.json example. Reads each folder's engine.json
// as the source of truth for its type. Run: node scripts/gen-node-props.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NODES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'bpm-nodes');
const LANGS = { enum: ['js', 'java', 'mvel'], description: 'script/expression dialect' };
const TIMER = { type: ['object', 'string'], description: 'ISO-8601 duration/date or a cycle', properties: { duration: { type: 'string' }, cycle: { type: 'string' }, date: { type: 'string' } } };
const EVENT = {
  type: 'object', description: 'exactly one trigger kind',
  properties: { signal: { type: 'string' }, message: { type: 'string' }, error: { type: 'string' }, escalation: { type: 'string' }, condition: { type: 'string' }, lang: LANGS, timer: TIMER },
};
const base = { id: { type: 'string', description: 'optional; autowired from flows if omitted' }, name: { type: 'string' } };
const S = (type, props, required, cap) => ({ schema: { $schema: 'http://json-schema.org/draft-07/schema#', title: 'Engine' + type[0].toUpperCase() + type.slice(1), type: 'object', additionalProperties: false, properties: { ...base, type: { const: type }, ...props }, required: ['type', ...(required || [])] }, cap });

const SCHEMAS = {
  start: S('start', { on: { ...EVENT, description: 'optional trigger; omit for a plain (none) start' } }, [], 'Begins a process instance. Omit `on` for a none-start; set `on.signal/message/timer/condition` for a triggered start.'),
  end: S('end', { result: { const: 'terminate', description: 'terminate the whole instance' }, throw: { ...EVENT, description: 'throw signal/error/escalation/message on end' } }, [], 'Ends a path. `result:"terminate"` kills the whole instance; `throw` raises a signal/error/escalation/message.'),
  script: S('script', { lang: { ...LANGS, default: 'java' }, code: { type: 'string' } }, ['code'], 'Runs inline code (`kcontext` API). `lang` js|java|mvel.'),
  http: S('http', { method: { enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'], default: 'POST' }, url: { type: 'string', description: 'appended to #{baseUrl}' }, headers: { type: 'object', additionalProperties: { type: 'string' } }, body: { type: 'object', description: 'constants or "$var" refs -> request payload' }, resultTo: { type: 'object', additionalProperties: { type: 'string' }, description: 'JSONPath-ish -> process var' } }, ['url'], 'A REST call (via the pru-rest-executor). SDK builds reqPayload / parses resPayload.'),
  call: S('call', { process: { type: 'string', description: 'called process id' }, inputs: { type: 'object' }, outputs: { type: 'object' } }, ['process'], 'Calls a reusable sub-process; maps inputs/outputs to process variables.'),
  forEach: S('forEach', { process: { type: 'string' }, over: { type: 'string', description: 'collection variable to iterate' }, as: { type: 'string', description: 'per-item variable' }, collectInto: { type: 'string' }, itemResult: { type: 'string' }, parallel: { type: 'boolean', description: 'true = parallel MI, false = sequential' }, pass: { type: 'array', items: { type: 'string' } } }, ['process', 'over'], 'Multi-instance call activity: runs the child once per item in `over`.'),
  userTask: S('userTask', { name: { type: 'string' }, group: { type: 'string', description: 'owning role/queue' }, assignee: { type: 'string', description: 'specific user (alt to group)' }, form: { type: 'string', description: 'form name (TaskName)' }, skippable: { type: 'boolean', default: true } }, [], 'Human task; assigned to a group or user, optionally bound to a form.'),
  rule: S('rule', { ruleflowGroup: { type: 'string', description: 'fires a DRL ruleflow-group' }, dmn: { type: 'object', properties: { namespace: { type: 'string' }, model: { type: 'string' }, decision: { type: 'string' } }, required: ['namespace', 'model', 'decision'], description: 'evaluate a DMN decision instead' } }, [], 'Business rule task: fires a DRL ruleflow-group OR evaluates a DMN decision.'),
  send: S('send', { message: { type: 'string' }, implementation: { type: 'string' } }, ['message'], 'Sends a message.'),
  receive: S('receive', { message: { type: 'string' }, implementation: { type: 'string' } }, ['message'], 'Waits for a message.'),
  manual: S('manual', { name: { type: 'string' } }, [], 'A manual (offline) task — no engine work item.'),
  gateway: S('gateway', { mode: { enum: ['exclusive', 'parallel', 'inclusive', 'event', 'complex'] }, default: { type: 'string', description: 'flow id taken when no condition matches (exclusive/inclusive)' }, direction: { enum: ['Diverging', 'Converging'] } }, ['mode'], 'Branch/merge. exclusive=one path, parallel=all, inclusive=all-matching, event=wait-for-event, complex=custom.'),
  catch: S('catch', { event: { ...EVENT, description: 'the event to wait for' } }, ['event'], 'Intermediate catch — waits for a timer/message/signal/conditional event.'),
  throw: S('throw', { event: { ...EVENT, description: 'the event to raise' } }, ['event'], 'Intermediate throw — raises a signal/message/escalation.'),
  boundary: S('boundary', { on: { type: 'string', description: 'host node id the event attaches to' }, event: EVENT, interrupting: { type: 'boolean', default: true } }, ['on', 'event'], 'Boundary event on a task/subprocess (error/timer/message/signal/conditional/escalation). Interrupting cancels the host.'),
  subprocess: S('subprocess', { transaction: { type: 'boolean' }, on: { type: 'object', properties: { error: { type: 'string' } }, description: 'error -> event sub-process' }, nodes: { type: 'array', description: 'child EngineNode[]' }, flows: { type: 'array', description: 'child EngineFlow[]' } }, ['nodes', 'flows'], 'Embedded/transaction/event sub-process containing its own nodes + flows.'),
};
// process-level + flow (not EngineNode)
const DATA = { schema: { $schema: 'http://json-schema.org/draft-07/schema#', title: 'EngineData (EngineProcess.data[])', type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' }, type: { type: 'string', description: 'primitive or a declared type name' }, collection: { type: 'boolean' } }, required: ['name'] }, cap: 'A process data object (typed scratch variable). Lives on EngineProcess.data[].' };
const LANE = { schema: { $schema: 'http://json-schema.org/draft-07/schema#', title: 'EngineLane (EngineProcess.lanes[])', type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' }, nodes: { type: 'array', items: { type: 'string' }, description: 'node ids in this lane' } }, required: ['name', 'nodes'] }, cap: 'A swimlane grouping nodes by role. Lives on EngineProcess.lanes[].' };
const FLOW = { schema: { $schema: 'http://json-schema.org/draft-07/schema#', title: 'EngineFlow (EngineProcess.flows[])', type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, when: { type: 'string', description: 'condition expression (on a gateway branch)' }, lang: LANGS }, required: ['from', 'to'] }, cap: 'A sequence flow connecting two nodes; `when`+`lang` make it a conditional (gateway) branch.' };

const title = (folder) => folder.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

let count = 0;
for (const folder of fs.readdirSync(NODES_DIR)) {
  const dir = path.join(NODES_DIR, folder);
  if (!fs.statSync(dir).isDirectory()) continue;
  const ejPath = path.join(dir, 'engine.json');
  if (!fs.existsSync(ejPath)) continue;
  const ej = JSON.parse(fs.readFileSync(ejPath, 'utf8'));
  let spec, kind;
  if (ej['process-level'] && ej.data) { spec = DATA; kind = 'data object'; }
  else if (ej['process-level'] && ej.lanes) { spec = LANE; kind = 'lane'; }
  else if (ej.from && ej.to && !ej.type) { spec = FLOW; kind = 'sequence flow'; }
  else { spec = SCHEMAS[ej.type]; kind = 'engine node `type: "' + ej.type + '"`'; }
  if (!spec) { console.warn('no schema for', folder, ej.type); continue; }
  const md = `# ${title(folder)} — properties

**${kind}** — ${spec.cap}

## JSON schema (what you author)
\`\`\`json
${JSON.stringify(spec.schema, null, 2)}
\`\`\`

## Example
\`\`\`json
${JSON.stringify(ej, null, 2)}
\`\`\`

> This is the **engine (nodejs) model** you author. \`fromEngine\` converts it to the jBPM node (see
> \`node.json\` for the produced jBPM model), \`serializeProcess\` emits BPMN, and \`toEngine\` recovers it.
> Every node type round-trips — see \`../../../bpmn-sdk/test/engine-nodes.test.mjs\`.
`;
  fs.writeFileSync(path.join(dir, 'node_properties.md'), md);
  count++;
}
console.log('generated node_properties.md for', count, 'folders');
