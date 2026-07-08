# User Task — properties

| Data input | XML name | Notes |
|------------|----------|-------|
| TaskName | `TaskName` | logical task name (form key) |
| Skippable | `Skippable` | `true`/`false` |
| GroupId | `GroupId` | owning role/queue (e.g. `Verifier`) |
| Priority / Comment / Description | optional | |
| Actors | `ActorId` | specific user assignment (alt to GroupId) |

| Element property | XML | Notes |
|------------------|-----|-------|
| id / name | attrs | |
| ioSpecification | dataInputs (+ outputs) | inputs above; outputs = form fields |

## Input / output mapping
Inputs set by constant assignment (`TaskName`,`Skippable`,`GroupId`).
Outputs (form results) map via `dataOutputAssociation` to process variables, e.g. the
`Update Decision` task should output `verificationDecision` (PROMOTE|HOLD|CLOSE).
