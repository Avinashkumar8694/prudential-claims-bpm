# Work Item Definition — usage guide

**Author** engine `workItems: [{ name, parameters, results, … }]` on your `EngineProject`
([scenarios.md §0](scenarios.md)); `fromEngineProject` emits `global/WorkDefinitions.wid`. The jBPM-side
codec below (`parseWid`/`widMvel`) is for reading/writing the raw `.wid`.

## 1. Details
Extension `.wid`, SDK asset `kind: "workItemDefinition"` (also modelled as `descriptor.workDefinitions`).
Defines a service-task palette entry + parameter contract.

## 2. Usage
Provides the modeler palette + parameter forms for a service task (`drools:taskName`).

## 3. How / when to use
- `parseAsset("WorkDefinitions.wid", text)` → `{ definitions: WorkItemDefinition[] }`.
- Generate from JSON; `buildAsset` writes the MVEL `.wid`. See ../bpm-nodes/work-definitions-wid.md.
