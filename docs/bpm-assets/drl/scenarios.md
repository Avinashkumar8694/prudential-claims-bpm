# DRL — every scenario (engine JSON → jBPM DRL)

## Two layers — which one to write
There are **two** JSON representations, and you almost always want the first:

1. **Engine ruleset (nodejs-native)** — §0 below. Dead simple: facts by **name**, conditions as
   `field: {op: value}`, actions as `set`/`insert`/`delete`/`call`. **No package, no Java FQNs, no
   `modify($c)`, no `ruleflow-group`.** Your Node engine executes this directly, and the SDK
   (`rulesToDrl` / `fromEngineProject`) synthesizes *all* the jBPM detail: fact names → imported FQNs
   (from the project type registry), `group` → `ruleflow-group` + the `.drl` path, package from the
   process. **This is what you author.**
2. **`DrlModel` (jBPM-side)** — §1–§10 below. A faithful, fully-structured model of the DRL file
   (package, imports, patterns, actions, functions, declares, queries). This is what the SDK
   **produces** from layer 1, and it's the **escape hatch** when you need a Drools feature the simple
   ruleset doesn't cover. You can drop to it per-asset via `assets`.

Everything here is tested in [`../../../bpmn-sdk/test/drl.test.mjs`](../../../bpmn-sdk/test/drl.test.mjs).
Anything not covered structurally has a `{ "raw": "…" }` escape hatch, so 100% of DRL is expressible.

---

## 0. Engine ruleset — the simple form (what you write)
The **whole** thing you author. Everything is a plain name or value — no package, no Java FQNs, no
`ruleflow-group`, no DRL syntax.

```jsonc
// an EngineProject holds: { "rulesets": [ … ], "types": [ … ], "processes": [ … ] }
{
  "group": "classify",                 // logical rule group
  "rules": [{
    "name": "High value claim",
    "when": [
      { "fact": "Claim", "as": "c", "where": { "amount": { "gt": 100000 } } }
    ],
    "then": [
      { "set": "c", "fields": { "status": "HIGH" } }   // update the matched fact's fields
    ]
  }]
}
```
with the fact schema (also package-free — the SDK defaults it):
```jsonc
"types": [ { "name": "Claim", "fields": [ { "name":"amount","type":"double" }, { "name":"status","type":"string" } ] } ]
```
compiles to:
```drl
package com.acme.rules;
import com.acme.model.Claim;

rule "High value claim"
    ruleflow-group "classify"
    when
        $c : Claim( amount > 100000 )
    then
        modify( $c ) { setStatus( "HIGH" ) }
end
```

### How `when` / `then` relate to `types`
`types` are your **fact schemas** (like TS interfaces). A rule references them by name:
- `fact: "Claim"` → the type named `Claim` in `types` (SDK resolves it to an FQN + `import`).
- the field names in `where` (`amount`, `status`) and in `set`/`insert` `fields` are **that type's
  fields** — `where` reads them, `set`/`insert` write them.

So `types` = the data shapes, `when` = match/read them, `then` = write them. A Node engine executes
this directly against plain objects; the SDK maps the names to Java for jBPM.

### Complete field reference (every property, every mapping)
The full JSON shape — no field omitted (`?` = optional):

```jsonc
{
  "rulesets": [{
    "group":   "classify",         // required. -> each rule's `ruleflow-group` + the .drl file name
    "package": "com.acme.rules",   // optional. default: <process package>.rules
    "path":    "src/main/resources/com/acme/rules/classify.drl",  // optional. default derived from package+group
    "rules": [{
      "name":     "High value claim",   // required. -> rule "..."
      "priority": 10,                    // optional number. higher fires first. -> salience 10
      "noLoop":   true,                  // optional. rule won't re-trigger itself. -> no-loop true
      "when": [ /* EngineWhen[] — all AND-ed together */ ],
      "then": [ /* EngineThen[] — run in order when `when` matches */ ]
    }]
  }]
}
```

