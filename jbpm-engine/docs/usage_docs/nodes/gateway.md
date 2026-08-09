# Gateway

**Category**: Gateways · **Ports**: unlimited in/out (diverging = many out; converging = many in) ·
**Palette**: Exclusive, Parallel, Inclusive, Event

## Purpose

Branches or joins the flow. The same node type handles all five BPMN gateway modes; which one applies
depends on `mode` and whether the gateway is diverging (fork) or converging (join) — inferred from how
many incoming vs. outgoing flows it actually has, not a separate field you set.

## Fields

| Field | Widget | Notes |
|---|---|---|
| `mode` | select: `exclusive`, `parallel`, `inclusive`, `event`, `complex` | Branching/joining semantics |
| `direction` | select: `Diverging`, `Converging` | Documentary — actual behavior is inferred from flow count |
| `default` | text | Flow id taken when nothing else matches (exclusive/inclusive) |

Each outgoing flow can carry a `when` condition (+ `lang`) — evaluated the same way a
[Script task](script.md) condition would be, with the same three variable-access styles.

## Behavior by mode

- **Exclusive, diverging** — takes exactly **one** flow: the first whose `when` matches, else the
  flow marked `default` (or the one flow with no condition at all, if none is explicitly marked).
- **Parallel, diverging (fork)** — takes **every** outgoing flow, spawning a token on each.
- **Parallel/Inclusive, converging (join)** — waits until a token has arrived via each incoming flow
  before continuing (`consume: true` on every arrival short of the last).
- **Inclusive, diverging** — takes **every** flow whose `when` matches; if none match, falls back to
  the flows marked `default`/conditionless (never both a match AND the default at once — the default
  is a fallback, not an always-taken flow).
- **Event, diverging** — forks onto every downstream catch (message/signal/timer/condition), but this
  models a **race**, not a real fan-out: whichever catch resolves first wins, and every sibling branch
  is automatically cancelled (its waiting token and any backing timer removed) at that point.
- **Complex** — currently evaluated the same as exclusive (first match, else default).

## Example

Exclusive with a default fallback:

```json
{ "id": "gw", "type": "gateway", "mode": "exclusive", "default": "toManualReview" }
```

```json
{ "id": "toAutoApprove", "from": "gw", "to": "autoApprove", "when": "vars.amount < 1000" }
{ "id": "toManualReview", "from": "gw", "to": "manualReview" }
```

## Gotchas

- A `java`-dialect condition binds every **declared** process variable as a bare, typed identifier
  (matching real jBPM's condition dialect) — a `js` condition binds bare names too but without static
  typing.
- Converging gateways count arrivals by history, not by currently-active tokens — don't reuse the same
  join node id for two structurally different merge points in the same process.
