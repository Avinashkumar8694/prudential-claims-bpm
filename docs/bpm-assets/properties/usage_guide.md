# Properties — usage guide

## 1. Details
Extension `.properties`, SDK asset `kind: "properties"`. i18n / config key-value pairs.

## 2. Usage
Loaded by forms / i18n / config lookups.

## 3. How / when to use
`parseAsset("m.properties", text)` → `{ props: { key: value } }`; `buildAsset` writes `key=value` lines.