**What `priority` and `noLoop` do** (they affect *firing*, not matching):
- `priority` (→ `salience`) — a tie-breaker when **several rules match in the same cycle**: higher
  fires first (default `0`). If rules never compete for the same facts, it does nothing. Node engine:
  sort the matched-rule agenda by `priority` desc before firing.
- `noLoop` (→ `no-loop`) — a rule's `then` changes facts, which re-checks all rules — including this
  one, which can re-match and fire again (infinite loop). `noLoop: true` stops a rule from
  **re-activating itself from its own consequence** (other rules/facts can still trigger it). Node
  engine: while firing rule R, skip re-activations of R on the same fact tuple. Set it when a rule's
  `then` writes a field its own `when` reads.

**`EngineWhen`** — one matched fact (or a negative/existence test):
| Field | Req? | Meaning | Maps to |
|-------|------|---------|---------|
| `fact` | ✅ | a type **name** from `types` | `Fact( … )` + `import <FQN>` |
| `as` | opt | binding name (no `$`); reference in `then` | `$as : Fact( … )` |
| `where` | opt | field conditions (see grammar below) | the `( … )` constraints |
| `exists` | opt | `false` = must **not** exist; `true` = must exist (unbound); omit = normal match | `not Fact(…)` / `exists Fact(…)` / `Fact(…)` |
| `not` | opt | alias of `exists: false` | `not Fact(…)` |

**`where` value grammar** — each `field:` entry is one of:
| JSON form | Meaning | DRL |
|-----------|---------|-----|
| `"status": "OPEN"` | bare literal → equals | `status == "OPEN"` |
| `"active": true` | bare boolean/number → equals | `active == true` |
| `"type": ["DEATH","TI"]` | bare array → `in` | `type in ( "DEATH", "TI" )` |
| `"amount": { "gt": 100000 }` | `{op: value}` | `amount > 100000` |
| `"amount": { "gte": 1, "lte": 10 }` | several ops on one field | `amount >= 1, amount <= 10` |
| `"status": { "in": ["A","B"] }` | op with array | `status in ( "A", "B" )` |
| `"claimId": { "ref": "claim.id" }` | **cross-fact join** (equals a bound fact's field) | `claimId == $claim.id` |
| `"total": { "gt": { "ref": "limit.value" } }` | op vs a bound field | `total > $limit.value` |

**`CondOp`** — every operator and its DRL mapping:
| `CondOp` | DRL | | `CondOp` | DRL |
|----------|-----|-|----------|-----|
| `eq` | `==` | | `in` | `in ( … )` |
| `ne` | `!=` | | `notIn` | `not in ( … )` |
| `gt` | `>` | | `contains` | `contains` |
| `gte` | `>=` | | `notContains` | `not contains` |
| `lt` | `<` | | `matches` | `matches` |
| `lte` | `<=` | | `memberOf` | `memberOf` |

`ref: "claim.id"` means "the `id` field of the fact bound as `claim`" → `$claim.id`. This is how you
**join** facts (correlate a FraudAlert to *this* Claim). A leading `$` in `ref` is optional.

**`EngineThen`** — every action and its DRL mapping:
| JSON form | Meaning | DRL |
|-----------|---------|-----|
| `{ "set": "claim", "fields": { "status": "HIGH" } }` | update a matched fact | `modify( $claim ) { setStatus( "HIGH" ) }` |
| `{ "insert": "Escalation" }` | create+insert a new fact | `insert( new Escalation() );` |
| `{ "insert": "Escalation", "fields": { "level": 3 } }` | create+insert with fields | `Escalation $escalation = new Escalation(); $escalation.setLevel(3); insert($escalation);` |
| `{ "delete": "claim" }` | remove a matched fact | `delete( $claim );` |
| `{ "call": "logger.warn", "args": ["hi", 1] }` | invoke a helper/global | `logger.warn("hi", 1);` |

`set`/`insert` field names must be fields of the type; values are literals (strings quoted, numbers/
booleans raw). `set`/`delete` target a binding name from a `when` entry's `as`.

### Full worked example (uses every construct above)
```jsonc
{ "group": "classify", "rules": [{
  "name": "High value open claim with no fraud alert", "priority": 10, "noLoop": true,
  "when": [
    { "fact": "Claim", "as": "claim",
      "where": { "amount": { "gte": 100000 }, "status": "OPEN", "type": ["DEATH","TI"] } },
    { "fact": "FraudAlert", "exists": false, "where": { "claimId": { "ref": "claim.id" }, "open": true } }
  ],
  "then": [
    { "set": "claim", "fields": { "priority": "HIGH" } },
    { "insert": "Escalation", "fields": { "level": 3 } }
  ] }] }
```
compiles to:
```drl
rule "High value open claim with no fraud alert"
    salience 10
    ruleflow-group "classify"
    no-loop true
    when
        $claim : Claim( amount >= 100000, status == "OPEN", type in ( "DEATH", "TI" ) )
        not FraudAlert( claimId == $claim.id, open == true )
    then
        modify( $claim ) { setPriority( "HIGH" ) }
        Escalation $escalation = new Escalation(); $escalation.setLevel(3); insert($escalation);
end
```
Anything beyond this grammar (functions, `or`/`collect`/`accumulate`, expressions in `then`) → drop to
the `DrlModel` escape hatch (§1–§10) via `assets`.

### How a Node engine executes this on data (runtime)
`types` and rules are *authoring* artifacts. At runtime your engine keeps plain objects — **facts** —
in **working memory**, each tagged with its type, and runs a **match → resolve → act** loop:

1. **Match** — for each rule, find fact combinations satisfying its `when`. A positive entry scans
   facts of that `fact` type whose `where` holds and **binds** the match to `as`. A `ref` compares to
   an already-bound fact's field, so multiple entries **join** (correlate a `FraudAlert` to *this*
   `Claim`). `exists:false`/`true` test absence/presence without binding.
