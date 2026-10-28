# Start Event (None) — usage guide

## 1. Details
BPMN element: `<bpmn2:startEvent>` with **no** event definition child.
The single entry point of an executable process. Exactly one none-start per top-level
process (jBPM starts the instance here when the process is invoked via the KIE API).

## 2. Usage
When the process instance is created (REST `POST .../processes/{id}/instances`), the token
is placed on the none-start and immediately follows its single outgoing sequence flow.
It performs no work and takes no inputs.

## 3. How / when to use
- Use for a process that is started **on demand** (API call, parent call activity).
- Do **not** use for a process that must be triggered by a signal/message/timer — use the
  matching typed start instead (see `start-event-signal`).
- Always the first node; wire its one `outgoing` to the first real node (usually a
  `script-task` bootstrap that resolves `baseUrl`).
