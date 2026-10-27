# Properties — usage guide

**Author** engine `messages: { <locale>: { key: value } }` on your `EngineProject`
([scenarios.md §0](scenarios.md)) — labels keyed by locale (`default` + `fr`/`es`/…), **no kjar paths**;
`fromEngineProject` writes `messages.properties` / `messages_<locale>.properties` (it owns the names).
Runtime: `examples/functions/properties.mjs` — `resolve(messages, key, locale)` (locale → default
fallback), `labelsFor(messages, prefix, locale)`. Arbitrary non-i18n config `.properties` → carry via `assets`.

## 1. Details
Extension `.properties`, SDK asset `kind: "properties"`. i18n / config key-value pairs.

## 2. Usage
Loaded by forms / i18n / config lookups.

## 3. How / when to use
`parseAsset("m.properties", text)` → `{ props: { key: value } }`; `buildAsset` writes `key=value` lines.
