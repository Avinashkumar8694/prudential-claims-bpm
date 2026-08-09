# Importing & Exporting Real jBPM

## Importing a real project (kjar)

`POST /api/import/jbpm` (`workflow:edit`) with `{ files: { "<path>": "<content>", ... }, name }` — a
file map of an actual jBPM/Business Central project (both `.bpmn` and `.bpmn2` extensions are
searched; real Business Central exports commonly use `.bpmn2`). `POST /api/import/jbpm/deploy`
(`workflow:deploy`) does the same and immediately deploys+activates the result — jBPM's own "deploy
this artifact" flow, no manual Publish/Deploy detour.

What gets recovered automatically, matching real jBPM/Business Central authoring conventions:

- **Forms** — a form file named `<FormName>-taskform.form` is matched to a User Task whose (stripped)
  `form` field equals `FormName`.
- **DRL rulesets** — `.rdrl`/`.drl` files. Both eras are handled: newer Business Central XML "Guided
  Rule" format and older plain-text DRL (content-sniffed, not by extension alone).
- **DMN decisions** — a `.dmn` file using `decisionTable` is recovered into a real, evaluable decision.
  A `businessRuleTask` wired to DMN via the real jBPM convention (namespace/model passed as
  `dataInputAssociation` literal values targeting `_namespaceInputX`/`_modelInputX` dataInputs, not
  static XML attributes) is recognized and reconnected.

What is **not** recoverable, and is reported (not silently dropped):

- **DMN `literalExpression`/Business Knowledge Model** decisions — full FEEL with Java-backed
  functions has no evaluator here; only `decisionTable`-driven decisions run. `convertAssets()`
  reports these under `skipped` with the reason.
- **Ad-hoc sub-processes** — no fixed sequence flow, a fundamentally different execution model. Not
  supported; flagged by the `unsupported-construct` validation rule if you try to publish one.
- **Custom Java classpath code** referenced by a script (a class not in the sidecar's compiled
  classpath) — the script still compiles as real Java, but a class it depends on that isn't present
  will fail at runtime, same as it would on a KIE server missing that jar.

`java`-dialect scripts (the default for anything authored in real jBPM/Business Central) run as real,
compiled Java against the sidecar — not transpiled to JavaScript — so behavior matches the original
project.

## Import report

Both import endpoints return `{ workflowId, processes, formsImported, rulesetsImported,
decisionsImported, skipped }` — `skipped` is an array of `{ path, reason }` for anything the importer
recognized but couldn't fully convert. Always check `skipped` after importing a real project; it's the
list of things that need manual attention before you trust the result.

## Exporting back to real jBPM

**Export jBPM** button on a project (or `GET /deployments/:id/export`) produces a real `.bpmn2` kjar
file set — every node type this engine supports round-trips to valid BPMN 2.0 XML runnable on a real
KIE server, including this engine's own additive JS sugar (`instance`/`node` globals — see
[Script task](nodes/script.md)), which is exported with a preamble computing the same shape from real
`kcontext`, so the exported script still runs unmodified on real jBPM.

## Round-tripping a DMN decision

A decision imported from a real `decisionTable`-driven `.dmn` file, then re-exported, produces
byte-identical XML for that decision — this was verified directly (see `bpmn-sdk/test/dmn.test.mjs`),
not just "looks the same."
