# Enumeration — usage guide

## 1. Details
Extension `.enumeration`, SDK asset `kind: "enumeration"`. Value lists for guided editors.

## 2. Usage
Guided editors show dropdowns for a fact's field from these lists.

## 3. How / when to use
`parseAsset("e.enumeration", text)` → `{ enums: { 'Fact.field': [values] } }`; `buildAsset` writes them.
