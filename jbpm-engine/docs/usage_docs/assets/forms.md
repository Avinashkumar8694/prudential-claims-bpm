# Forms

**Key**: `forms` · **Name field**: `name` · **Exports as**: `.form` · **Used by**: [User Task](../nodes/user-task.md)'s `form` field

## Purpose

The data-entry surface a real user fills out to complete a [human task](../07-human-tasks.md) —
renders in the Task Detail page's Work tab instead of a raw JSON editor.

## Shape

```json
{ "name": "ClaimApproval", "model": { "className": "" }, "fields": [] }
```

Each entry in `fields`:

| Property | Type | Notes |
|---|---|---|
| `bind` | string | The task input/output field name this control reads/writes |
| `label` | string | Display label |
| `widget` | `text` \| `textarea` \| `integer` \| `number` \| `decimal` \| `checkbox` \| `boolean` \| `dropdown` \| `select` \| `radio` \| `date` | Control type |
| `required` | bool | Client-side validation |
| `readOnly` | bool | Display-only |
| `placeholder` | string | Placeholder text |

## Wiring to a node

A [User Task](../nodes/user-task.md)'s `form` field names this asset; its own `inputs`/`outputs`
mappings decide which process variables actually reach/leave the form — the form's `fields[].bind`
must match those input/output keys to actually show/collect the right data.

## Example

```json
{
  "name": "ClaimApproval",
  "model": { "className": "ClaimApprovalForm" },
  "fields": [
    { "bind": "amount", "label": "Claim amount", "widget": "decimal", "readOnly": true },
    { "bind": "decision", "label": "Decision", "widget": "select", "required": true },
    { "bind": "notes", "label": "Notes", "widget": "textarea" }
  ]
}
```

## Gotchas

- Renaming a form asset does **not** update every User Task's `form` reference automatically — check
  usages (the delete-blocked-while-referenced guard tells you where, but a rename isn't a delete).
- [Enumerations](enumerations.md) generate dropdown options on a **data type's field** (`Fact.field`),
  not directly on a form's `bind` — if a form field needs the same option list, point its `widget` at
  the same underlying data type field rather than duplicating the list by hand.
