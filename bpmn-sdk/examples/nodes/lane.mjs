// Lane — Swimlanes group nodes by the role that performs them.
//
// Authors the element in the ENGINE (nodejs) JSON model, converts to jBPM (fromEngine), validates the
// model, serializes BPMN, and round-trips back (toEngine). `node` is exactly
// docs/bpm-nodes/lane/engine.json.
import { fromEngine, toEngine, serializeProcess, validateModel } from '../../dist/index.mjs';
import { isMain } from '../functions/io.mjs';

// The documented engine element (engine.json):
export const node = {
  "process-level": true,
  "lanes": [
    {
      "name": "System",
      "nodes": [
        "_boot",
        "_route"
      ]
    },
    {
      "name": "Ops",
      "nodes": [
        "_review"
      ]
    }
  ]
};

// A minimal, valid engine process that exercises it end-to-end:
export function build() {
  return {
  "id": "com.acme.demo",
  "name": "demo",
  "package": "com.acme",
  "lanes": [
    {
      "name": "System",
      "nodes": [
        "_boot",
        "_route"
      ]
    },
    {
      "name": "Ops",
      "nodes": [
        "_review"
      ]
    }
  ],
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "name": "Start"
    },
    {
      "id": "_boot",
      "type": "script",
      "lang": "java",
      "code": "kcontext.setVariable(\"ready\", true);"
    },
    {
      "id": "_route",
      "type": "gateway",
      "mode": "exclusive"
    },
    {
      "id": "_review",
      "type": "userTask",
      "name": "Review",
      "group": "Ops"
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
      "to": "_boot"
    },
    {
      "from": "_boot",
      "to": "_route"
    },
    {
      "from": "_route",
      "to": "_review"
    },
    {
      "from": "_review",
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
  console.log("Lane");
  console.log('  jBPM nodes  :', model.nodes.map((n) => n.id + ':' + n.type + (n.subtype ? '/' + n.subtype : '')).join(', '));
  console.log('  lanes       :', back.lanes.map((l) => l.name + '=' + l.nodes.join('+')).join(', '));
  console.log('  round-trip  :', back.nodes.length + ' nodes recovered');
}
