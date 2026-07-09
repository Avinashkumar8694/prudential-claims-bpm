// Inclusive gateway — Takes every branch whose condition is true (plus the default), then joins.
//
// Authors the element in the ENGINE (nodejs) JSON model, converts to jBPM (fromEngine), validates the
// model, serializes BPMN, and round-trips back (toEngine). `node` is exactly
// docs/bpm-nodes/inclusive-gateway/engine.json.
import { fromEngine, toEngine, serializeProcess, validateModel } from '../../dist/index.mjs';
import { isMain } from '../functions/io.mjs';

// The documented engine element (engine.json):
export const node = {
  "id": "_split",
  "name": "Inclusive split",
  "type": "gateway",
  "mode": "inclusive",
  "default": "fDefault"
};

// A minimal, valid engine process that exercises it end-to-end:
export function build() {
  return {
  "id": "com.acme.demo",
  "name": "demo",
  "package": "com.acme",
  "vars": [
    {
      "name": "needsReview",
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
      "id": "_split",
      "name": "Inclusive split",
      "type": "gateway",
      "mode": "inclusive",
      "default": "fDefault"
    },
    {
      "id": "_review",
      "type": "manual",
      "name": "Review"
    },
    {
      "id": "_audit",
      "type": "manual",
      "name": "Audit"
    },
    {
      "id": "_join",
      "name": "Join",
      "type": "gateway",
      "mode": "inclusive"
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
      "to": "_split"
    },
    {
      "id": "fReview",
      "from": "_split",
      "to": "_review",
      "when": "return needsReview != null && needsReview;",
      "lang": "java"
    },
    {
      "id": "fDefault",
      "from": "_split",
      "to": "_audit"
    },
    {
      "from": "_review",
      "to": "_join"
    },
    {
      "from": "_audit",
      "to": "_join"
    },
    {
      "from": "_join",
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
  console.log("Inclusive gateway");
  console.log('  jBPM nodes  :', model.nodes.map((n) => n.id + ':' + n.type + (n.subtype ? '/' + n.subtype : '')).join(', '));
  const f = model.nodes.find((n) => n.id === "_split");
  console.log('  focus node  :', f.id + ' -> ' + f.type + (f.subtype ? '/' + f.subtype : ''));
  console.log('  round-trip  :', back.nodes.length + ' nodes recovered');
}