2. **Resolve** — matches become *activations* on an agenda; if several are ready, `priority` orders
   them (higher first). Fire one.
3. **Act** — run `then` against the bound facts: `set` mutates fields, `insert` adds a fact, `delete`
   removes one, `call` invokes a helper.
4. **Repeat** — acting changed working memory, so re-match. Stop at a fixpoint (nothing new fires);
   `noLoop` keeps a rule from re-firing on its own change.

`types` at runtime are just the object shapes (validation/defaults); your engine works on plain JS
objects — no Java, no classes. The reference engine also models **property reactivity** (a `set`
re-evaluates only rules that read a changed field → forward chaining) and **`noLoop`** (a rule isn't
re-triggered by its own change; without it, a rule that writes a field it reads loops).

**Runnable reference engines + traces:**
- [`examples/08-run-engine-rules.mjs`](../../../bpmn-sdk/examples/rules-runtime/08-run-engine-rules.mjs) — the ~90-line
  engine + a minimal 2-rule scenario (match, join, negation, priority, `set`).
- [`examples/09-comprehensive-rules.mjs`](../../../bpmn-sdk/examples/rules-runtime/09-comprehensive-rules.mjs) — **one
  ruleset exercising every construct**: all 12 operators, every `where` form (literal/array/range/
  `{ref}` join/`{op:{ref}}`), `exists:false`+`exists:true`, `priority`, `noLoop` (with vs without),
  forward chaining, and all `then` actions (`set`/`insert` ±fields/`delete`/`call`).

