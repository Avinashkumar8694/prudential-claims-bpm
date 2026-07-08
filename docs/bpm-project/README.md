# BPM Project (kjar) Reference

A jBPM process is deployed as a **kjar** (Knowledge JAR) — a Maven artifact that bundles the `.bpmn`
processes with the project metadata the KIE engine and Business Central need. This folder documents
everything **around** the `.bpmn` files (which are covered in `../bpm-nodes/`).

## Anatomy of a kjar
```
<project>/
├── pom.xml                                   # kjar packaging, GAV, kie-maven-plugin  → kjar-scaffolding.md
├── project.imports / project.repositories    # Business Central metadata             → kjar-scaffolding.md
├── global/
│   └── WorkDefinitions.wid                    # modeler palette / work-item defs      → work-definitions-wid.md
└── src/main/resources/
    ├── META-INF/
    │   ├── kmodule.xml                         # kbase/ksession config                → kjar-scaffolding.md
    │   ├── kie-deployment-descriptor.xml        # work-item handlers + env entries    → deployment-descriptor.md
    │   └── persistence.xml                      # JPA persistence (optional)          → kjar-scaffolding.md
    ├── org/jbpm/*.bpmn                          # the processes                        → ../bpm-nodes/
    ├── *.drl / *.dmn                            # rules / decisions                    → rules-drl-and-dmn.md
    └── <java classes / forms>                   # custom handlers, task forms         → custom-work-item-handlers.md
```

## Documents
| File | Covers |
|------|--------|
| `kjar-scaffolding.md` | pom.xml (kjar + kie-maven-plugin), kmodule.xml, persistence.xml, project.imports/repositories |
| `deployment-descriptor.md` | `kie-deployment-descriptor.xml` — **work-item handlers** (`Rest`, custom) + **environment entries** (`INTEGRATION_LAYER_URL`) + persistence/runtime strategy |
| `work-definitions-wid.md` | `global/WorkDefinitions.wid` — the modeler palette & work-item parameter definitions |
| `rules-drl-and-dmn.md` | `.drl` / `.dmn` files and how a **businessRuleTask** references them (ruleFlowGroup / DMN) |
| `custom-work-item-handlers.md` | writing a **Java** `WorkItemHandler` and wiring a custom **service task** (`drools:taskName`) |
| `asset-types.md` | **every** Business Central asset type (Business Process, DRL, DMN, DSL, guided rules/tables, score cards, test scenarios, solver, forms, data objects, …) and how the SDK handles each |
| `structured-assets.md` | **structured JSON codecs** (`parseAsset`/`buildAsset`) so your engine can generate/edit each asset type (generic XML tree for DMN/guided/scorecard/tests/solver; typed models for DRL/Java/properties/enumeration/DSL/wid/forms) and serialize back |
| `descriptor-and-extra-files.md` | how the SDK's `descriptor` (gav + deployment + verbatim `files`) generates/round-trips all of the above |

## What the SDK generates vs. what you supply
| Artifact | SDK from JSON? | Notes |
|----------|:--------------:|-------|
| `.bpmn` processes | ✅ | from `ProcessModel[]` |
| `pom.xml`, `kmodule.xml`, deployment descriptor | ✅ | from `descriptor.gav` + `descriptor.deployment` |
| `project.imports`, `project.repositories` | ✅ | default templates generated when absent; verbatim when present |
| `WorkDefinitions.wid` | ✅ / ⚠️ | generated from `descriptor.workDefinitions`, else verbatim |
| `.drl` / `.dmn` / Java classes / forms | ❌ (verbatim only) | supply via `descriptor.files` or add to the project; the engine compiles them |

Read `descriptor-and-extra-files.md` for how to include the verbatim ones.
