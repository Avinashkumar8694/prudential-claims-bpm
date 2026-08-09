# Enumerations

**Key**: `enumerations` · **Name field**: `name` · **Exports as**: real jBPM's `.enumeration` file

## Purpose

A named list of allowed values for a data type's field (`'Fact.field' → ['A', 'B', ...]`) — generates
dropdown options on export, and is the natural place to keep a value list used by more than one
[form](forms.md) or [data type](types.md) field in sync.

## Shape

```json
{ "name": "ClaimStatus", "entries": {} }
```

`entries` maps a `Fact.field` key to its allowed value list:

```json
{
  "name": "ClaimStatus",
  "entries": {
    "Claim.status": ["submitted", "under-review", "approved", "denied"]
  }
}
```

## Gotchas

- The key convention is `TypeName.fieldName`, matching real jBPM's `.enumeration` file format — not a
  free-standing named list you reference by an arbitrary id.
- One enumeration asset can hold entries for multiple `Fact.field` keys — you don't need a separate
  asset per field.