Both tested in [`test/engine-rules-runtime.test.mjs`](../../../bpmn-sdk/test/engine-rules-runtime.test.mjs).
Example 08's trace — a $150k open claim `c1`, a $3k new claim `c2`, an open fraud alert **for c1**:
```
fired: Flag high value  on { claim=c1 }                       # c1.amount > 100000  -> c1.priority = HIGH
fired: Auto-approve …    on { claim=c2 }                       # c2 small+NEW AND no open FraudAlert joins c2 -> c2.status = APPROVED
# c1 keeps status OPEN (too big to auto-approve); the alert is c1's, so it never blocks c2
```

---

## The jBPM-side `DrlModel` (what the SDK produces / the escape hatch)
The rest of this page documents `DrlModel` — the faithful structure the SDK generates from §0, and
what you write directly only when you need a feature the simple ruleset doesn't cover.

The complete catalogue of how a jBPM `.drl` can be authored, each expressed as **`DrlModel` JSON** and
the **DRL text** the SDK compiles it to.

A `.drl` file, top to bottom: `package` → `unit` → `import` / `import static` / `import function` →
`global` → `function` → `declare` → `query` → `rule`. The model mirrors that:

```jsonc
{ "kind": "drl", "model": {
  "package": "com.acme.rules", "unit": "ClaimUnit",
  "imports": ["com.acme.model.Claim"], "staticImports": ["com.acme.Util.fee"], "functionImports": ["com.acme.Fns.calc"],
  "globals": ["java.util.List approved"],
  "functions": [ /* DrlFunction | string */ ],
  "declares":  [ /* DrlDeclare  | string */ ],
  "queries":   [ /* DrlQuery    | string */ ],
  "rules":     [ /* DrlRule */ ]
} }
```
| Emits | From |
|-------|------|
| `package com.acme.rules;` | `package` |
| `unit ClaimUnit;` | `unit` (Drools 7 rule units) |
| `import com.acme.model.Claim;` | `imports[]` |
| `import static com.acme.Util.fee;` | `staticImports[]` |
| `import function com.acme.Fns.calc;` | `functionImports[]` |
| `global java.util.List approved;` | `globals[]` |

---

## 1. Constraints — `RuleConstraint` (inside a pattern's `( … )`)
| Engine JSON | DRL |
|-------------|-----|
| `{ "field":"amount", "op":">", "value":100000 }` | `amount > 100000` |
| `{ "field":"status", "op":"==", "value":"NEW" }` | `status == "NEW"` |
| `{ "field":"active", "op":"==", "value":true }` | `active == true` |
| `{ "field":"amount", "op":">", "var":"$threshold" }` | `amount > $threshold` (unquoted var/expr) |
| `{ "bind":"$a", "field":"amount" }` | `$a : amount` (field binding) |
| `{ "field":"type", "op":"in", "value":["DEATH","TI"] }` | `type in ( "DEATH", "TI" )` |
| `{ "field":"type", "op":"not in", "value":["X"] }` | `type not in ( "X" )` |
| `{ "field":"name", "op":"matches", "value":"A.*" }` | `name matches "A.*"` |
| `{ "field":"tags", "op":"contains", "value":"vip" }` | `tags contains "vip"` |
| `{ "field":"tags", "op":"not contains", "var":"$x" }` | `tags not contains $x` |
| `{ "field":"x", "op":"memberOf", "var":"$list" }` | `x memberOf $list` |
| `{ "field":"y", "op":"soundslike", "value":"smith" }` | `y soundslike "smith"` |
| `{ "raw":"eval( $c.ok() )" }` | `eval( $c.ok() )` |

**`ConstraintOp`** (all): `==` `!=` `>` `>=` `<` `<=` `contains` `not contains` `memberOf`
`not memberOf` `matches` `not matches` `soundslike` `in` `not in`. Literal values are quoted
(strings) or emitted raw (numbers/booleans); use `var` for an unquoted variable/expression, `raw` for
anything else. **Node-engine note:** `value` compares to a literal, `var` compares to another bound
fact/field — the engine resolves `$x` from the match context.

