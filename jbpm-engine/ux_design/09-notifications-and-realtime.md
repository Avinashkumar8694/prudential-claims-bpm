# Notifications & Realtime

jBPM's own notification story is thin — a persistent Alerts panel in the process designer (build/
validation errors only, research §4) and task-level "notify if not started/completed" email rules
(research §4/§7), nothing resembling a unified notification center. `RealtimeService`
(`app/src/app/core/realtime.service.ts`) already gives us WebSocket infrastructure jBPM doesn't
have out of the box (topic-based pub/sub, auto-reconnect, per-instance live redraw) — this module
is a deliberate improvement over jBPM's baseline, not a parity item, and should be framed that way
when prioritizing (nice-to-have polish, not a blocking gap).

## Notification bell + panel ([03-design-system.md](./03-design-system.md) §4)

Placed in the side-nav footer area next to the user avatar/logout button. Badge shows unread
count. Click opens a dropdown (not a route — stays lightweight):

```
┌ Notifications ──────────────────────────── Mark all read ┐
│ Today                                                     │
│  ⚠ Task "Approve refund" is due in 15m           2m ago  │
│  ✓ Deployment "prod" v12 succeeded                5m ago  │
│  ✕ Instance #1092 failed at "Send Email"         12m ago  │
│ Earlier                                                    │
│  👤 You were assigned "Review claim #4021"        1h ago  │
└────────────────────────────────────────────────────────┘
```
Each row: icon by kind, one-line text, relative time, click-through to the entity (task/
deployment/instance). Grouped Today/Earlier, no infinite scroll needed for v1 — a "View all" link
at the bottom routes to a full-page list only if the dropdown proves too small in practice.

## Event catalog (what generates a notification)

| Event | Trigger | Recipient(s) |
|---|---|---|
| Task assigned to you | task created/forwarded/reassigned with you as actor, or added to your group | assignee (and group members for group tasks) |
| Task SLA at risk / breached | `dueAt` crosses the warning threshold (System Settings, [07](./07-module-admin-iam.md)) | actual/potential owner, business admin |
| Instance failed | engine records an error on an instance | initiator, project contributors with `workflow:view` |
| Deployment succeeded / failed | deploy/activate/undeploy completes | actor who triggered it, project contributors |
| Reminder sent (Admin tab action, [06](./06-module-tasks.md)) | business admin manually sends | task's actual owner |
| Role/permission changed | role or workflow-permission update | *(audit-log only, not a push notification — avoid alert fatigue for admin-only changes)* |

## Delivery

- **In-app (v1, P1 roadmap)**: `RealtimeService` gets one new topic, `notifications:<userId>`,
  pushed by the backend whenever an event above fires; the bell panel subscribes the same way the
  Instances Diagram tab subscribes to `instance:<id>` today — no new client infrastructure pattern,
  just a new topic.
- **Persisted log**: notifications need a backing store (a `Notification` entity — id, userId,
  kind, entityRef, read, createdAt) so the panel survives a page reload and "mark all read" is
  real state, not session-only. Small, additive backend work.
- **Email (P2 roadmap, needs System Settings' email config, [07](./07-module-admin-iam.md))**: only
  for the two events that genuinely warrant leaving the app — SLA breach and task-reminder-sent —
  not a blanket "email everything" firehose. jBPM's own notification rules are similarly narrow
  (time-based, task-scoped) rather than a general pub/sub-to-email system; matching that
  restraint is deliberate, not an oversight.

## What's explicitly not being built

A full notification-preferences screen (per-event-type opt in/out per channel) — jBPM has no
equivalent at all, and building a preferences UI before there's more than a handful of event types
is exactly the kind of speculative flexibility the project avoids elsewhere. If/when the event
catalog above grows meaningfully, revisit.
