# Case Management (future phase)

Deliberately **not** part of the current IA ([02-information-architecture.md](./02-information-architecture.md)).
This doc exists so the omission is a documented decision, not a blind spot — per this redesign's
own principle #6 ("don't design past what the engine can run").

## Why it's deferred

Case Management in jBPM (research §5) is a distinct execution model, not just a different diagram
style: no required start node, dynamic role-based (not hard-coded) task assignment, milestones
with engine-evaluated completion conditions, ad-hoc stages where activities aren't required to be
sequence-flow-connected. None of these exist in `server/src/domain.ts` or the execution engine
today (`server/src/engine/`) — the token interpreter assumes a conventional start-node-driven
BPMN process. Building the Case screens described below against an engine that can't actually run
a case would produce a convincing-looking UI over nothing, which is worse than not building it.

## What it would look like, when the engine supports it

### New asset kind: Case Definition
Built in the same Process Canvas ([04-module-projects-and-designer.md](./04-module-projects-and-designer.md)),
same double-click-modal editing convention, with case-only additions:
- **Case Roles** — name + cardinality (max assignable users/groups), assigned dynamically at
  runtime rather than hard-coded on tasks (this is the core discipline jBPM's own docs insist on —
  research §5 — and should be enforced in the properties panel by only offering "assign by role"
  as an option on case tasks, no free actor/group fields).
- **Milestones** — a palette node with a completion-condition expression (reuses the existing
  `code` widget from the generic properties-panel renderer), states Active/Completed/Terminated
  shown as a progress rail in the Case Overview (below).
- **Stages** — an ad-hoc-subprocess container; the "Ad hoc" subprocess type already flagged as a
  useful standalone primitive in [04](./04-module-projects-and-designer.md) is the direct building
  block here, not a separate concept to build twice.

### New screen: Case Overview (instance-level, parallel to Process Instance Details)
```
┌ Case #4021 — Insurance Claim Review ───────────────────────────┐
│ Roles: owner=avinash  reviewer=maria  approver=(unassigned)     │
├ Available actions ─┬ In progress ────┬ Completed ──────────────┤
│ [+ New task]        │ Review docs      │ Intake ✓               │
│ [+ New sub-process] │                  │ Assign reviewer ✓      │
├ Milestones ─────────────────────────────────────────────────────┤
│ ● Intake complete   ● Under review   ○ Decision made            │
├ Comments ─────────────────────────────────────────────────────┤
│ ...                                                              │
└ [Close case] ───────────────────────────────────────────────────┘
```
Directly modeled on jBPM's Case Management Showcase (research §5), adapted into our own list+detail
convention rather than a bolted-on separate app the way jBPM's Showcase is — one of the few places
we'd deliberately do *better* than jBPM's own reference implementation (Showcase is explicitly not
production-supported, no live-push refresh, no reopen). Ours would inherit `RealtimeService` push
and the standard case lifecycle (start/close **and** reopen — no reason to inherit jBPM's own
Showcase limitation once building this natively).

## Phasing

1. **Engine**: role-based dynamic assignment, milestone completion-condition evaluation, ad-hoc
   stage execution semantics — real interpreter work, sequenced in `docs/08-execution-engine.md`'s
   domain, not this UX folder.
2. **Design-time**: Case Definition asset kind + palette additions (small once the canvas's
   schema-driven properties panel already exists — mostly new `NodeSpec`/`Catalog` entries).
3. **Run-time**: Case Overview screen (above).

Not started until step 1 has a real target date — this doc is the spec waiting for that, not a
commitment to build now. See [11-feature-matrix-and-roadmap.md](./11-feature-matrix-and-roadmap.md)
(P3 — explicitly last).
