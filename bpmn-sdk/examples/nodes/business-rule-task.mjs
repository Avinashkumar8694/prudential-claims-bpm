// Business rule task — Fires a DRL ruleflow-group to classify the claim. (Swap `ruleflowGroup` for `dmn:{...}` to evaluate a DMN decision instead.)
//
// Authors the element in the ENGINE (nodejs) JSON model, converts to jBPM (fromEngine), validates the
// model, serializes BPMN, and round-trips back (toEngine). `node` is exactly
// docs/bpm-nodes/business-rule-task/engine.json.
import { fromEngine, toEngine, serializeProcess, validateModel } from '../../dist/index.mjs';
import { isMain } from '../functions/io.mjs';

// The documented engine element (engine.json):
export const node = {
  "id": "_classify",
  "name": "Classify claim",
  "type": "rule",
  "ruleflowGroup": "classify"
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
    },
    {
      "name": "tier",
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
      "id": "_classify",
      "name": "Classify claim",
      "type": "rule",
      "ruleflowGroup": "classify"
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
      "to": "_classify"
    },
    {
      "from": "_classify",
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
  console.log("Business rule task");
  console.log('  jBPM nodes  :', model.nodes.map((n) => n.id + ':' + n.type + (n.subtype ? '/' + n.subtype : '')).join(', '));
  const f = model.nodes.find((n) => n.id === "_classify");
  console.log('  focus node  :', f.id + ' -> ' + f.type + (f.subtype ? '/' + f.subtype : ''));
  console.log('  round-trip  :', back.nodes.length + ' nodes recovered');
}
