// Data object — Process-scoped typed variables (data objects) — including a collection.
//
// Authors the element in the ENGINE (nodejs) JSON model, converts to jBPM (fromEngine), validates the
// model, serializes BPMN, and round-trips back (toEngine). `node` is exactly
// docs/bpm-nodes/data-object/engine.json.
import { fromEngine, toEngine, serializeProcess, validateModel } from '../../dist/index.mjs';
import { isMain } from '../functions/io.mjs';

// The documented engine element (engine.json):
export const node = {
  "process-level": true,
  "data": [
    {
      "name": "Document",
      "type": "object",
      "collection": false
    },
    {
      "name": "ClaimAmount",
      "type": "double"
    },
    {
      "name": "AttachmentIds",
      "type": "string",
      "collection": true
    }
  ]
};

// A minimal, valid engine process that exercises it end-to-end:
export function build() {
  return {
  "id": "com.acme.demo",
  "name": "demo",
  "package": "com.acme",
  "data": [
    {
      "name": "Document",
      "type": "object",
      "collection": false
    },
    {
      "name": "ClaimAmount",
      "type": "double"
    },
    {
      "name": "AttachmentIds",
      "type": "string",
      "collection": true
    }
  ],
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "name": "Start"
    },
    {
      "id": "_use",
      "type": "script",
      "lang": "java",
      "code": "kcontext.setVariable(\"ClaimAmount\", 1000.0);"
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
      "to": "_use"
    },
    {
      "from": "_use",
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
  console.log("Data object");
  console.log('  jBPM nodes  :', model.nodes.map((n) => n.id + ':' + n.type + (n.subtype ? '/' + n.subtype : '')).join(', '));
  console.log('  data objects:', back.data.map((d) => d.name + ':' + d.type + (d.collection ? '[]' : '')).join(', '));
  console.log('  round-trip  :', back.nodes.length + ' nodes recovered');
}
