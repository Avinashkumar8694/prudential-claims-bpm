# jBPM Engine (Node.js)

A Node.js-native BPM engine + visual workflow builder, built on
[`@fabrixly/bpmn-sdk`](../bpmn-sdk). Author processes in the SDK engine-JSON model, run them in a
Node token interpreter, manage deployments (branches, versions, tags, active pointer), watch
per-instance execution, and export any workflow as a jBPM kjar.

> **Start with [`docs/`](./docs/README.md)** — requirements, features, architecture, data model, API,
> UI spec, security, execution engine, deployment/branching/versioning, checklist, and roadmap.

## Layout
- `server/` — Express API + token execution engine + stores (Node 20 + TypeScript)
- `app/` — Angular 18 workflow builder + operations console
- `java-runtime/` — the JVM sidecar `lang:'java'` scripts/conditions actually compile and run in (a
  JDK, not just a JRE, must be on `PATH` — see `docs/15-scripting-and-jbpm-export.md`). `server/`'s
  `predev`/`pretest`/`prebuild`/`prestart` npm scripts recompile it automatically (`build:sidecar`),
  so it's never silently stale — no manual `javac` step needed.
- `docs/` — full documentation set (read first)

## Develop
```bash
npm install                 # installs both workspaces (server + app)
npm run dev:server          # API on http://localhost:4000 (+ WS on /ws) — also rebuilds java-runtime
npm run dev:app             # Angular on http://localhost:4200 (proxies /api → :4000)
npm test                    # server test suite — also rebuilds java-runtime
```

## Persistence
Every domain service depends only on the generic `Repository<T>`/`Store` abstraction
(`server/src/store/repository.ts`) — workflows/branches/versions/deployments/instances/tasks/
timers/audit are all just documents keyed by id, so the backend is swappable with no service-layer
changes. Two implementations:

- **`FileStore`** (default, zero setup) — one JSON file per entity under `.data/<collection>/<id>.json`.
- **`PgStore`** (`STORE=pg`, TypeORM) — a single `kv_store` table (`collection, id, tenant_id, data
  jsonb`); real durability, safe concurrent writers, shareable across multiple server processes.
  ```bash
  npm run docker:up   # starts postgres via ../docker-compose.yml (localhost:5433, db/user/pass: jbpm)
  STORE=pg npm run dev:server   # PG_URL defaults to that same compose service — zero extra config
  npm run docker:down
  ```
  See [`server/src/store/pg-store.ts`](./server/src/store/pg-store.ts). `npm run test:pg` (in
  `server/`) runs a real integration suite against it — author→publish→deploy→run→complete-task,
  plus a simulated-restart check — opt-in, not part of the default `npm test`, since it needs the
  container up.

## Status
Phase 0 (docs + scaffold) and the Phase 1/2 foundation are in place:
- Server: workflows / branches / versions / deployments / instances / tasks modules, a token
  execution engine (start/end/script-js/manual/gateway/userTask + wait/resume), file + memory stores,
  REST API, WebSocket hub. **4 tests green**; full author→deploy→run→complete lifecycle verified.
- App: Angular shell (sidenav, builder header + palette + canvas placeholder + properties panel),
  workflows / deployments / instances views wired to the API. **Builds clean.**

See [`docs/10-checklist.md`](./docs/10-checklist.md) for exactly what's done vs. pending, and
[`docs/11-roadmap.md`](./docs/11-roadmap.md) for the phased plan.

## Docker (production)

The engine API ships as one image **with a JDK** (needed by the Java script dialect, which compiles scripts with `javac`
at runtime) and the precompiled JVM sidecar. The build context is the repository root:

```bash
docker build -f jbpm-engine/Dockerfile -t orkestr-engine .
docker run -p 4000:4000 -v orkestr-data:/data \
  -e STORE=pg -e PG_URL=postgresql://user:pass@db:5432/jbpm \
  -e JWT_SECRET="$(openssl rand -hex 24)" -e ADMIN_INITIAL_PASSWORD='<strong password>' \
  -e DASHBOARD_URL=https://orkestr.example.com orkestr-engine
```

- `NODE_ENV=production` is set in the image: the server **refuses to start** on a default `JWT_SECRET` / admin password
  (see `docs/usage_docs/02-configuration.md` for every variable, incl. OIDC, SMTP and the script-pool limits).
- The image build **fails** if the JVM sidecar classes were not produced (the `build:sidecar` npm step otherwise skips
  silently when `javac` is missing).
- The Angular app is not in this image: serve `jbpm-engine/app` from any static host and proxy `/api` and `/ws` to port 4000.
- Health check: `GET /api/health`. Runs as the non-root `node` user; the sidecar JVM is capped at 25% of container memory.
