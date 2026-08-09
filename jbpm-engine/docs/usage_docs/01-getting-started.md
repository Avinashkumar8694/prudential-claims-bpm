# Getting Started

## Prerequisites

- Node.js ≥ 20 (see `package.json`'s `engines`)
- A JDK on `PATH` (`javac`) — the engine compiles a small Java sidecar at dev/build time so
  `lang: 'java'` scripts (from real jBPM imports) run as real, compiled Java, not a JS approximation.
- Docker, only if you want to run against Postgres instead of the zero-setup file store.

## Install

From the `jbpm-engine/` workspace root:

```bash
npm install
```

This installs both workspaces (`server`, `app`) via npm workspaces — one `npm install` at the root is
enough.

## Run — file store (zero setup)

```bash
npm run dev
```

This starts both the API server (`http://localhost:4000`, `dev:server`) and the Angular dev server
(`http://localhost:4200`, `dev:app`) together. The server persists to `.data/` (one JSON file per
entity, per `DATA_DIR`) — nothing else to install. Open `http://localhost:4200`.

To run just one side: `npm run dev:server` or `npm run dev:app`.

## Run — Postgres store

```bash
npm run docker:up          # starts postgres:16-alpine on localhost:5433 (docker-compose.yml)
STORE=pg npm run dev:server
npm run dev:app            # in a second terminal
```

`PG_URL` defaults to `postgresql://jbpm:jbpm@localhost:5433/jbpm`, matching `docker-compose.yml` — no
extra config needed once the container is up. See [Configuration](02-configuration.md) to point at a
different Postgres instance.

## First login

On first boot, if no users exist yet, the server seeds one `admin` user (username `admin`) with the
password from `ADMIN_INITIAL_PASSWORD` (default `admin-change-me` — **set a real value outside local
dev**, see [Security & quotas](10-security-and-quotas.md)). Five other default roles are seeded
alongside it: `author`, `release`, `operator`, `worker`, `viewer` — see
[Authentication & authorization](03-authentication-and-authorization.md) for what each can do.

Log in at `http://localhost:4200/login`. You land on **Home** — your task/instance/notification
summary, not the project grid (that's the builder's view, reached via **Projects** in the sidebar).

## Where to go next

- Building your first process: [Projects & processes](04-projects-and-processes.md), then the
  [node reference](nodes/README.md).
- Running it: [Deployments & environments](05-deployments-and-environments.md), then
  [Running & monitoring instances](06-running-and-monitoring-instances.md).
- Bringing in an existing real jBPM/Business Central project instead of building from scratch:
  [Importing & exporting real jBPM](11-importing-and-exporting-jbpm.md).

## Building for production

```bash
npm run build     # tsup-bundles the server to server/dist/, ng builds the app
npm run typecheck  # tsc --noEmit on the server
npm test           # server test suite (node's built-in test runner, via tsx)
```

The server's `build:sidecar` step (compiling the Java sidecar classes) runs automatically as a
`pre*` hook before `dev`/`build`/`start`/`test` — you never invoke it directly.
