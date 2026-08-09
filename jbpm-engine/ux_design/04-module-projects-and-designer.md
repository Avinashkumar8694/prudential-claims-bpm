# Module: Projects & Designer

Covers: Home/Projects list, Project shell, Processes workspace (canvas), Assets, Form Builder,
Data Objects, Access (new), Settings.

## Projects list (`/projects` — `WorkflowsComponent`, KEEP)

Already correct, no structural change: hero header with inline create, jBPM-kjar import, folder-
tree filter bar, card grid with kebab menu (move to folder / archive), skeletons/empty states.

**Enrich**:
- Card gets 3 small stat chips (from data already available or cheap to add: process count,
  active-instance count, last-deployed-at) — turns the grid into a mini status board instead of
  just a name list. Active-instance count needs one cheap aggregate query
  (`GET /instances?workflowId=&status=running&count=true`-style) — not a new module.
- Card kebab menu gains **"Duplicate project"** (clone at head draft, jBPM has no direct
  equivalent but "Copy" at the asset level implies the same expectation at project level) — P2.

## Project shell (`ProjectShellComponent`, KEEP shape, add two tabs)

```
┌ ← Projects   {Project Name ✎}   KEY-123            Instances  Deployments  Export ⬇ ┐
├ Overview │ Processes │ Assets │ Access │ Settings ──────────────────────────────────┤
```

Tabs become **Overview / Processes / Assets / Access / Settings** (Overview and Access are new —
see below). Header unchanged (back-link, inline-editable name, read-only key badge, links out to
pre-filtered Instances/Deployments, Export jBPM).

### Overview (NEW — what opening a project actually lands on)

Today, clicking a project in the grid drops straight into the Processes tab's canvas — the
busiest, highest-cognitive-load screen in the product, with zero orientation first. Every other
top-level entity we ship (Home for the app, Deployment detail, Instance detail) leads with a
summary before the workhorse view; Projects is the one exception. Overview closes that gap:

```
┌ Claims Onboarding  [production] ──────────────────────────────────────────┐
│ End-to-end claim intake, review, and payout process...                    │
├ 4 Processes │ 12 Active instances │ v12 Deployed to prod │ 1 Open error ──┤
├ Processes (name, node count, deployed/draft) → Open workspace ────────────┤
│ Assets (kind chips, counts) → jump straight to a kind ─────────────────────┤
├ Recent activity (this project only — same event feed as Home, filtered) ──┤
│ Contributors (avatars) → Manage access ────────────────────────────────────┤
└─────────────────────────────────────────────────────────────────────────┘
```

Every stat tile and list row is a real link (KPI → the screen that explains it, a process row →
the canvas pre-selected on that process, an asset-kind chip → that kind in Assets, Contributors →
Access) — it's a router, not a dead-end summary. This is genuinely new surface area (no existing
component backs it) but cheap: every number on it is already computed elsewhere (`ctx.processes()`,
`ctx.assetKinds()`, the Deployments/Instances APIs, the same activity feed backing
[Home](./08-module-dashboards-analytics.md) and [Audit Log](./07-module-admin-iam.md)). Roadmap P0.

## Processes workspace (`project-processes.component.ts` + `process-canvas.component.ts`, ENRICH)

Current shape is correct and stays: left = process list (compact rows, add/rename/delete), right
= toolbar (save-state, Variables count, auto-layout, Run/Validate/Build/Deploy) + embedded canvas.
Double-click-opens-modal for node/edge properties stays — it's the right call, don't revert to an
always-visible panel.

### Canvas enrichments (see also [03-design-system.md](./03-design-system.md) §6)

| Item | Today | Redesign |
|---|---|---|
| Layout engine | Fixed 4-column grid reflow | Real layered auto-layout (dagre/elk.js) — handles branching gateways without overlap |
| Overview | None | Minimap, bottom-right, draggable viewport |
| Selection | Single-click select one | + marquee drag-select for multiple nodes |
| Clipboard | None | Copy/paste nodes (and later cross-process paste) |
| Validation surface | `problems-panel.component.ts` (already good — VS Code "Problems" pattern) | Keep as-is; wire its error/warning count into the footer status bar (currently dead chrome, per [02](./02-information-architecture.md)) |
| Zoom | Not confirmed present | Explicit +/- controls + fit-to-screen, bottom-right (matches jBPM's canvas corner controls) |

### Node palette — full inventory (target state, schema-driven via the existing `Catalog` API)

The existing `PropertiesPanelComponent` is already a generic schema-driven form renderer keyed off
`Catalog.schemas[engineType]` — this is the right architecture; the redesign's job is to make sure
the **catalog itself** covers the full jBPM-equivalent node/property surface, not to replace the
renderer.

**Events** (Start / Intermediate / End — same three families as jBPM):

| Type | Start | Intermediate (catch/boundary) | End |
|---|:---:|:---:|:---:|
| None | ✓ | – | ✓ |
| Timer | ✓ | ✓ (boundary: interrupting/non-interrupting) | – |
| Message | ✓ | ✓ | ✓ |
| Signal | ✓ | ✓ | ✓ |
| Error | subprocess-only | boundary-only | ✓ |
| Escalation | ✓ | ✓ | ✓ |
| Conditional | ✓ | ✓ | – |
| Compensation | subprocess-only | ✓ (boundary) | ✓ |
| Terminate | – | – | ✓ |

Each event type's property form (already partially modeled per `docs/14-error-handling.md`'s Error
Catch node): timer needs duration/cycle/date sub-widget (the existing `event(polymorphic)` widget
in `UiField.widget` already anticipates this — extend its sub-kinds to cover all seven types
above, not just timer/signal/message/error/escalation/condition already listed in `models.ts`).

