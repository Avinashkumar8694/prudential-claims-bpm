# WorkDefinitions.wid — work-item definitions / modeler palette

## What it is
`global/WorkDefinitions.wid` is an **MVEL-format** list of **Work Item Definitions**. Each entry
describes a *service task type* (a "work item") the process modeler can drop on the canvas: its name,
display name, category, icon, the **parameters** it accepts, the **results** it returns, and a
**defaultHandler** (the Java class that runs it).

jBPM looks for `*.wid` files in two places: the project's top-level `global/` directory (default name
`WorkDefinitions.wid`), and/or `src/main/resources/`.

## What it's for
1. **Modeler palette** — Business Central reads it to show the work item in the palette and to render
   its parameter/result fields on the task's data-mapping form.
2. **Parameter contract** — declares the inputs/outputs so the modeler can map process variables to
   the handler's parameters.
3. **Default handler hint** — `defaultHandler` suggests the handler class (the *runtime* binding is
   the deployment descriptor — see `deployment-descriptor.md`).

> Runtime note: the `.wid` is primarily a **design-time** artifact. At runtime the engine binds a
> work item's `drools:taskName` to a handler via the **deployment descriptor**, not the `.wid`.
> A process can execute without the `.wid`, but you lose palette support and parameter forms.

## Structure (MVEL list of maps)
```mvel
import org.drools.core.process.core.datatype.impl.type.StringDataType;
[
  [
    "name" : "Rest",
    "displayName" : "REST",
    "category" : "Communication",
    "description" : "",
    "defaultHandler" : "mvel: new org.jbpm.process.workitem.rest.RESTWorkItemHandler(classLoader)",
    "documentation" : "jbpm-workitems-rest/index.html",
    "icon" : "defaultresticon.png",
    "parameters" : [
        "Url" : new StringDataType(),
        "Method" : new StringDataType(),
        "ContentData" : new StringDataType()
    ],
    "results" : [
        "Result" : new org.drools.core.process.core.datatype.impl.type.ObjectDataType()
    ]
  ],
  [
    "name" : "MyCustomTask",
    "displayName" : "My Custom Task",
    "category" : "Custom",
    "defaultHandler" : "mvel: new com.acme.MyCustomHandler()",
    "icon" : "defaultservicenodeicon.png",
    "parameters" : [ "input" : new StringDataType() ],
    "results"    : [ "output" : new StringDataType() ]
  ]
]
```
Key fields per entry: `name` (matches the task's `drools:taskName`), `displayName`, `category`,
`icon` (a png in `global/`), `parameters` (map of name → DataType), `results` (map), `defaultHandler`.
Common DataTypes: `StringDataType`, `IntegerDataType`, `FloatDataType`, `BooleanDataType`,
`ObjectDataType`, `ListDataType`, `EnumDataType`.

## In this project
`global/WorkDefinitions.wid` registers the standard jBPM work items used by the modeler:
`BusinessRuleTask`, `DecisionTask`, `Email`, `Log`, `Milestone`, `Rest`, `WebService` (with their
default icons in `global/*.png`).

## How the SDK handles it
Not synthesized from JSON (it's design-time MVEL). It is **round-tripped verbatim** when present —
captured into `descriptor.files["global/WorkDefinitions.wid"]` on parse and re-written on
`writeProject`. To ship a custom `.wid`, put its text there (see `descriptor-and-extra-files.md`).

## Sources
- jBPM Work Items — https://blog.kie.org/2018/04/jbpm-work-items-are-really-simple.html
- Custom WorkItemHandler — https://www.mastertheboss.com/bpm/jbpm6/how-to-create-a-custom-workitem-handler-in-jbpm/
