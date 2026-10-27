# Data Object / Data Store — usage guide

## 1. Details
`<bpmn2:dataObject>` models data that flows within a process; `<bpmn2:dataStoreReference>` points at
a persistent store (`<bpmn2:dataStore>` at definitions scope). Both are visual/data modelling
constructs (not flow nodes).

## 2. Usage
Document what data a step reads/writes; `isCollection` marks list data.

## 3. How / when to use
- Use for documentation/data-flow clarity; jBPM primarily executes on **process variables** (see
  `_process-variables-reference.md`).
- SDK: `process.dataObjects[]` and `process.dataStores[]` (not in `nodes[]`).
