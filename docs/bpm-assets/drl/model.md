# DRL — model

A `.drl` file is a Drools rule file. Each rule is `rule "name" <attrs> when <LHS> then <RHS> end`,
where **`when`** is the *condition* (patterns that must match facts in working memory) and **`then`**
is the *consequence* (actions run when they match). This SDK models both, and lets you write them
either as **raw Drools text** or as a **structured model** the SDK compiles to text. This page is the
**type reference**; **[scenarios.md](scenarios.md)** is the full worked catalogue (one tested example
per construct).

```jsonc
{ "kind": "drl", "model": {
    "package": "com.acme.rules", "unit": "ClaimUnit",
    "imports": ["com.acme.model.Claim"], "staticImports": ["com.acme.Util.fee"], "functionImports": ["com.acme.Fns.calc"],
    "globals": [],
    "functions": [ /* DrlFunction | string */ ],
    "declares":  [ /* DrlDeclare  | string */ ],
    "queries":   [ /* DrlQuery    | string */ ],
    "rules": [ { "name": "…", "extends": "…", "meta": ["@m(\"x\")"],
                 "attrs": { "ruleflowGroup": "classify" } /* or "attributes": ["…"] */,
                 "when": "…"  /* or LhsElement[] */,
                 "then": "…"  /* or RuleAction[] */ } ]
} }
```
| Field | Meaning |
|-------|---------|
| package / unit | `package X;` / `unit X;` (rule units) |
| imports[] / staticImports[] / functionImports[] | `import …;` / `import static …;` / `import function …;` |
| globals[] | `global …;` |
| functions[] | `DrlFunction` (`{name,returnType?,params?,body}`) or raw `function … { … }` string |
| declares[] | `DrlDeclare` (`{name,extends?,annotations?,fields[]}`) or raw `declare … end` string |
| queries[] | `DrlQuery` (`{name,params?,when}`) or raw `query … end` string |
| rules[].name | rule name |
| rules[].extends / .meta[] | `rule "x" extends "y"` / `@metadata` lines |
| rules[].attrs | structured `RuleAttributes` → attribute lines (see scenarios §5) |
| rules[].attributes[] | raw attribute lines (`ruleflow-group "g"`, `salience 10`, …) |
| rules[].when | LHS — `string` (raw DRL) **or** `LhsElement[]` (compiled by the SDK) |
| rules[].then | RHS — `string` (raw DRL) **or** `RuleAction[]` (compiled by the SDK) |

`parseDrl` always returns `when`/`then` as **raw strings** (the file has no structure to recover).
`writeDrl`/`buildAsset` accept **either** form and emit identical DRL — so a structured model
compiles to exactly the text you'd hand-write.

## `when` — `LhsElement[]` (LHS / conditions)
An `LhsElement` is a **pattern** (`RulePattern`) or a **conditional element**
(`and`/`or`/`not`/`exists`/`forall`/`eval`/`collect`/`accumulate`/`raw`). Top-level elements are
implicitly AND-ed. Full grammar + a tested example for each: **[scenarios.md §2–3](scenarios.md)**.

```jsonc
{ "fact": "Claim", "bind": "$c", "constraints": [
    { "field": "amount", "op": ">",  "value": 100000 },
    { "field": "status", "op": "==", "value": "NEW" } ] }
// -> $c : Claim( amount > 100000, status == "NEW" )
```
| `RulePattern` field | Meaning |
|-------|---------|
| fact | fact type to match (a declared type name / imported class) |
| bind? | variable bound to the matched fact (`$c`) — omit for an unbound pattern |
| constraints[] | `RuleConstraint[]` — joined with `, ` inside the parentheses |
| from? / entryPoint? | `… from <expr>` / `… from entry-point "<name>"` |

**`RuleConstraint`** is one of: `{field,op,value}` (literal), `{field,op,var}` (unquoted var/expr),
`{bind,field}` (field binding `$a : amount`), or `{raw}`. **`ConstraintOp`** (all):
`==` `!=` `>` `>=` `<` `<=` `contains` `not contains` `memberOf` `not memberOf` `matches`
`not matches` `soundslike` `in` `not in`. For `in`/`not in`, `value` is an array.

## `then` — `RuleAction[]` (RHS / consequences)
| Action shape | Emits |
|--------------|-------|
| `{ "modify": "$c", "set": { "status": "HIGH" } }` | `modify( $c ) { setStatus( "HIGH" ) }` |
| `{ "update": "$c", "set": { "status": "LOW" } }` | `$c.setStatus( "LOW" ); update( $c );` |
| `{ "insert": "new Flag($c)" }` | `insert( new Flag($c) );` |
| `{ "insertLogical": "new Flag($c)" }` | `insertLogical( new Flag($c) );` |
| `{ "delete": "$c" }` / `{ "retract": "$c" }` | `delete( $c );` / `retract( $c );` |
| `{ "call": "logger.warn", "args": ["x", 1] }` | `logger.warn("x", 1);` |
| `{ "raw": "System.out.println($c);" }` | passthrough (any RHS line the model can't express) |

`set` keys are field names — capitalised into `setX(...)` setters; values are literals or
`{ "expr": "…" }` for an unquoted expression. `modify` re-asserts the fact (re-triggers matching
rules); `update` is the explicit setter+`update()` equivalent; `raw` is the escape hatch.

## Helpers (exported)
```ts
import { compileConstraint, compilePattern, compileLhs, compileAction,
         compileFunction, compileDeclare, compileQuery, writeDrl, buildAsset } from '@fabrixly/bpmn-sdk';
compilePattern({ fact:'Claim', bind:'$c', constraints:[{field:'amount',op:'>',value:100000}] });
// "$c : Claim( amount > 100000 )"
compileLhs({ not: { fact:'Reviewer' } });                 // "not Reviewer(  )"
compileAction({ modify:'$c', set:{ status:'HIGH' } });    // "modify( $c ) { setStatus( \"HIGH\" ) }"
```

## How a Node engine uses `when`/`then`
In jBPM these compile to Drools and run in the Java rule engine (a `businessRuleTask` fires a
`ruleflow-group`). A **Node-native engine has no Drools**, so the structured model *is* the executable
form: `when` patterns become predicates over facts in your working set
(`facts.filter(f => f.type==='Claim' && f.amount > 100000)`), and `then` actions become mutations
(`modify`/`update` → set fields + re-evaluate; `retract`/`insert` → remove/add facts). The same JSON
therefore (a) executes directly in your engine and (b) `buildAsset`s to a real `.drl` for a jBPM kjar —
one rule definition, two runtimes.