**Tasks**:
- **User Task** — property sections: Assignment (Actors, Groups — reuses the existing IAM
  Users/Groups so a picker, not free text), Data I/O (existing `keyval` widget), Reassignment
  (time expression + target — NEW, needs a `reassignment` widget: trigger `notStarted`/
  `notCompleted` + duration + target actor/group), Notification (NEW, same shape, email instead of
  reassignment target), Multiple Instance (NEW — sequential/parallel + collection input/output +
  completion condition), SLA Due Date (NEW — duration field, feeds the SLA badge in
  [03](./03-design-system.md)), Skippable/Priority/Is Async (existing `bool`/`number` widgets
  already cover these).
- **Script Task** — script + language select (existing `code` widget) — already covered.
- **Business Rule Task** — Rule Language select (DRL/DMN/JS — this engine's actual rule kinds per
  `server/src/assets/` are `rulesets`/`decisionTrees`/`guidedTables`/`decisions`, so the picker
  should be **which asset** in this project, not a jBPM-style Rule Flow Group string) + On Entry/
  Exit — mostly covered, needs an **asset-reference widget** (NEW `assetRef` widget: dropdown
  scoped to `ctx.assetKinds()` of the right kind) rather than freeform text.
- **Service Task** — Implementation = an HTTP call (this engine's actual integration surface is
  `config.integrationBaseUrl`-style HTTP nodes per the existing conventions memory, not Java/
  WebService) — keep the existing HTTP-node property set, don't import jBPM's
  Interface/Operation Java-centric fields verbatim; they don't map to this runtime.
- **Manual/None Task** — placeholder, no execution semantics — trivial, already coverable by the
  generic renderer with an empty schema.

**Subprocesses**: Embedded, Reusable (Called process picker — an `assetRef`-style widget scoped to
this project's processes — Independent, Abort Parent, Wait for completion), Multiple Instance
(same MI sub-fields as User Task), Ad hoc (NEW — a container whose children aren't required to be
fully sequence-flow-connected; needed for [10-case-management-future.md](./10-case-management-future.md)
but useful standalone too as a "loose task group").

**Gateways**: Exclusive, Inclusive, Parallel, Event-based — Complex gateway is deliberately **not**
planned (jBPM's own docs treat it as rare/advanced; not worth the validation-rule complexity for a
v1 parity target — revisit only if a real process needs it).

**Structure**: Sequence flow (with condition expression on outgoing branches of Exclusive/
Inclusive gateways — existing `code`/`stringlist` widgets cover this), Data Objects on canvas
(exists as an asset kind already, `types`), Text Annotation (NEW, trivial — label-only node with no
execution semantics, useful for diagram readability), Swimlanes (P2 — needs canvas-rendering work
beyond the properties-panel, the auto-actor-propagation-per-lane behavior is a real engine
semantic, not just visual).

**Process-level properties** (Diagram Properties, nothing selected) — the existing "Process
Variables" modal already covers Process Variables; add **Global Variables** (session-scoped,
shared across processes in the project — NEW, small addition to the same modal) and a
**process-level SLA Due Date** (NEW, feeds instance-level SLA rollup).

### Form generation hook

Add a **"Generate form"** action on any User Task's double-click modal (and a process-level
"Generate start form" in the toolbar) that scaffolds a new Form asset pre-bound to that task's
Data Input/Output — mirrors jBPM's Form Generation toolbar icon (research §4) exactly, but writes
into *our* Form Builder (below) instead of jBPM's Form Modeler.

## Assets (`project-assets.component.ts`, ENRICH per-kind)

Current shape (one card per kind, name-chips + inline add-form) stays for kinds that are
genuinely simple (Enumerations, Messages, Data types-as-list). Three kinds get a real editor
instead of a seed-only form, opened the same double-click-modal way the canvas already uses:

### Data Objects (`types` kind) — NEW field editor

