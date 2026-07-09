# DSL — every scenario (engine dsl → jBPM `.dsl`)

A DSL (Domain Specific Language) file maps **natural-language phrases** to DRL fragments, so guided
rules can be written in business language: `"a high value claim"` instead of
`Claim( amount > 100000 )`. Each entry says: in a `when` or `then`, this phrase **expands to** this DRL.

## Two layers — which one to write
1. **Engine dsl (nodejs-native)** — §0 below. `[{ scope, nl, mapping }]`. **This is what you author.**
2. **`.dsl` text (jBPM-side)** — [model.md](model.md). The `[scope]phrase=mapping` lines the SDK
   **produces** and `parseDsl` recovers.

Everything here is tested in [`../../../bpmn-sdk/test/project-assets.test.mjs`](../../../bpmn-sdk/test/project-assets.test.mjs).

---

## 0. Engine dsl — the simple form (what you write)
```jsonc
// an EngineProject holds: { "dsl": [ … ], "processes": [ … ] }
{
  "dsl": [
    { "scope": "when", "nl": "a high value claim",  "mapping": "Claim( amount > 100000 )" },
    { "scope": "then", "nl": "flag it as {level}",  "mapping": "flag($c, \"{level}\");" }
  ]
}
```
generates `src/main/resources/dsl/definitions.dsl`:
```dsl
[when]a high value claim=Claim( amount > 100000 )
[then]flag it as {level}=flag($c, "{level}");
```

### Complete field reference
| Field | Meaning |
|-------|---------|
| `scope` | where the phrase applies: `when` (LHS), `then` (RHS), `*` (both), or `keyword` |
| `nl` | the natural-language phrase; `{name}` placeholders capture values |
| `mapping` | the DRL it expands to; `{name}` placeholders are substituted from the phrase |

### How it's used
A **guided rule** (`.rdrl`) authored against this DSL lets a business user write "a high value claim"
and Business Central expands it to the DRL at build. `{level}`-style placeholders bind the spoken value
into the generated DRL.

> Not runtime-executed by a Node engine — it's authoring sugar for guided rules. For engine-authored
> rules, write the DRL directly via a **ruleset** (`../drl/scenarios.md`).

---

The jBPM-side `.dsl` is in [model.json](model.json) / [model.md](model.md); the tested example is
`../../../bpmn-sdk/examples/project-assets/`.
