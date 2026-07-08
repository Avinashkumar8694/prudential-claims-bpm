# Manual Task — usage guide

## 1. Details
BPMN element: `<bpmn2:manualTask>`. Represents work done **outside** the engine (no automation, no
form). The engine records it and moves on / waits per configuration.

## 2. Usage
Documentation of an offline human step (e.g. "file physical form"). No work-item handler.

## 3. How / when to use
- Use to model a real-world manual step you want visible in the process but not system-managed.
- SDK type `manualTask` — just `id`, `name`, `incoming`, `outgoing`.
