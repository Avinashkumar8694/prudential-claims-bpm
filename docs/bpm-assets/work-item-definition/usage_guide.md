# Work Item Definition — usage guide

## 1. Details
Extension `.wid`, SDK asset `kind: "workItemDefinition"` (also modelled as `descriptor.workDefinitions`).
Defines a service-task palette entry + parameter contract.

## 2. Usage
Provides the modeler palette + parameter forms for a service task (`drools:taskName`).

## 3. How / when to use
- `parseAsset("WorkDefinitions.wid", text)` → `{ definitions: WorkItemDefinition[] }`.
- Generate from JSON; `buildAsset` writes the MVEL `.wid`. See ../bpm-nodes/work-definitions-wid.md.
