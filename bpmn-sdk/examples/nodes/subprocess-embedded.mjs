// Embedded sub-process — An inline sub-process with its own start/script/end — shares the parent variables.
//
// Authors the element in the ENGINE (nodejs) JSON model, converts to jBPM (fromEngine), validates the
// model, serializes BPMN, and round-trips back (toEngine). `node` is exactly
// docs/bpm-nodes/subprocess-embedded/engine.json.
import { fromEngine, toEngine, serializeProcess, validateModel } from '../../dist/index.mjs';
import { isMain } from '../functions/io.mjs';

// The documented engine element (engine.json):
export const node = {
  "id": "_sub",
  "name": "Validate & enrich",
  "type": "subprocess",
  "nodes": [
    {
      "id": "s_s",
      "type": "start"
    },
    {
      "id": "s_check",
      "type": "script",
      "lang": "java",
      "code": "kcontext.setVariable(\"valid\", true);"
    },
    {
      "id": "s_e",
      "type": "end"
    }
  ],
  "flows": [
    {
      "from": "s_s",
      "to": "s_check"
    },
    {
      "from": "s_check",
      "to": "s_e"
    }
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
      "name": "valid",
      "type": "bool"
    }
  ],
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "name": "Start"
    },
    {
      "id": "_sub",
      "name": "Validate & enrich",
      "type": "subprocess",
      "nodes": [
        {
          "id": "s_s",
          "type": "start"
        },
        {
          "id": "s_check",
          "type": "script",
          "lang": "java",
          "code": "kcontext.setVariable(\"valid\", true);"
        },
        {
          "id": "s_e",
          "type": "end"
        }
      ],
      "flows": [
        {
          "from": "s_s",
          "to": "s_check"
        },
        {
          "from": "s_check",
          "to": "s_e"
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
      "to": "_sub"
    },
    {
      "from": "_sub",
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
  console.log("Embedded sub-process");
  console.log('  jBPM nodes  :', model.nodes.map((n) => n.id + ':' + n.type + (n.subtype ? '/' + n.subtype : '')).join(', '));
  const f = model.nodes.find((n) => n.id === "_sub");
  console.log('  focus node  :', f.id + ' -> ' + f.type + (f.subtype ? '/' + f.subtype : ''));
  console.log('  round-trip  :', back.nodes.length + ' nodes recovered');
}
