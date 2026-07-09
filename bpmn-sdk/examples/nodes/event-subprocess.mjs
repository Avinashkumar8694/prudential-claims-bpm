// Event sub-process — An error-triggered event sub-process — runs cleanup whenever the given error is thrown anywhere in the parent. Not connected by sequence flow.
//
// Authors the element in the ENGINE (nodejs) JSON model, converts to jBPM (fromEngine), validates the
// model, serializes BPMN, and round-trips back (toEngine). `node` is exactly
// docs/bpm-nodes/event-subprocess/engine.json.
import { fromEngine, toEngine, serializeProcess, validateModel } from '../../dist/index.mjs';
import { isMain } from '../functions/io.mjs';

// The documented engine element (engine.json):
export const node = {
  "id": "_handler",
  "name": "On terminate",
  "type": "subprocess",
  "on": {
    "error": "TERMINATE_CASE"
  },
  "nodes": [
    {
      "id": "h_s",
      "type": "start"
    },
    {
      "id": "h_log",
      "type": "script",
      "lang": "java",
      "code": "System.out.println(\"cleanup\");"
    },
    {
      "id": "h_e",
      "type": "end"
    }
  ],
  "flows": [
    {
      "from": "h_s",
      "to": "h_log"
    },
    {
      "from": "h_log",
      "to": "h_e"
    }
  ]
};

// A minimal, valid engine process that exercises it end-to-end:
export function build() {
  return {
  "id": "com.acme.demo",
  "name": "demo",
  "package": "com.acme",
  "errors": [
    "TERMINATE_CASE"
  ],
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "name": "Start"
    },
    {
      "id": "_work",
      "type": "manual",
      "name": "Do work"
    },
    {
      "id": "_handler",
      "name": "On terminate",
      "type": "subprocess",
      "on": {
        "error": "TERMINATE_CASE"
      },
      "nodes": [
        {
          "id": "h_s",
          "type": "start"
        },
        {
          "id": "h_log",
          "type": "script",
          "lang": "java",
          "code": "System.out.println(\"cleanup\");"
        },
        {
          "id": "h_e",
          "type": "end"
        }
      ],
      "flows": [
        {
          "from": "h_s",
          "to": "h_log"
        },
        {
          "from": "h_log",
          "to": "h_e"
        }
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
      "to": "_work"
    },
    {
      "from": "_work",
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
  console.log("Event sub-process");
  console.log('  jBPM nodes  :', model.nodes.map((n) => n.id + ':' + n.type + (n.subtype ? '/' + n.subtype : '')).join(', '));
  const f = model.nodes.find((n) => n.id === "_handler");
  console.log('  focus node  :', f.id + ' -> ' + f.type + (f.subtype ? '/' + f.subtype : ''));
  console.log('  round-trip  :', back.nodes.length + ' nodes recovered');
}
