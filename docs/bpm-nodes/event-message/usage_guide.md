# Message Event — usage guide

## 1. Details
`<bpmn2:messageEventDefinition messageRef="…">` inside a start / intermediate-catch /
intermediate-throw / end / boundary event. Point-to-point (one sender → one receiver).

## 2. Usage
- Message **start**: begin a process when a message arrives.
- Message **catch** (intermediate/boundary): wait for a message.
- Message **throw** (intermediate/end): send a message.

## 3. How / when to use
- Declare `<bpmn2:message>` once; reference via `messageRef`.
- SDK: any event node with `eventType: "message"` + `messageRef`.
