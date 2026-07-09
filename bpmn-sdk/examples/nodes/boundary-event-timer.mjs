// Boundary event (timer) — A non-interrupting timer boundary on a user task — fires a reminder after 30 days while the task stays open.
//
// Authors the element in the ENGINE (nodejs) JSON model, converts to jBPM (fromEngine), validates the
// model, serializes BPMN, and round-trips back (toEngine). `node` is exactly
// docs/bpm-nodes/boundary-event-timer/engine.json.
import { fromEngine, toEngine, serializeProcess, validateModel } from '../../dist/index.mjs';
import { isMain } from '../functions/io.mjs';

// The documented engine element (engine.json):
export const node = {
  "id": "_reminder",
  "name": "Reminder after 30 days",
  "type": "boundary",
  "on": "_review",
  "event": {
    "timer": {
      "duration": "P30D"
    }
  },
  "interrupting": false
};

// A minimal, valid engine process that exercises it end-to-end:
export function build() {
  return {
  "id": "com.acme.demo",
  "name": "demo",
  "package": "com.acme",
  "messages": [
    "Reminder"
  ],
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "name": "Start"
    },
    {
      "id": "_review",
      "name": "Review claim",
      "type": "userTask",
      "group": "Verifier"
    },
    {
      "id": "_reminder",
      "name": "Reminder after 30 days",
      "type": "boundary",
      "on": "_review",
      "event": {
        "timer": {
          "duration": "P30D"
        }
      },
      "interrupting": false
    },
    {
      "id": "_notify",
      "type": "send",
      "name": "Send reminder",
      "message": "Reminder"
    },
    {
      "id": "end",
      "type": "end",
      "name": "Done"
    }
  ],
  "flows": [
    {
      "from": "start",
      "to": "_review"
    },
    {
      "from": "_review",
      "to": "end"
    },
    {
      "from": "_reminder",
      "to": "_notify"
    },
    {
      "from": "_notify",
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
  console.log("Boundary event (timer)");
  console.log('  jBPM nodes  :', model.nodes.map((n) => n.id + ':' + n.type + (n.subtype ? '/' + n.subtype : '')).join(', '));
  const f = model.nodes.find((n) => n.id === "_reminder");
  console.log('  focus node  :', f.id + ' -> ' + f.type + (f.subtype ? '/' + f.subtype : ''));
  console.log('  round-trip  :', back.nodes.length + ' nodes recovered');
}
