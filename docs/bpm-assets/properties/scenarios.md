# Properties — every scenario (engine messages → jBPM `.properties`)

A `.properties` file is plain `key=value` config — most often **i18n message bundles** (form/field
labels per locale). The nodejs-native way to think about this is **by locale**, not by file path: you
write labels keyed by `default` / `fr` / `es`, and the SDK generates the correctly-named `.properties`
files (`messages.properties`, `messages_fr.properties`, …).

## Two layers — which one to write
1. **Engine messages (nodejs-native)** — §0 below. `{ <locale>: { key: value } }`. No kjar file paths,
   no filename conventions. **This is what you author.**
2. **`.properties` files (jBPM-side)** — [model.md](model.md). The `key=value` files the SDK produces
   and `parseProperties` recovers.

Everything here is tested in [`../../../bpmn-sdk/test/project-assets.test.mjs`](../../../bpmn-sdk/test/project-assets.test.mjs).

---

## 0. Engine messages — the simple form (what you write)
```jsonc
// an EngineProject holds: { "messages": { … }, "forms": [ … ], "processes": [ … ] }
{
  "messages": {
    "default": { "review.title": "Review claim",        "review.amount": "Claim amount" },
    "fr":      { "review.title": "Examiner la demande",  "review.amount": "Montant de la demande" }
  }
}
```
generates (the SDK owns the filenames):
```properties
# src/main/resources/messages.properties        (locale "default")
review.title=Review claim
review.amount=Claim amount
# src/main/resources/messages_fr.properties      (locale "fr")
review.title=Examiner la demande
review.amount=Montant de la demande
```

### Complete field reference
| Shape | Meaning | Maps to |
|-------|---------|---------|
| `messages` | a map of **locale → key/value bundle** | one `.properties` file per locale |
| `"default"` | the base/fallback bundle | `messages.properties` |
| `"<locale>"` (e.g. `fr`, `es`) | a locale bundle | `messages_<locale>.properties` |
| `{ key: value }` | the label entries | `key=value` lines |

You never write `src/main/resources/…` or the `_fr` suffix — the SDK derives the paths from the locale.
(Arbitrary non-i18n config `.properties` at a specific path → carry it verbatim via `assets`.)

### Locales — the bundle keys
Each key of `messages` is a **locale**, an [ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639_language_codes)
language code (optionally with a region, `pt_BR`), plus the special `default`:
| Locale key | Meaning | Generated file |
|------------|---------|----------------|
| `default` | base / fallback bundle (**always keep this**) | `messages.properties` |
| `fr` | French | `messages_fr.properties` |
| `es` | Spanish | `messages_es.properties` |
| `de` | German | `messages_de.properties` |
| `pt_BR` | Brazilian Portuguese | `messages_pt_BR.properties` |
Single-language app? Write only `default`. At runtime, a key missing from a locale bundle **falls back
to `default`** (so a locale bundle only needs the keys it actually translates).

### Key naming — why `review.title`
A `.properties` file is **flat** (`key=value`, no nesting), so keys use a **dot-namespaced convention**
to organize them. The dot is a naming pattern, not structure:
- `review.title` → the **title** label on the **review** screen; `review.amount` → its **amount** field.
- Convention: `<screen-or-component>.<element>` (or `<entity>.<field>`), lowercase, dotted.
- It **namespaces** (so `review.title` ≠ `claim.title`), **groups** (fetch all `review.*` with
  `labelsFor(messages, "review.", locale)`), and **ties to forms**: a form field's label can *be* a
  message key resolved per locale instead of a hard-coded string.

```jsonc
"messages": {
  "default": {
    "review.title":  "Review claim",     // screen title
    "review.amount": "Claim amount",      // field label
    "review.submit": "Approve",           // button
    "error.required": "This field is required"   // a shared/global message
  }
}
```
(It's a convention — `reviewTitle` or `screens.review.title` also work; dotted lowercase is the common
Java i18n style.)

### How a Node engine uses messages at runtime
Resolve a label for a locale, falling back to `default`. Reference helper
[`../../../bpmn-sdk/examples/functions/properties.mjs`](../../../bpmn-sdk/examples/functions/properties.mjs):
- `resolve(messages, "review.title", "fr")` → `"Examiner la demande"`;
- `resolve(messages, "review.amount", "fr")` → `"Montant de la demande"` (or the `default` if the locale
  bundle omits it);
- `labelsFor(messages, "review.", "fr")` → all `review.*` labels for the locale. Pairs with a form's
  `renderModel` to localize field labels.

---

The jBPM-side `.properties` is in [model.json](model.json) / [model.md](model.md); the tested example is
`../../../bpmn-sdk/examples/project-assets/`.
