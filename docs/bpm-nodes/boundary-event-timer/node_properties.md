# Boundary Event (Timer) — properties

| Property | XML | Required | Notes |
|----------|-----|:--------:|-------|
| id / name | attrs | yes/no | e.g. `_SC_TIMER` |
| attachedToRef | `@attachedToRef` | yes | host activity id (`_SC_AWAIT`) |
| cancelActivity | `@cancelActivity` | no | default `true` |
| timeDuration | `timerEventDefinition/timeDuration` | one-of | ISO-8601 duration (`P30D`) |
| timeCycle | `timerEventDefinition/timeCycle` | one-of | repeating |
| timeDate | `timerEventDefinition/timeDate` | one-of | absolute |
| outgoing | `<bpmn2:outgoing>` | yes | escalation path |

## Effect on host
Host keeps its normal outgoing (e.g. `Documents uploaded`); timer adds the `Day 30` escalation
exit. Interrupting (`true`) cancels the open task when it fires.

## Input / output mapping
None (timer carries no business payload).
