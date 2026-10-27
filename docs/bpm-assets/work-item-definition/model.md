# Work Item Definition — model (jBPM-side)

> The `.wid` model the SDK **produces** from engine `workItems` ([scenarios.md §0](scenarios.md)).
> Author `workItems: [{ name, parameters, results }]` — this is the generated MVEL form.

```jsonc
{ "kind": "workItemDefinition", "model": { "definitions": [
  { "name": "Rest", "displayName": "REST", "category": "Communication", "icon": "defaultresticon.png",
    "defaultHandler": "mvel: new org.jbpm.process.workitem.rest.RESTWorkItemHandler(classLoader)",
    "parameters": { "Url": "StringDataType", "Method": "StringDataType" },
    "results": { "Result": "ObjectDataType" } } ] } }
```
