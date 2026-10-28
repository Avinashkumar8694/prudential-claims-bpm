# Design System

## What already exists (keep, extend, never fork)

`app/src/styles.css` is the single source of design tokens — every component references these by
name rather than hardcoding values, which is what makes theme switching (`data-theme="dark"`) and
future re-skinning work without touching component code. This redesign adds tokens only where a
genuinely new visual pattern shows up; it never introduces a second palette.

```
Color:    --primary/-600/-50, --bg, --surface, --surface-2, --border, --border-strong,
          --text, --text-secondary, --muted
Status:   --green/-bg, --blue/-bg, --purple/-bg, --orange/-bg, --amber/-bg, --red/-bg
          (each has a light-mode flat-pastel value and a dark-mode low-opacity-tint value)
Shape:    --radius (12px), --radius-sm (8px), --radius-pill
Shadow:   --shadow-xs, --shadow-card, --shadow-pop, --shadow-focus
Layout:   --header-h, --footer-h, --sidenav-w, --panel-w
Type:     --font, --font-mono
Space:    --sp-1 … --sp-8 (4px scale)
Canvas:   --canvas-bg, --canvas-dot (dedicated — canvas surfaces are a distinct "grid paper"
          layer, never reuse --surface/--border for them)
```

Existing components already in the house style, reused as-is by every new screen below:
`.btn` (+ `.primary`/`.ghost`/`.danger`), `.badge` (+ `.active`/`.inactive`/`.archived`), `.card`,
bare `table`/`th`/`td`, bare `input`/`select`/`textarea`, `.empty-state`, `.skeleton`/
`.skeleton-line`/`.skeleton-card`, the list+detail `.split` grid, `shared/breadcrumb`,
`shared/toast.service`, `shared/modal` (promise-based confirm/prompt).

## New tokens this redesign needs

```css
/* Status-tint semantic aliases — jBPM's Process Instance status vocabulary doesn't map 1:1
   onto our existing green/blue/purple/orange/amber/red; name them by meaning, not color,
   so a future palette change doesn't require touching every component. */
--status-running: var(--blue);      --status-running-bg: var(--blue-bg);
--status-waiting: var(--amber);     --status-waiting-bg: var(--amber-bg);
--status-completed: var(--green);   --status-completed-bg: var(--green-bg);
--status-aborted: var(--muted);     --status-aborted-bg: var(--surface-2);
--status-failed: var(--red);        --status-failed-bg: var(--red-bg);
--status-suspended: var(--purple);  --status-suspended-bg: var(--purple-bg);

/* SLA proximity — distinct from generic status, needs its own 3-step scale */
--sla-ok: var(--green);             --sla-ok-bg: var(--green-bg);
--sla-at-risk: var(--amber);        --sla-at-risk-bg: var(--amber-bg);
--sla-breached: var(--red);         --sla-breached-bg: var(--red-bg);

/* Diagram token/execution overlay (Instances → Diagram tab, enriched per 05) */
--token-active: var(--primary);         /* pulsing dot on an active node */
--token-visited: var(--border-strong);  /* solid outline on a completed node */
--token-error: var(--red);

--panel-w-lg: 420px;  /* wider detail pane for screens with tabs (Instance/Task detail) */
```

Dark-mode pairs for all of the above follow the same rule the existing tokens already use: swap
flat pastel `-bg` fills for low-opacity tints, never reuse the light value.

## New components this redesign requires

### 1. Filter bar triad (Filters / Advanced Filters / Saved Filters)

The single highest-value pattern pulled from jBPM research (§10) — used on Instances, Tasks,
Execution Errors, Jobs & Timers. One shared component, not four bespoke ones:

```
┌─────────────────────────────────────────────────────────────────┐
│ [Status ▾] [Date range ▾] [+ Advanced filter]      [★ Saved ▾]  │
└─────────────────────────────────────────────────────────────────┘
```

- **Filters**: a row of typed dropdown/chip controls, one per commonly-filtered field for that
  entity (defined per-screen, not generic — Instances gets Status/Definition/Date, Tasks gets
  Status/Assignee/Date, etc.).
