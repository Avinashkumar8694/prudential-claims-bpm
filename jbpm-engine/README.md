# jBPM Engine (Node.js)

A Node.js-native BPM engine + visual workflow builder, built on
[`@neutrinos/bpmn-sdk`](../bpmn-sdk). Author processes in the SDK engine-JSON model, run them in a
Node token interpreter, manage deployments (branches, versions, tags, active pointer), watch
per-instance execution, and export any workflow as a jBPM kjar.

> **Start with [`docs/`](./docs/README.md)** — requirements, features, architecture, data model, API,
> UI spec, security, execution engine, deployment/branching/versioning, checklist, and roadmap.

## Layout
- `server/` — Express API + token execution engine + stores (Node 20 + TypeScript)
- `app/` — Angular 18 workflow builder + operations console
- `docs/` — full documentation set (read first)

## Develop
```bash
npm install                 # installs both workspaces (server + app)
npm run dev:server          # API on http://localhost:4000 (+ WS on /ws)
npm run dev:app             # Angular on http://localhost:4200 (proxies /api → :4000)
npm test                    # server test suite
```

## Status
Phase 0 (docs + scaffold) and the Phase 1/2 foundation are in place:
- Server: workflows / branches / versions / deployments / instances / tasks modules, a token
  execution engine (start/end/script-js/manual/gateway/userTask + wait/resume), file + memory stores,
  REST API, WebSocket hub. **4 tests green**; full author→deploy→run→complete lifecycle verified.
- App: Angular shell (sidenav, builder header + palette + canvas placeholder + properties panel),
  workflows / deployments / instances views wired to the API. **Builds clean.**

See [`docs/10-checklist.md`](./docs/10-checklist.md) for exactly what's done vs. pending, and
[`docs/11-roadmap.md`](./docs/11-roadmap.md) for the phased plan.
