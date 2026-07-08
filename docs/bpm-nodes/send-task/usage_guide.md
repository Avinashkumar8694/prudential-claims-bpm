# Send Task — usage guide

## 1. Details
BPMN element: `<bpmn2:sendTask>`. Sends a message. In jBPM implemented as a work item; may reference a
`<bpmn2:message>` (`messageRef`) and an `implementation`.

## 2. Usage
Send Task participates in message exchange with another participant/system.

## 3. How / when to use
- Use `sendTask` to emit a message/event; `receiveTask` to block until one arrives.
- Declare the message once (`declarations.messages`) and reference by `messageRef`.
- SDK type `sendTask` with `messageRef`, `implementation`, optional `operationRef`, `dataInputs/Outputs`.
