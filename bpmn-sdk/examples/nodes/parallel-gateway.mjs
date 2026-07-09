// Parallel gateway — Forks into concurrent paths (Diverging) and later joins them (Converging).
//
// Authors the element in the ENGINE (nodejs) JSON model, converts to jBPM (fromEngine), validates the
// model, serializes BPMN, and round-trips back (toEngine). `node` is exactly
// docs/bpm-nodes/parallel-gateway/engine.json.
import { fromEngine, toEngine, serializeProcess, validateModel } from '../../dist/index.mjs';
import { isMain } from '../functions/io.mjs';

// The documented engine element (engine.json):
export const node = {
  "id": "_fork",
  "name": "Fork",
  "type": "gateway",
  "mode": "parallel",
  "direction": "Diverging"
};

// A minimal, valid engine process that exercises it end-to-end:
export function build() {
  return {
  "id": "com.acme.demo",
  "name": "demo",
  "package": "com.acme",
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "name": "Start"
    },
    {
      "id": "_fork",
      "name": "Fork",
      "type": "gateway",
      "mode": "parallel",
      "direction": "Diverging"
    },
    {
      "id": "_a",
      "type": "manual",
      "name": "Task A"
    },
    {
      "id": "_b",
      "type": "manual",
      "name": "Task B"
    },
    {
      "id": "_join",
      "name": "Join",
      "type": "gateway",
      "mode": "parallel",
      "direction": "Converging"
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
      "to": "_fork"
    },
    {
      "from": "_fork",
      "to": "_a"
    },
    {
      "from": "_fork",
      "to": "_b"
    },
    {
      "from": "_a",
      "to": "_join"
    },
    {
      "from": "_b",
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
  console.log("Parallel gateway");
  console.log('  jBPM nodes  :', model.nodes.map((n) => n.id + ':' + n.type + (n.subtype ? '/' + n.subtype : '')).join(', '));
  const f = model.nodes.find((n) => n.id === "_fork");
  console.log('  focus node  :', f.id + ' -> ' + f.type + (f.subtype ? '/' + f.subtype : ''));
  console.log('  round-trip  :', back.nodes.length + ' nodes recovered');
}