- **Advanced filter**: `+ Advanced filter` opens a popover to build `field [operator] value`
  predicates (operators: equals, contains, before/after, in), stackable, each shown as a
  removable chip in the bar once added.
  - **Column-driven vs. AI-generated queries**: two on-ramps, not either/or. The `field/operator/
    value` builder is always available and always the ground truth (deterministic, inspectable,
    exactly what jBPM's Advanced Filters does). Additionally, a **"Ask" input** in the same
    popover accepts a natural-language query — e.g. *"instances started this week that failed"* or
    *"tasks overdue and assigned to my team"* — and resolves it into the identical structured
    predicate chips (never a hidden/opaque filter): the parsed field/operator/value chips populate
    the bar exactly as if built by hand, so the user can see, edit, or remove any part of what the
    natural-language query produced. This turns "I don't know the column name" into a filter, but
    never bypasses the deterministic filter model underneath — parity with jBPM's builder is
    preserved, this only adds a friendlier way to reach it. P2 roadmap (needs an NL→predicate
    resolver; the structured builder ships first and stands alone).
- **Saved filters**: `★ Saved ▾` lists named filter sets for this screen (stored per-user), radio-
  select to apply, a "☆ set as default" toggle (auto-applies on page load), save-current-as-new.
- **Column picker**: a separate `⚏ Columns` icon at the right of the results table — toggle
  standard columns, and once a list is filtered to a single definition (one process, one task
  name), offer that definition's variables as ad hoc columns (exact jBPM pattern, §10). Drag to
  reorder.

### 2. Bulk action bar

Appears above the table the instant ≥1 row checkbox is checked; disappears when the selection
clears. Not a permanent toolbar — avoids cluttering the default view.

```
┌─────────────────────────────────────────────────────────────────┐
│ ✓ 3 selected     [Claim] [Release] [Reassign ▾]      [Clear]    │
└─────────────────────────────────────────────────────────────────┘
```

Each bulk action reports **per-row** success/skip (a small inline result list in a toast/modal),
never a single all-or-nothing result — matches jBPM's own behavior and is the only sane UX once
"3 of 5 selected tasks are already claimed by someone else" is a real outcome.

### 3. SLA badge

```
🟢 On track · due in 2h     🟠 At risk · due in 15m     🔴 Breached · 40m overdue
```
A pill using the new `--sla-*` tokens, computed client-side from `dueAt`/now (no server push
needed beyond the existing `dueAt` field once SLA lands on the domain model — see roadmap P2).
Appears in: Task list rows, Task detail header, Process Instance list rows (rolled up from any
task/subprocess SLA within the instance).

### 4. Notification bell + panel

Bell icon, unread-count badge, click opens a right-aligned dropdown panel (not a full page):
grouped by Today/Earlier, each row = icon (by event kind) + one-line text + relative time,
click-through to the relevant entity. "Mark all read." Full spec in
[09-notifications-and-realtime.md](./09-notifications-and-realtime.md).

### 5. Comment thread

Reused on Task detail (Comments tab) and, later, Process Instance detail. Simple reverse-
chronological list (avatar-initial circle, name, relative time, text) + a bottom compose box.
No rich text needed — jBPM's own comment feature is plain text.

### 6. Diagram viewer enrichments

The existing `process-canvas.component.ts` (builder) and the Instances Diagram tab share a visual
language (node cards, port dots, `--canvas-bg`/`--canvas-dot`) but currently lack, per the
codebase audit:
- **Minimap** — small fixed-position overview in a bottom corner with a draggable viewport
  rectangle; needed once a process exceeds ~15 nodes (dagre-style auto-layout can produce wide
  diagrams).
- **Marquee (rubber-band) multi-select** — drag on empty canvas to select multiple nodes, enabling
  multi-move and multi-delete.
- **Proper auto-layout** — replace the current fixed 4-column grid reflow with a real layered
  layout (dagre or elk.js) so branching/merging gateways don't overlap.
- **Copy/paste** — for nodes within a process and, later, across processes in the same project.

These are canvas-engineering work, not new visual language — they reuse existing node/edge/port
rendering. Detailed in [04-module-projects-and-designer.md](./04-module-projects-and-designer.md).

### 7. Empty/loading states for new screens

Every new screen (Execution Errors, Jobs & Timers, Reports & Analytics, Audit Log, Access tab)
uses the existing `.empty-state` (icon + headline + explanation + optional CTA) and `.skeleton`
shimmer blocks — no new empty-state visual language, just new icon/copy per screen, listed in each
module doc.

## Interaction conventions carried into every new screen

- **List+detail split** (`.split` grid) for anything that's "browse many, act on one" — Execution
  Errors, Jobs & Timers, Audit Log all follow this, not a full-page table with a modal.
- **Double-click-opens-modal** for property editing on canvas elements (established in the
  Processes workspace redesign) — any new per-node editor (e.g. a Form field's properties) follows
  the same rule, never an always-visible side panel.
- **Toast for action feedback, modal for confirmation of destructive/irreversible actions** —
  already the pattern (`ModalService` promise-based confirm before delete/archive/abort); new
  destructive actions (Abort instance, Delete deployment, Force-unlock — if adopted, see 04) follow
  it.
- **Realtime redraw over polling** — any new live-updating screen (Jobs & Timers "next fire"
  countdown, Execution Errors appearing as they happen) subscribes to `RealtimeService` topics the
  same way the Instances Diagram tab already does (`instance:<id>`), rather than a `setInterval`
  poll.
