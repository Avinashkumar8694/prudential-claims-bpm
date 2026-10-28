// Exclusive gateway — Takes exactly one branch — the first flow whose condition is true, else the default.
//
// Authors the element in the ENGINE (nodejs) JSON model, converts to jBPM (fromEngine), validates the
// model, serializes BPMN, and round-trips back (toEngine). `node` is exactly
// docs/bpm-nodes/exclusive-gateway/engine.json.
import { fromEngine, toEngine, serializeProcess, validateModel } from '../../dist/index.mjs';
import { isMain } from '../functions/io.mjs';

// The documented engine element (engine.json):
export const node = {
  "id": "_route",
  "name": "Route by type",
  "type": "gateway",
  "mode": "exclusive",
  "default": "fOther"
};

// A minimal, valid engine process that exercises it end-to-end:
export function build() {
  return {
  "id": "com.acme.demo",
  "name": "demo",
  "package": "com.acme",
  "vars": [
    {
      "name": "claimType",
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
      "id": "_route",
      "name": "Route by type",
      "type": "gateway",
      "mode": "exclusive",
      "default": "fOther"
    },
    {
      "id": "_death",
      "type": "manual",
      "name": "Death claim"
    },
    {
      "id": "_other",
      "type": "manual",
      "name": "Other claim"
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
      "to": "_route"
    },
    {
      "id": "fDeath",
      "from": "_route",
      "to": "_death",
      "when": "return \"DEATH\".equals(claimType);",
      "lang": "java"
    },
    {
      "id": "fOther",
      "from": "_route",
      "to": "_other"
    },
    {
      "from": "_death",
      "to": "end"
    },
    {
      "from": "_other",
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
  console.log("Exclusive gateway");
  console.log('  jBPM nodes  :', model.nodes.map((n) => n.id + ':' + n.type + (n.subtype ? '/' + n.subtype : '')).join(', '));
  const f = model.nodes.find((n) => n.id === "_route");
  console.log('  focus node  :', f.id + ' -> ' + f.type + (f.subtype ? '/' + f.subtype : ''));
  console.log('  round-trip  :', back.nodes.length + ' nodes recovered');
}
