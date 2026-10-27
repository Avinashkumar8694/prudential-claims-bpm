# 11 — Roadmap (phased delivery)

Each phase is independently shippable and demoable. Phases 0–1 are foundation; 2–6 add vertical value.

## Phase 0 — Docs & scaffold  ✅ (this commit)
- Full `docs/` set (this folder).
- Monorepo scaffold: `package.json` workspaces, `server/` (Express+TS), `app/` (Angular).
- Server boots (`/api/health`), app shell renders (header/sidenav/canvas/footer).

## Phase 1 — Authoring foundation
- `store/` repository + FileStore; `workflows`, `branches`, `versions` modules + REST.
- Node registry; palette; @foblex/flow canvas; drag-drop; connect; select.
- Engine JSON ↔ canvas mapping; save draft; `validateModel` surfacing.
- Properties panel with schema-form for start/end/script/userTask/gateway (rest P1.5).
- **Demo**: build the reference flow, save, reload, validate.

## Phase 2 — Execution engine (core)
- `engine/` interpreter + handlers (start/end/script(js)/manual/gateway(excl,parallel)/sequence).
- Instances module + REST; step loop; persistence; audit.
- WS hub; instance detail view; **live executing-flow highlight**.
- **Demo**: start an instance, watch tokens flow on the canvas to completion.

## Phase 3 — Human & async work
- User tasks + task inbox + form render/validate (SDK form runtime).
- Timers (catch-timer, boundary-timer, delay) + durable scheduler.
- Receive/send + SignalBus; catch/throw; event & boundary events.
- Call activity + multi-instance (child instances).
- **Demo**: reference flow (Form → Add Tag → SMS → Wait → Email) end-to-end with a wait + task.

## Phase 4 — Decisions & integration
- HTTP service task (with allowlist + deployment env).
- Business-rule (DRL), DMN, decision-table/tree, scorecard nodes via SDK runtimes + design-time preview.
- Sub-process (embedded/transaction/event); error handling & node retry.
- **Demo**: rule-driven routing + REST callout in a running instance.

## Phase 5 — Deployment, branching, versioning, export
- Deployments module: deploy, tags, environments, active pointer, promote/rollback, undeploy/archive.
- Deployment management view; run against active/tagged deployment.
- Version publish + diff; branch create/fork; copy-forward merge.
- **Export as jBPM kjar** (zip) + **import** jBPM project (round-trip).
- **Demo**: branch → version → deploy to staging → promote to prod → export kjar.

## Phase 6 — Platform hardening
- AuthN/Z (JWT + RBAC + workflow permissions), multi-tenancy, secrets, outbound allowlist, sandbox
  hardening (isolated-vm), rate limits/quotas.
- Postgres store; metrics/dashboards; e2e (Playwright); Docker/compose; CI.
- Accessibility pass; i18n; theming polish to match screenshots.

## Cross-cutting (every phase)
- Tests alongside code (unit + integration); update [checklist](./10-checklist.md).
- Keep engine JSON the single IR; keep SDK the only BPMN/kjar producer.

## Milestone acceptance
- **M1** (P1): author + validate + persist the reference flow.
- **M2** (P2–3): run it to completion with a wait/task and live highlight.
- **M3** (P5): deploy/branch/version/tag/export fully working.
- **M4** (P6): secured, multi-tenant, Postgres-backed, CI-green.
