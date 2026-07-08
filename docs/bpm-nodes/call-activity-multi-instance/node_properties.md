# Call Activity (Multi-Instance) — properties

| Property | XML | Notes |
|----------|-----|-------|
| calledElement | `@calledElement` | child process id |
| isSequential | `multiInstanceLoopCharacteristics/@isSequential` | `true`=one-at-a-time, else parallel |
| loopDataInputRef | child element | the collection dataInput to iterate |
| loopDataOutputRef | child element | the collection dataOutput to collect into |
| inputDataItem | child element (id+name) | per-iteration element -> child input var |
| outputDataItem | child element (id+name) | child output var collected per iteration |
| completionCondition | child element | optional early-exit expression |

## Input / output mapping
- collection in: `dataInputAssociation` `applicablePolicies` -> `IN_COLL` dataInput; `loopDataInputRef`=IN_COLL.
- per-item: `inputDataItem name="currentPolicy"` -> passed to child (name-matched to child variable).
- constants per instance: normal `dataInputAssociation` (e.g. `caseId`,`claimId`).
- collection out: `outputDataItem name="claimResult"` collected via `loopDataOutputRef`=OUT_COLL
  -> `dataOutputAssociation` OUT_COLL -> `claimResults`.

## Effect / semantics
Parent waits for all instances (waitForCompletion). `claimResults` = list of each child's
`claimResult`. No ordering guarantee when parallel.
