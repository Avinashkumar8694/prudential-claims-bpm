// Call activity (multi-instance) — Runs a child process once per item in a collection (parallel), collecting each result.
//
// Authors the element in the ENGINE (nodejs) JSON model, converts to jBPM (fromEngine), validates the
// model, serializes BPMN, and round-trips back (toEngine). `node` is exactly
// docs/bpm-nodes/call-activity-multi-instance/engine.json.
import { fromEngine, toEngine, serializeProcess, validateModel } from '../../dist/index.mjs';
import { isMain } from '../functions/io.mjs';

// The documented engine element (engine.json):
export const node = {
  "id": "_perPolicy",
  "name": "Assess each policy",
  "type": "forEach",
  "process": "com.acme.assess",
  "over": "applicablePolicies",
  "as": "currentPolicy",
  "collectInto": "claimResults",
  "itemResult": "claimResult",
  "parallel": true,
  "pass": [
    "caseId",
    "claimId"
  ]
};

// A minimal, valid engine process that exercises it end-to-end:
export function build() {
  return {
  "id": "com.acme.demo",
  "name": "demo",
  "package": "com.acme",
  "vars": [
    {
      "name": "caseId",
      "type": "string"
    },
    {
      "name": "claimId",
      "type": "string"
    },
    {
      "name": "applicablePolicies",
      "type": "list"
    },
    {
      "name": "claimResults",
      "type": "list"
    }
  ],
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "name": "Start"
    },
    {
      "id": "_perPolicy",
      "name": "Assess each policy",
      "type": "forEach",
      "process": "com.acme.assess",
      "over": "applicablePolicies",
      "as": "currentPolicy",
      "collectInto": "claimResults",
      "itemResult": "claimResult",
      "parallel": true,
      "pass": [
        "caseId",
        "claimId"
      ]
    },
    {
      "id": "end",
      "type": "end",
      "name": "End"
    }
  ],
  "flows": [
    {
      "from": "start",
      "to": "_perPolicy"
    },
    {
      "from": "_perPolicy",
      "to": "end"
    }
  ]
};
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
  console.log("Call activity (multi-instance)");
  console.log('  jBPM nodes  :', model.nodes.map((n) => n.id + ':' + n.type + (n.subtype ? '/' + n.subtype : '')).join(', '));
  const f = model.nodes.find((n) => n.id === "_perPolicy");
  console.log('  focus node  :', f.id + ' -> ' + f.type + (f.subtype ? '/' + f.subtype : ''));
  console.log('  round-trip  :', back.nodes.length + ' nodes recovered');
}
