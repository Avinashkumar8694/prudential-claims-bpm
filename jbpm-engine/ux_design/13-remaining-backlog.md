# Remaining backlog — what is deliberately not designed yet

Every item below is a **known** gap, not an oversight. This file exists so the coverage audit
([12-jbpm-coverage-audit.md](./12-jbpm-coverage-audit.md)) has a real destination for its ❌ rows,
and so a reviewer can tell "we decided not to" apart from "we forgot".

Grouped by why it's deferred.

## A. Blocked on engine capability (design would be fiction without it)

| Item | Blocked on | Doc |
|---|---|---|
| Case Management (case definitions, roles, milestones, ad-hoc stages, Case Overview) | Engine has no case constructs — no role-based dynamic assignment, no milestone condition evaluation, no ad-hoc stage execution | [10](./10-case-management-future.md) |
| Reassignment / notification rules authored on a User Task | Engine must evaluate time-based rules; today only the manual Forward/reminder equivalent is designable | [06](./06-module-tasks.md) |
| Multiple Instance (sequential/parallel) execution | Engine has no MI semantics or completion-condition evaluation | [04](./04-module-projects-and-designer.md) |
| SLA compliance as a *computed, filterable* value | `dueAt` exists on Task; process-level SLA and instance rollup do not | [03](./03-design-system.md) §3 |
| Document-typed variables end-to-end | Needs a file-storage decision before the Documents tab and Form Builder's Document field are real | [05](./05-module-operations.md) |
| Variable-change history | Needs an audit trail on variable writes | [05](./05-module-operations.md) |
| Swimlanes | Canvas rendering plus the actor-propagation engine semantic | [04](./04-module-projects-and-designer.md) |

## B. Deliberately out of scope (jBPM has it; we don't need it)

| jBPM feature | Why we're not building it |
|---|---|
| Execution Servers / KIE Containers / server templates | We deploy to logical **environments**, not a physical server fleet. Inventing a server-template screen would model something our runtime doesn't have. |
| Data Sources, Data Sets, Artifacts (Maven browser), Archetypes | No Maven or JDBC layer in this engine. |
| Process Instance Migration | Technology Preview even in jBPM itself, and a separate bolt-on app there. Revisit only if version-migration of running instances becomes a real requirement. |
| Dashbuilder-style custom dashboard authoring | Build the fixed Processes/Tasks reports first ([08](./08-module-dashboards-analytics.md)); a generic authoring tool is speculative. |
| Complex gateway | Rare in practice per jBPM's own docs; not worth the validation-rule complexity for v1. |
| Group priority / per-resource permission exceptions | Our role-based model has no corresponding problem. Considered and rejected, not missed. |
| Java/WebService Service Task implementation fields | Our integration surface is HTTP-node-based, not JVM-classpath-based. |

## C. Real UX gaps, not yet designed (do these next)

Ordered by how likely a reviewer is to hit them.

1. **Global search / ⌘K.** With 8 nav destinations and opaque ids (PI-1091, CLM-104), there is no
   way to jump to a known entity except filtering a list. Note: jBPM itself has **no** global
   search, so this is an improvement over parity, not parity work — which is exactly why it keeps
   getting deprioritised. It shouldn't.
2. **Per-asset version history + concurrent-edit locking.** [version-history.html](./mockups/version-history.html)
   is project-level only. jBPM's model is well documented and worth copying almost verbatim:
   opening an asset takes a pessimistic lock, released on save/close/session-end; lock status shows
   in the asset's metadata; another user can **force-unlock** with an explicit "this may cause
   \<user\> to lose unsaved changes" warning. Two builders editing the same process currently have
   no story at all.
3. **Save-with-comment (check-in comment).** jBPM requires a short change description on every
   asset save, which is what makes its version history readable. Our
   [version-history.html](./mockups/version-history.html) *shows* commit messages it has no UI to
   capture.
4. **Sample / template gallery.** [ui-states.html](./mockups/ui-states.html) renders a "Browse
   samples" button with no destination — and this is the entire first-run path. jBPM's equivalent
   (Try Samples, shown on the welcome screen when no projects exist) is confirmed and copyable.
5. **Export / Import as flows.** "Export jBPM ⬇", "Import jBPM", "Export CSV", "Compare to v11" and
   "Compare selected" are all currently buttons with no scope picker, no format choice, no progress
   and no result state.
6. **Applying [ui-states.html](./mockups/ui-states.html) and [dialogs.html](./mockups/dialogs.html)
   to real screens.** Both are specced properly; almost nothing consumes them. Highest-value
   targets: zero-results and empty variants of Instances and Tasks; the destructive-confirm on
   every Abort / Delete role / Remove access / Deactivate user / delete-a-referenced-field control.
7. **Login hardening.** [login.html](./mockups/login.html) is happy-path only — no error, no
   loading, no forgot-password, no SSO, no lockout.
8. **Responsive.** Explicit scope decision: **desktop ≥1280px only** for v1. The canvas positions
   nodes absolutely and will clip below that. Stated here rather than left silent.
9. **Iconography.** The mockups use emoji/Unicode glyphs as a placeholder system. Production needs
   one 20px stroke icon set (Lucide/Phosphor) as inline SVG — emoji render differently per OS and
   read as unpolished.
10. **Inline styles → components.** ~1000 inline `style=` attributes across the mockup set. They
    are prototype scaffolding; the Angular port should derive components from
    [03-design-system.md](./03-design-system.md), not transcribe the inline CSS.

## D. Documented in jBPM but thinly — verify against a live instance before building

Research surfaced these as genuinely under-documented, so our design makes a judgement call that
should be checked rather than trusted:

- **Advanced-filter operator set.** Only `equals to` and `!=` are textually confirmed in jBPM's
  docs. Our builder ([list-mechanics.html](./mockups/list-mechanics.html)) proposes a fuller,
  type-aware set (text/number/date/enum). That's a deliberate improvement, not documented parity.
- **AND/OR chaining between conditions** — not documented in jBPM at all. We assume match-all with
  an any/all toggle.
- **Sort and refresh behaviour** on operational lists — undocumented in jBPM. We assume
  click-header sort plus realtime push (which jBPM lacks entirely).
- **Bulk-action result presentation** — jBPM confirms *"a notification per selected task"* but not
  its form. We spec a per-row result list.
- **Job creation fields** — jBPM's own docs disagree across versions. Ours models what *our*
  `TimerJob` actually has, rather than copying a contested field set.
- **Task bulk-reassign confirm button is labelled "Delegate"** in jBPM's documented UI. We use
  "Reassign" because the jBPM label looks like a legacy artefact, not a deliberate choice.
