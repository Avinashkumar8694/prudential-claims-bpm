# Data Object — every scenario (engine type → jBPM `.java` POJO)

## Two layers — which one to write
1. **Engine type (nodejs-native)** — §0 below. A **schema**: a name + fields (`{ name, type }`). No
   Java, no packages, no getters/setters. You reference it **by name** everywhere (process vars, rule
   facts, DMN, forms); the SDK resolves the name to a Java FQN and **generates the `.java` POJO**.
   **This is what you author.**
2. **`DataObjectModel` (jBPM-side)** — [model.md](model.md). The `{ package, className, fields[] }`
   the SDK **produces** (and `parseDataObject` recovers from an existing `.java`). The escape hatch for
   hand-written classes.

Everything here is tested in [`../../../bpmn-sdk/test/data-object.test.mjs`](../../../bpmn-sdk/test/data-object.test.mjs).

---

## 0. Engine type — the simple form (what you write)
```jsonc
// an EngineProject holds: { "types": [ … ], "processes": [ … ], "rulesets": […], "decisions": […] }
{
  "name": "Claim",
  "fields": [
    { "name": "id",      "type": "string" },
    { "name": "amount",  "type": "number" },
    { "name": "status",  "type": "string" },
    { "name": "address", "type": "Address" },              // nested declared type
    { "name": "items",   "type": "LineItem", "list": true } // collection of a type
  ]
}
```
generates `src/main/java/<pkg>/Claim.java` (a POJO with a field + getter/setter per entry):
```java
package com.acme.model;

public class Claim {
    private String id;
    private double amount;
    private String status;
    private com.acme.model.Address address;
    private java.util.List<com.acme.model.LineItem> items;
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    // … getters/setters for every field …
}
```

### How a type is used across the project
You never write a Java FQN — you write the **name**, and the SDK resolves it wherever jBPM needs one:
- a **process variable** `{ "name": "claim", "type": "Claim" }` → `structureRef="com.acme.model.Claim"`;
- a **rule fact** `{ "fact": "Claim", … }` (DRL) → `import com.acme.model.Claim;`;
- a **form** `model.className`, a **DMN** input type, etc.
- and the POJO `Claim.java` is generated once and added to the kjar.

So `types` = the data shapes; vars/rules/decisions/forms reference them **by name**. (See
`../../engine-model/README.md` "Type resolution".)

### Complete field reference
```jsonc
{
  "name": "Claim",                 // required. class name (NCName)
  "package": "com.acme.model",     // optional. default: <process package>.model
  "fields": [ { "name": "amount", "type": "number", "list": false } ]
}
```
| Field | Req? | Meaning |
|-------|------|---------|
| `name` | ✅ | class name; also the name you reference everywhere |
| `package` | opt | Java package; **defaulted** to `<process package>.model` (so you can omit it) |
| `fields[].name` | ✅ | field name; getter/setter derived (`getX`/`setX`) |
| `fields[].type` | ✅ | a primitive, another declared type name, or a Java FQN (see mapping) |
| `fields[].list` | opt | `true` → wrap in `java.util.List<…>` (typed collection) |

### `type` → Java (generated POJO field)
| engine `type` | Java field type |
|---------------|-----------------|
| `string` | `String` |
| `int` / `integer` | `int` |
| `long` | `long` |
| `double` / `float` / `number` | `double` |
| `bool` / `boolean` | `boolean` |
| `date` | `java.util.Date` |
| `object` | `Object` |
| `list` / `array` (as the type itself) | `java.util.List` (untyped) |
| `map` | `java.util.Map` |
| `<declared type name>` | its FQN (e.g. `com.acme.model.Address`) — a nested object |
| `<FQN with a dot>` | passthrough (e.g. `java.math.BigDecimal`) |
| any of the above **with `"list": true`** | `java.util.List<Boxed/FQN>` (e.g. `List<Integer>`, `List<com.acme.model.LineItem>`) |

`list: true` boxes primitive element types (`int`→`Integer`, `double`→`Double`, `boolean`→`Boolean`)
because Java generics can't hold primitives; declared/FQN element types are used as-is.

> Variable `structureRef` typing (for process vars, not POJO fields) is a separate, boxed mapping —
> `int`→`Integer`, `list`→`java.util.List`, a type name→its FQN — see `../../engine-model/README.md`.

### How a Node engine uses a type at runtime
A data object is a **schema**, not executable logic — your engine works on plain JS objects that match
it. Two useful operations (reference helper
[`../../../bpmn-sdk/examples/functions/data-object.mjs`](../../../bpmn-sdk/examples/functions/data-object.mjs)):
- **instantiate** — build a default object from the schema (`string`→`""`, number→`0`, `bool`→`false`,
  `list`→`[]`, `map`→`{}`, nested/date→`null`);
- **validate** — check a plain object's field JS-types against the declared types (number/string/
  boolean/array/object), returning a list of mismatches.

`.java` is only materialized for the jBPM kjar; at runtime the type is just the object's shape.

---

## Worked example (nested type + typed collection + all primitives)
```jsonc
"types": [
  { "name": "Address", "fields": [ { "name": "city", "type": "string" }, { "name": "zip", "type": "string" } ] },
  { "name": "LineItem", "fields": [ { "name": "sku", "type": "string" }, { "name": "qty", "type": "int" } ] },
  { "name": "Claim", "fields": [
    { "name": "id",       "type": "string" },
    { "name": "amount",   "type": "double" },
    { "name": "open",     "type": "boolean" },
    { "name": "filedOn",  "type": "date" },
    { "name": "address",  "type": "Address" },
    { "name": "items",    "type": "LineItem", "list": true },
    { "name": "tags",     "type": "string",   "list": true }
  ] }
]
```
→ three `.java` POJOs; `Claim` has `com.acme.model.Address address`,
`java.util.List<com.acme.model.LineItem> items`, and `java.util.List<String> tags`.

The jBPM-side model + a hand-written-class round-trip are in [model.md](model.md) / [model.json](model.json);
the tested example is `../../../bpmn-sdk/examples/data-objects/`.
