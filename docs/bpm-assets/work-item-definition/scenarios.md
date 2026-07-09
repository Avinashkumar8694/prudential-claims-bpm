# Work-Item Definition — every scenario (engine workItems → `WorkDefinitions.wid`)

A work-item definition registers a **custom service-task type** in the palette: a named task with typed
`parameters` (inputs) and `results` (outputs), e.g. `SendEmail`, `Rest`, `Milestone`. A process node of
that type hands off to a **work-item handler** (Java) registered in the deployment descriptor.

## You usually write nothing — the standard set is automatic
The SDK ships jBPM's **standard work items batteries-included**: `fromEngineProject` **always** emits
their definitions to `global/WorkDefinitions.wid` and registers their handlers in the deployment
descriptor — with **zero declaration**. The auto-included set (`DEFAULT_WORK_ITEMS`, exported):

| name | handler | purpose |
|------|---------|---------|
| `Rest` | `RESTWorkItemHandler` | HTTP/REST calls (what the `http` node uses) |
| `Email` | `EmailWorkItemHandler` | send email |
| `WebService` | `WebServiceWorkItemHandler` | SOAP web service |
| `Log` | `SystemOutWorkItemHandler` | log a message |

So you do **not** author work-item definitions for these. You only declare `workItems` when you need a
**custom** task type beyond the standard set — and even then, see the note below on handlers.

## Two layers — which one to write (custom only)
1. **Engine work items (nodejs-native)** — §0 below. `[{ name, parameters, results, … }]` — plain maps.
   No MVEL. Only needed for **custom** types; they extend/override the defaults by name.
2. **`WorkDefinitions.wid` (jBPM-side)** — [model.md](model.md). The MVEL file the SDK **produces** and
   `parseWid` recovers.

Everything here is tested in [`../../../bpmn-sdk/test/project-assets.test.mjs`](../../../bpmn-sdk/test/project-assets.test.mjs).

---

## 0. Engine work items — the simple form (what you write)
```jsonc
// an EngineProject holds: { "workItems": [ … ], "deployment": { "handlers": [ … ] }, "processes": [ … ] }
{
  "workItems": [{
    "name": "SendEmail",              // the task type (referenced by a task node's TaskName)
    "displayName": "Send Email",      // palette label
    "category": "Communication",
    "parameters": { "to": "String", "subject": "String", "body": "String" },   // inputs (name -> type)
    "results":    { "messageId": "String" }                                    // outputs (name -> type)
  }]
}
```
generates `global/WorkDefinitions.wid` (MVEL):
```mvel
[
    [
        "name" : "SendEmail",
        "displayName" : "Send Email",
        "category" : "Communication",
        "parameters" : [ "to" : new String(), "subject" : new String(), "body" : new String() ],
        "results" : [ "messageId" : new String() ]
    ]
]
```

### Complete field reference
```jsonc
{
  "name":         "SendEmail",     // required. task type name
  "displayName":  "Send Email",    // optional. palette label
  "category":     "Communication", // optional. palette group
  "icon":         "email.png",     // optional
  "defaultHandler": "",            // optional
  "documentation": "…",            // optional
  "parameters":   { "to": "String" },     // inputs: name -> Java type (String/Integer/Object/…)
  "results":      { "messageId": "String" }// outputs: name -> Java type
}
```
`parameters`/`results` are simple `name → Java type` maps; the SDK emits `"name" : new <Type>()`.

### How it's used
- The `.wid` makes the task type **appear in the palette** and declares its I/O contract.
- A process node of that type (a service/work-item task whose `TaskName` = the work-item `name`)
  hands its `parameters` to a **work-item handler** and reads back its `results`.
- The **handler** is registered in the deployment descriptor via `EngineProject.deployment.handlers`
  (e.g. the built-in `Rest`, or a custom class) — see `../../bpm-project/custom-work-item-handlers.md`.

> Not a runtime asset for a Node engine — it's a build-time contract/registration. Your engine either
> implements the task type itself or, for jBPM, relies on the registered handler.

---

The jBPM-side `.wid` is in [model.json](model.json) / [model.md](model.md); the tested example is
`../../../bpmn-sdk/examples/project-assets/`.