A Data Object today is created with just a name. Enrich to a field-list editor (mirrors jBPM's
Data Object designer exactly — it's the same concept, "a typed record"):

```
┌ Data Object: Claimant ───────────────────────────── [+ Field] [Save] ┐
│ Field name        Type          Required   List?                    │
│ firstName         string        ✓                                   │
│ dateOfBirth       date                                               │
│ policyNumbers     string                    ✓ (list)                │
└────────────────────────────────────────────────────────────────────┘
```
Types: string, number, boolean, date, and **a reference to another Data Object** (nested types —
this is what makes Data Objects composable the way jBPM's are, and what Forms/process variables
bind against).

### Forms (`forms` kind) — NEW visual Form Builder

Today: name + backing-class seed field only, no visual design surface at all — the single largest
gap flagged in the codebase audit (jBPM's Form Modeler is a core, heavily-used piece; ours doesn't
exist yet). Target:

```
┌ Components ──────┐┌ Canvas ────────────────────────────┐┌ Field props ─────┐
│ Model Fields      ││  [First Name______]                ││ Bound to:        │
│  • firstName      ││  [Date of Birth  ▾]                 ││  Claimant.first  │
│  • dateOfBirth    ││  [Policy Numbers (list) + ]         ││  Name            │
│ Controls          ││  [Upload Document  ⬆]               ││ Label: ...       │
│  • Text  • Number ││                                     ││ Required: ☐      │
│  • Date  • Select ││  [ Save ]                            ││ Placeholder: ... │
│  • Checkbox       ││                                     ││                  │
│  • Document       ││                                     ││                  │
│  • Section/HTML   ││                                     ││                  │
└──────────────────┘└─────────────────────────────────────┘└──────────────────┘
```
- **Components panel**: Model Fields (bound to the process's Data Objects/variables, drag onto
  canvas — exact jBPM pattern) + generic Controls (Text, Textarea, Number, Date, Checkbox, Radio,
  Dropdown, Document/file upload, Section/HTML block).
- Drag-to-canvas, click-to-select-and-edit-in-right-panel (consistent with the double-click-modal
  convention elsewhere, adapted to inline-select since this *is* the editor, not a property popup
  on top of something else).
- **Document field** needs a storage answer before it's real — flagged as a backend dependency,
  not just UI (see roadmap P2: file storage strategy, mirrors jBPM's pluggable marshalling
  strategy conceptually but doesn't need to copy its Java-specific implementation).
- Renders identically at runtime in the Task detail "Work" tab ([06-module-tasks.md](./06-module-tasks.md))
  and as a process start form (a "Start" button anywhere a process can be launched opens this
  form instead of a bare JSON/variable list).

### Decision Tables (`guidedTables`, `decisionTrees`, `decisions` kinds) — NEW grid/tree editor

Today: name-only seed. Target: a spreadsheet-like grid editor for `guidedTables` (condition
columns → action columns → rows = rules, matches jBPM's Guided Decision Table almost exactly) and
a simple visual tree editor for `decisionTrees`. `decisions` (DMN) stays lower priority — full DMN
boxed-expression editing is a large, separable effort; P3 roadmap, not blocking.

### Remaining kinds (Enumerations, Messages, Scorecards, Test Scenarios) — KEEP current shape

These are genuinely well-served by "name + a couple of seed fields" today; no enrichment needed for
v1 parity.

## Access (NEW tab — cheapest high-value screen in this whole redesign)

`Workflow.permissions: WorkflowPermission[]` and `PUT /workflows/:id/permissions` already exist
end-to-end on the backend and currently round-trip with **zero UI and zero authz enforcement
reading them** (confirmed in the codebase audit). This tab is pure frontend + wiring the
already-existing route the enforcement layer needs to actually check:

```
┌ Access ─────────────────────────────────────────── [+ Add] ┐
│ Role          Actions                                       │
│ analyst       view, run                              [Edit] │
│ builder       view, edit, run                         [x]   │
└──────────────────────────────────────────────────────────┘
```
List+detail-free (small enough for an inline table), row = Role + a multi-select of the same
`workflow:*` action taxonomy already defined in `permission-taxonomy.ts` — no new permission model
needed, just a per-project override of the global one. This is the direct analog of jBPM's project-
level Contributors, scoped to our existing role model instead of inventing Owner/Admin/Contributor
tiers we don't have a use for yet.

## Settings (`project-settings.component.ts`, KEEP + close a flagged gap)

General + shared variables editor stays as-is. The doc trail already flags per-process cron
scheduling and environment overrides as "planned, not implemented" (`docs/13`) — this redesign
keeps that honest rather than silently dropping it:

- **Environment overrides** (NEW): a per-environment key/value override table (dev/staging/prod
  values for the same variable name) — surfaces at deploy time so `Deployment.env` (already a
  `Record<string,string>` on the domain model) has a UI to populate it instead of being API-only.
- **Scheduled start** (NEW): a cron-like "start a new instance on schedule" config, backed by the
  existing `TimerJob` `kind: 'start'` concept in `server/src/domain.ts` — currently modeled, not
  exposed anywhere in project settings.
- **Integration base URL** field: currently a UI-only input wired to nothing (flagged in the
  frontend-conventions memory). Either wire it to an actual per-project config the HTTP integration
  nodes read, or remove it — don't ship a settings field that silently does nothing. Roadmap P1.