## 2. Patterns — `RulePattern`
| Engine JSON | DRL |
|-------------|-----|
| `{ "fact":"Claim" }` | `Claim(  )` |
| `{ "fact":"Claim", "bind":"$c", "constraints":[…] }` | `$c : Claim( amount > 100000, status == "NEW" )` |
| `{ "fact":"Address", "bind":"$a", "from":"$c.addresses" }` | `$a : Address(  ) from $c.addresses` |
| `{ "fact":"Event", "entryPoint":"stream" }` | `Event(  ) from entry-point "stream"` |

`fact` is a **declared type name** (resolved to an FQN by `makeTypeResolver`, see the engine model) or
an imported class. `from` sources the pattern from an expression; `entryPoint` from a CEP stream.

## 3. Conditional elements — `LhsElement` (recursive)
| Engine JSON | DRL |
|-------------|-----|
| `{ "and": [A, B] }` | `( A(  ) and B(  ) )` |
| `{ "or": [A, B] }` | `( A(  ) or B(  ) )` |
| `{ "not": A }` | `not A(  )` |
| `{ "exists": A }` | `exists A(  )` |
| `{ "forall": [base, check] }` | `forall ( $c : Claim(  ) Claim( valid == true ) )` |
| `{ "eval": "amount > 0" }` | `eval( amount > 0 )` |
| `{ "collect": { "pattern": {…}, "source": {…} } }` | `$list : ArrayList(  ) from collect( Claim( status == "OPEN" ) )` |
| `{ "accumulate": { "source": {…}, "bindings": [{ "bind":"$sum","fn":"sum","arg":"$c.amount" }] } }` | `accumulate( $c : Claim(  ); $sum : sum( $c.amount ) )` |
| `{ "raw": "Number( $n : intValue > 5 )" }` | `Number( $n : intValue > 5 )` |

A rule's `when` is `LhsElement[]` — **top-level elements are implicitly AND-ed**, one per line. Nest
`and`/`or` for grouping. **Node-engine note:** patterns → predicates over the working set; `not`/`exists`
→ quantifiers; `collect` → gather-into-a-collection; `accumulate` → fold (`sum`/`count`/`avg`/…).

## 4. RHS actions — `RuleAction` (a rule's `then`)
| Engine JSON | DRL |
|-------------|-----|
| `{ "modify":"$c", "set":{ "status":"HIGH", "reviewed":true } }` | `modify( $c ) { setStatus( "HIGH" ), setReviewed( true ) }` |
| `{ "modify":"$c", "set":{ "score":{ "expr":"$c.getScore() + 10" } } }` | `modify( $c ) { setScore( $c.getScore() + 10 ) }` |
| `{ "update":"$c", "set":{ "status":"LOW" } }` | `$c.setStatus( "LOW" ); update( $c );` |
| `{ "insert":"new Flag($c)" }` | `insert( new Flag($c) );` |
| `{ "insertLogical":"new Flag($c)" }` | `insertLogical( new Flag($c) );` |
| `{ "delete":"$c" }` | `delete( $c );` |
| `{ "retract":"$c" }` | `retract( $c );` (legacy alias of delete) |
| `{ "call":"logger.warn", "args":["high",42] }` | `logger.warn("high", 42);` |
| `{ "raw":"System.out.println($c);" }` | `System.out.println($c);` |

`set` values are quoted/raw literals, or `{ "expr":"…" }` for an unquoted Java/JS expression. `modify`
re-asserts the fact (re-triggers matching); `update` is the explicit setter+`update()` form; `insert`/
`insertLogical` add facts; `delete`/`retract` remove; `call` invokes a function/global method.

