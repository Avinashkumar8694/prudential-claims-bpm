# Form — usage guide

## 1. Details
Extension `.frm` (JSON) or `.form` (XML), SDK asset `kind: "form"`. UI for a user task / process start.

## 2. Usage
Referenced by a user task (form key); binds fields to a data model.

## 3. How / when to use
`parseAsset("review.frm", text)` → `{ json }` (JSON form) or `{ xml }` (XML form). `buildAsset` writes
JSON (pretty) or serialises the XML tree.
