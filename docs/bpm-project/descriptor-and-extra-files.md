# SDK project descriptor & extra files

How the `@fabrixly/bpmn-sdk` generates/round-trips the whole kjar, and how to include artifacts it
does not synthesize from JSON (`.wid`, `.drl`/`.dmn`, Java classes, forms).

## The `descriptor` on a Project
```jsonc
{
  "root": "out",
  "descriptor": {
    "gav": { "groupId": "com.acme", "artifactId": "my-claims-bpm",
             "version": "1.0.0-SNAPSHOT", "name": "My Claims BPM", "kieVersion": "7.73.0.Final" },
    "deployment": {
      "runtimeStrategy": "SINGLETON",
      "workItemHandlers": [
        { "name": "Rest", "resolver": "mvel",
          "identifier": "new org.jbpm.process.workitem.rest.RESTWorkItemHandler(classLoader)" }
      ],
      "environmentEntries": [
        { "name": "INTEGRATION_LAYER_URL", "resolver": "mvel", "identifier": "\"http://localhost:3000\"" }
      ]
    },
    "files": {
      "global/WorkDefinitions.wid": "<MVEL text …>",
      "src/main/resources/com/acme/rules/validate.drl": "<DRL text …>",
      "src/main/java/com/acme/MyCustomHandler.java": "<Java text …>",
      "project.imports": "<xml …>"
    }
  },
  "processes": [ /* ProcessModel[] */ ]
}
```

## What `writeProject` does with it
1. Writes every process `.bpmn` (from `processes`).
2. Generates `pom.xml` from `descriptor.gav` (or writes the verbatim one if in `files`).
3. Writes `META-INF/kmodule.xml` (empty template, or verbatim from `files`).
4. Regenerates `META-INF/kie-deployment-descriptor.xml` from `descriptor.deployment`.
5. Writes **every entry in `descriptor.files` verbatim** at its relative path.

So anything the SDK can't synthesize is carried through `files` unchanged.

## What to put in `descriptor.files` (verbatim passthrough)
| Artifact | Path (example) | Why it's verbatim |
|----------|----------------|-------------------|
| Work item defs | `global/WorkDefinitions.wid` | MVEL palette definition — design-time asset |
| DRL rules | `src/main/resources/<pkg>/rules.drl` | authored rule logic, compiled by kie-maven-plugin |
| DMN decisions | `src/main/resources/<pkg>/model.dmn` | authored decision model |
| Java handlers/classes | `src/main/java/<pkg>/Handler.java` | compiled source (or ship a dependency jar) |
| Task forms | `src/main/resources/<name>.frm` | Business Central form definitions |
| BC metadata | `project.imports`, `project.repositories`, `persistence.xml` | workbench/JPA config |
| Icons | `global/*.png` | palette icons referenced by the `.wid` |

`parseProject` **auto-captures** the scaffolding (`pom.xml`, `kmodule.xml`, `WorkDefinitions.wid`,
`project.imports`, `project.repositories`, `persistence.xml`) **and all text assets** anywhere in the
project — `.drl`, `.dmn`, `.java`, `.frm`, `.wid`, `.gdst`, `.properties` — into `files` (excluding
`node_modules`/`target`/`dist`/`.git`). So rules, decisions, Java handlers, and forms round-trip
automatically; you only add files by hand when authoring from scratch. (Binary icons `*.png` are not
captured as text — copy them separately.)

## Work-item definitions as a model (`descriptor.workDefinitions`)
The `.wid` is also parsed into a semantic model and can be generated from one:
```jsonc
"workDefinitions": [
  { "name": "MyTask", "displayName": "My Task", "category": "Custom",
    "defaultHandler": "mvel: new com.acme.MyHandler()",
    "parameters": { "input": "StringDataType" }, "results": { "output": "StringDataType" } }
]
```
- `parseProject` fills `workDefinitions` from an existing `.wid` (best-effort).
- `writeProject` prefers a verbatim `.wid` in `files`; if none, it **generates** `global/WorkDefinitions.wid`
  from `workDefinitions`. Helpers `parseWid(text)` / `widMvel(defs)` are exported for direct use.

## Round-trip vs. from-scratch
- **Round-trip** an existing project: `parseProject(dir)` fills `descriptor` (gav + deployment +
  captured `files`); `writeProject(project, out)` reproduces a complete, buildable kjar.
- **From scratch**: supply `descriptor.gav` + `descriptor.deployment` (+ any `files`) and
  `processes`; `writeProject` emits pom + kmodule + deployment descriptor + `.bpmn`. Add `.wid`/
  rules/Java via `files`.

## What still needs a real build/deploy step
The SDK produces **source artifacts**. Turning them into a running deployment still needs:
- `mvn clean install` (the `kie-maven-plugin` compiles `.bpmn`/`.drl`/`.dmn`/Java into the kjar),
- deploying the resulting kjar's GAV as a container on the KIE server (Business Central or KIE Server
  REST API).
The SDK does not run Maven or deploy — it prepares a correct, complete project for those steps.

## Related
`work-definitions-wid.md` · `rules-drl-and-dmn.md` · `custom-work-item-handlers.md` ·
`deployment-descriptor.md` · `kjar-scaffolding.md` · SDK: `../../bpmn-sdk/README.md`, `COVERAGE.md`.