## 5. Rule attributes — `attrs` (structured) or `attributes` (raw lines)
```jsonc
"attrs": { "salience":100, "noLoop":true, "dialect":"mvel", "ruleflowGroup":"g", "agendaGroup":"ag",
  "activationGroup":"act", "autoFocus":true, "lockOnActive":true, "enabled":true,
  "dateEffective":"01-Jan-2026", "dateExpires":"31-Dec-2026", "duration":5000, "timer":"int: 1s",
  "calendars":["weekdays"] }
```
compiles to (one per line, before `when`):
```drl
    salience 100
    no-loop true
    dialect "mvel"
    ruleflow-group "g"
    agenda-group "ag"
    activation-group "act"
    auto-focus true
    lock-on-active true
    enabled true
    date-effective "01-Jan-2026"
    date-expires "31-Dec-2026"
    duration 5000
    timer (int: 1s)
    calendars "weekdays"
```
`ruleflow-group` is the one the process's `businessRuleTask` fires. You can also pass any attribute
verbatim via `attributes: ["salience 5"]`.

## 6. Rule `extends` + metadata
```jsonc
{ "name":"child", "extends":"parent", "meta":["@department(\"claims\")"], "attributes":["salience 5"],
  "when":"Claim( )", "then":"System.out.println(\"hi\");" }
```
```drl
rule "child" extends "parent"
    @department("claims")
    salience 5
    when
        Claim( )
    then
        System.out.println("hi");
end
```

## 7. Functions — `DrlFunction | string`
```jsonc
{ "name":"calcFee", "returnType":"double", "params":[{ "type":"double", "name":"amount" }], "body":"return amount * 0.1;" }
```
```drl
function double calcFee(double amount) {
    return amount * 0.1;
}
```

## 8. Type declarations — `DrlDeclare | string`
```jsonc
{ "name":"StockTick", "extends":"Event", "annotations":["@role( event )","@timestamp( time )"],
  "fields":[{ "name":"symbol","type":"String" }, { "name":"price","type":"double","annotations":["@position(0)"] }] }
```
```drl
declare StockTick extends Event
    @role( event )
    @timestamp( time )
    symbol : String
    price : double @position(0)
end
```

## 9. Queries — `DrlQuery | string`
```jsonc
{ "name":"isAdult", "params":[{ "type":"int","name":"minAge" }],
  "when":[{ "fact":"Person","bind":"$p","constraints":[{ "field":"age","op":">=","var":"minAge" }] }] }
```
```drl
query "isAdult"(int minAge)
        $p : Person( age >= minAge )
end
```
(No params → `query "all"` with no parentheses.)

## 10. Full rule, end-to-end
```jsonc
{ "name":"Escalate large open claims", "attrs":{ "ruleflowGroup":"triage", "salience":10 },
  "when":[
    { "fact":"Claim","bind":"$c","constraints":[{ "field":"amount","op":">","value":100000 },{ "field":"status","op":"==","value":"OPEN" }] },
    { "not":{ "fact":"Reviewer","constraints":[{ "field":"assignedTo","op":"==","var":"$c" }] } } ],
  "then":[ { "modify":"$c","set":{ "priority":"HIGH" } }, { "insert":"new Escalation($c)" } ] }
```
```drl
rule "Escalate large open claims"
    salience 10
    ruleflow-group "triage"
    when
        $c : Claim( amount > 100000, status == "OPEN" )
        not Reviewer( assignedTo == $c )
    then
        modify( $c ) { setPriority( "HIGH" ) }
        insert( new Escalation($c) );
end
```

## Raw / passthrough
Every level accepts `raw`: a constraint `{ "raw":"…" }`, an LHS element `{ "raw":"…" }`, an RHS action
`{ "raw":"…" }`, or a whole `when`/`then` as a string. Functions/declares/queries also accept a plain
string. So even DRL the structured model doesn't know about still round-trips and deploys.

## Parse (jBPM → engine)
`parseDrl` recovers `package`/`unit`/imports/globals structurally, rules as
`{ name, extends?, attributes[], when, then }` with **raw** `when`/`then` strings, and
functions/declares/queries as **raw block strings** — round-trip stable
(`writeDrl(parseDrl(x))` re-parses to the same model). Re-authoring structurally is opt-in; existing
files survive untouched.
