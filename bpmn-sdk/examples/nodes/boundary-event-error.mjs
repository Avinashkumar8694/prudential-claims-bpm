// Boundary event (error) — An interrupting error boundary on a call activity — on error, cancels the host and runs the error path.
//
// Authors the element in the ENGINE (nodejs) JSON model, converts to jBPM (fromEngine), validates the
// model, serializes BPMN, and round-trips back (toEngine). `node` is exactly
// docs/bpm-nodes/boundary-event-error/engine.json.
import { fromEngine, toEngine, serializeProcess, validateModel } from '../../dist/index.mjs';
import { isMain } from '../functions/io.mjs';

// The documented engine element (engine.json):
export const node = {
  "id": "_onErr",
  "name": "On call error",
  "type": "boundary",
  "on": "_validate",
  "event": {
    "error": "CALL_ERR"
  },
  "interrupting": true
};

// A minimal, valid engine process that exercises it end-to-end:
export function build() {
  return {
  "id": "com.acme.demo",
  "name": "demo",
  "package": "com.acme",
  "errors": [
    "CALL_ERR"
  ],
  "vars": [
    {
      "name": "caseId",
      "type": "string"
    }
  ],
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "name": "Start"
    },
    {
      "id": "_validate",
      "name": "Validate claim",
      "type": "call",
      "process": "com.acme.validate",
      "inputs": {
        "caseId": "$caseId"
      }
    },
    {
      "id": "_onErr",
      "name": "On call error",
      "type": "boundary",
      "on": "_validate",
      "event": {
        "error": "CALL_ERR"
      },
      "interrupting": true
    },
    {
      "id": "_log",
      "type": "script",
      "lang": "java",
      "code": "System.out.println(\"validation failed\");"
    },
    {
      "id": "end",
      "type": "end",
      "name": "Done"
    },
    {
      "id": "_endErr",
      "type": "end",
      "name": "Aborted",
      "throw": {
        "error": "CALL_ERR"
      }
    }
  ],
  "flows": [
    {
      "from": "start",
      "to": "_validate"
    },
    {
      "from": "_validate",
      "to": "end"
    },
    {
      "from": "_onErr",
      "to": "_log"
    },
    {
      "from": "_log",
      "to": "_endErr"
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
  console.log("Boundary event (error)");
  console.log('  jBPM nodes  :', model.nodes.map((n) => n.id + ':' + n.type + (n.subtype ? '/' + n.subtype : '')).join(', '));
  const f = model.nodes.find((n) => n.id === "_onErr");
  console.log('  focus node  :', f.id + ' -> ' + f.type + (f.subtype ? '/' + f.subtype : ''));
  console.log('  round-trip  :', back.nodes.length + ' nodes recovered');
}
