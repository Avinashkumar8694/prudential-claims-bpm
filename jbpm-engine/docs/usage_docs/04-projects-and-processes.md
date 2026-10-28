# Projects & Processes

## Hierarchy

```
Folder (optional, organizational only)
  └─ Project (Workflow) — has a key, a name, one or more Branches
       └─ Branch — a line of development (default branch created with the project)
            └─ Version — a draft (mutable) or published (immutable) snapshot of the whole project's engine JSON
                 └─ Process(es) — one project can hold multiple processes; each Version snapshots all of them together
                       └─ Node graph — see the node reference
       └─ Assets — forms, DRL, DMN, etc. shared across every process in the project
```

A **Project** is what real jBPM calls a project/kjar — requires `workflow:edit` to create/modify.
Archiving a project frees its `key` for reuse (an archived workflow's key no longer blocks creating a
new one with the same key).

## Branches, drafts, and publishing

- Every project starts with one default branch.
- A **draft** version is mutable — `saveDraft(branchId, engineProject, actor, message?)`. This is what
  you're editing whenever you're in the process canvas; auto-saved as you work.
- **Publish** (`workflow:edit`) freezes the current draft into an immutable, numbered version and
  opens a *new* draft on the same branch to keep editing. Publishing runs full validation first (see
  below) — a process with validation errors cannot be published.
- Only a published version can be deployed (see [Deployments](05-deployments-and-environments.md)) —
  you never deploy a draft directly.

## The process canvas

Open a project → **Processes** tab → a process → the canvas. Left rail: a searchable node palette
grouped by category (Events, Tasks, Gateways, Sub-process — see the [node reference](nodes/README.md)
for every entry). Drag a node onto the canvas, connect it with sequence flows, double-click a node to
open its properties panel (fields are exactly what that node type's own reference doc lists).

- **Variables** (top bar): declare the process's own variables — name + type — before referencing them
  from node fields (`$variableName`).
- **Validate**: runs the same rule set publish will enforce, without saving — use it while iterating.
  Warnings (e.g. an unnamed node) don't block publish; errors do.
- **Problems panel**: lists every current validation error/warning with a jump-to-node link.
- **Build**: a dry-run compile check (e.g. dry-compiles any `lang: 'java'` script against the sidecar)
  without publishing.
- **Export jBPM**: downloads this project as a real `.bpmn2` kjar file set — see
  [Importing & exporting real jBPM](11-importing-and-exporting-jbpm.md).

## Validation rules (enforced at publish)

The validator (`modules/validation/rules.ts`) checks structural correctness, not just "does it look
right": every node reachable from a start, every path reaching an end (no dead ends, no infinite
loops without an end), gateway fan-in/fan-out cardinality, connected boundary events, and — importantly
— **every node type must be one this engine actually executes**: an imported real-jBPM construct this
engine can't run (an ad-hoc sub-process, a literalExpression/BKM-only DMN decision, custom Java
classpath code) is flagged as `unsupported-construct` rather than silently accepted and then failing
at runtime.

## Assets

Forms, DRL rulesets, DMN decisions, and seven other kinds live at the **project** level (Assets tab),
shared by every process in that project. A node references an asset by name (e.g. a User Task's
`form` field, a Business Rule's `ruleflowGroup`) — see the [asset reference](assets/README.md) for
every kind and its editor.

## Folders

Purely organizational (Projects page → folder tree) — no permission or execution implication, just a
way to group related projects.
