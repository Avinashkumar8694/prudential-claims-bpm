# jBPM Engine — Usage Documentation

This folder is the **user/operator-facing** documentation set: how to install, configure, and use the
engine and its Angular builder. It is separate from `../` (the numbered `01-`…`17-` documents), which
are the internal architecture/design specs written during the build — read those if you're modifying
the engine itself; read this folder if you're *running* or *using* it.

## Guides

| # | Document | Covers |
|---|---|---|
| 1 | [Getting started](01-getting-started.md) | Prerequisites, install, first run (file store and Postgres), first login |
| 2 | [Configuration reference](02-configuration.md) | Every environment variable, and every System Settings field (incl. quotas) |
| 3 | [Authentication & authorization](03-authentication-and-authorization.md) | Login, JWT, roles, permissions, groups, task-level segregation of duties |
| 4 | [Projects & processes](04-projects-and-processes.md) | Folders, projects, branches, versions/drafts, publish, the process canvas |
| 5 | [Deployments & environments](05-deployments-and-environments.md) | Deploy, activate, tag, rollback, undeploy, archive |
| 6 | [Running & monitoring instances](06-running-and-monitoring-instances.md) | Start, signal, suspend/resume/abort, retry, variables, diagram, history |
| 7 | [Human tasks](07-human-tasks.md) | Task inbox, claim/complete/skip, forms, comments, SLA |
| 8 | [Jobs, timers & scheduling](08-jobs-timers-and-scheduling.md) | Durable timers, cron/cycle starts, the Jobs & Timers screen |
| 9 | [Execution errors, audit & notifications](09-execution-errors-audit-and-notifications.md) | The Execution Errors queue, the Audit Log, in-app notifications |
| 10 | [Security & quotas](10-security-and-quotas.md) | Rate limits, per-tenant quotas, the script sandbox, SSRF protection, secrets |
| 11 | [Importing & exporting real jBPM](11-importing-and-exporting-jbpm.md) | kjar import, Java-dialect scripts, DMN/DRL recovery, export back to a `.bpmn2` project |
| 12 | [Reports & analytics](12-reports-and-analytics.md) | The Reports page: process, task, and SLA views |

## Reference

- **[Node reference](nodes/README.md)** — one document per node type (17 total): what it does, its
  fields, its runtime behavior, and a worked example. Use this when building or debugging a process.
- **[Asset reference](assets/README.md)** — one document per asset kind (10 total): forms, DRL
  rulesets, DMN decisions, guided tables, decision trees, scorecards, enumerations, data types,
  messages, and test scenarios.

## How to use this set

If you're new, read documents 1–3 in order, then skim the node reference once while building your
first process. Everything else is a lookup reference — come back to it when you hit that feature.
