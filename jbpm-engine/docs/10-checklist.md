# 10 — Implementation Checklist

Tracked, per [roadmap](./11-roadmap.md). `[ ]` todo · `[~]` in progress · `[x]` done.

## Phase 0 — Docs & scaffold
- [x] docs: README, requirements, features, architecture, data-model, api-spec, ui-spec, security,
      execution-engine, deployment/branching/versioning, roadmap, checklist
- [x] monorepo root `package.json` (workspaces: server, app) + `.gitignore`
- [x] `server/` scaffold: package.json, tsconfig, config, Express app, `/api/health`
- [x] `server/` SDK wrapper (`src/sdk`) re-exporting `@neutrinos/bpmn-sdk` + runtime evaluators
- [x] `server/` store: `Repository<T>` + `FileStore`
- [x] `app/` Angular scaffold: sidenav, builder header + palette + canvas placeholder, footer, routing (builds clean)
- [x] `npm install` verified for both workspaces; server boots + `/api/health` OK; app `ng build` OK

## Phase 1 — Authoring foundation
- [x] modules: `workflows`, `branches`, `versions` — model + service + router + tests
- [x] node registry (palette ↔ engine type ↔ schema) — server catalog endpoint
- [ ] canvas: @foblex/flow integration, drag-drop, connect, select, delete
- [ ] engine JSON ↔ canvas mapping layer + autosave draft
- [ ] properties panel schema-form (start/end/script/userTask/gateway)
- [x] validation module (server rules + UI Problems panel); errors block publish/deploy; node markers; see [12](./12-validation-rules.md)
- [ ] header dialogs: Variables, User Permissions; branch/version switcher

## Phase 2 — Execution engine (core)
- [x] `engine/` step loop + token model + persistence hooks
- [x] handlers: start, end, manual, script(js), sequence-flow, gateway(exclusive, parallel)
- [x] `instances` module + REST (start, get, history, diagram-state)
- [~] WS hub built + engine events emitted; UI consumption pending
- [~] instance detail view (variables + history timeline) done; live canvas highlight pending
- [x] sandbox for js scripts + flow conditions (node:vm; isolated-vm hardening in Phase 6)

## Phase 3 — Human & async work
- [x] handlers: userTask (+ Task service); catch/receive waits
- [x] signal/message delivery to an instance (resumes matching waits)
- [x] call activity → linked child instances + parent-resume with output mapping
- [x] node re-trigger (retry a node / replay); suspend/resume; abort
- [x] instance ops UI: list → detail (diagram highlight, variables, history), related-instance switching, signal, re-trigger
- [x] timers: catch-timer + durable scheduler (TimerJob + TimerService.tick, wired in index.ts); ISO duration/cycle
- [ ] timers: boundary-timer + start-timer (cron) firing (needs host-active tracking / scheduled instance creation)
- [ ] boundary events (interrupting + non-interrupting)
- [ ] forEach (multiple child instances)
- [ ] task inbox UI + form render/validate
- [ ] send/throw onto an external bus

## Phase 4 — Decisions & integration
- [x] handler: http service task — real REST call, $var body, resultTo mapping, SERVICE_ERROR on failure (outbound allowlist: Phase 6)
- [x] handler: rule — DMN decision tables (hit policies) + basic DRL rulesets evaluated over variables; RULE_ERROR on failure
- [ ] handler: decision-tree + scorecard evaluation
- [ ] design-time preview endpoints (rules/dmn/forms)
- [ ] sub-process (embedded/transaction/event) + error handling + node retry

## Phase 5 — Deploy / branch / version / export
- [ ] `deployments` module: deploy, tags, environment, active pointer (atomic), promote/rollback
- [ ] undeploy/archive; management list with counts + active badge
- [ ] version publish + diff; branch create/fork; copy-forward merge
- [ ] export kjar (zip) endpoint + UI; import jBPM project + round-trip test
- [ ] run-against-active/tagged deployment

## Phase 6 — Platform hardening
- [ ] auth (JWT) + RBAC guard + workflow permissions
- [ ] multi-tenancy enforcement in store; secrets module + encryption
- [ ] isolated-vm sandbox; rate limits + quotas
- [ ] Postgres store implementation
- [ ] metrics/dashboards; structured logging; audit completeness
- [ ] e2e (Playwright); Docker/compose; CI pipeline
- [ ] a11y (WCAG 2.1 AA) + i18n + theming polish

## Phase 7 — Projects, multi-process, assets & operations (see [13](./13-projects-and-operations.md))
- [x] script is always JavaScript (no language option; conditions are js)
- [x] backend: `Instance.processId`; start an instance by `processId`; graph uses the instance's process
- [x] backend: call-activity `resolveCalled` searches all processes across active deployments
- [x] backend: `processes` module — list/add/rename/remove/get/save a process inside the project draft
- [x] backend: `/deployments/:id/definitions` (process definitions per version)
- [x] UI: relabel Workflows → Projects; project list
- [x] UI: project detail with tabs (Processes / Variables / Assets / Rules / Settings / Deployments / Instances)
- [x] UI: builder opens a selected process by id; header Test + Deploy
- [x] backend+UI: `assets` module — list/add asset entries (forms/DRL/DMN/tables/…) in the project draft; Assets & Rules tabs
- [ ] validation `asset-ref` rule (node references an existing asset)
- [x] error handling: Error Catch node (boundary + global `*`), error taxonomy, runtime routing, validation, UI multi-select, SDK export expansion — see [14](./14-error-handling.md)
- [ ] error export: emit a true event sub-process for global (`*`) catches (currently boundary-on-every-activity approximation)
- [ ] backend+UI: cron/scheduled starts per process (`CronService` + settings + scheduler)
- [ ] UI: per-asset editors (form builder, DRL/DMN/table editors) — Phase 8
- [ ] tasks/definitions/instances views scoped per version + Test dry-run flow

## Definition of done (per module)
- [ ] Model + service + router + zod DTOs
- [ ] Unit tests (service) + integration test (API)
- [ ] AuthZ enforced; audit emitted
- [ ] Docs updated (api-spec / data-model) if contract changed
