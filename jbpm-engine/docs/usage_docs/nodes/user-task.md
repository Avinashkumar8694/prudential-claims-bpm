# User Task

**Category**: Tasks · **Ports**: 1 in, 1 out · **Palette**: User Task

## Purpose

A human task — creates a work item in the [Task Inbox](../07-human-tasks.md) and waits until someone
completes (or skips) it.

## Fields

| Field | Widget | Notes |
|---|---|---|
| `group` (Group / role) | text | Who can claim it — matched against the acting user's IAM groups |
| `assignee` (Assignee) | text | A specific user instead of/in addition to a group |
| `businessAdmin` | text | Can claim/complete/reassign regardless of group/assignee/`excludedOwners` |
| `excludedOwners` | stringlist | Users who may NOT claim/complete even if in `group` (segregation of duties) |
| `form` (Form name) | assetRef → [forms](../assets/forms.md) | Renders a real form instead of a raw JSON editor |
| `priority` | number | Inbox sort order only, no behavioral effect |
| `dueDate` (Due date / SLA) | text | `PT8H` (relative) or an absolute date — drives the SLA indicator |
| `skippable` | bool | Whether **Skip** is available instead of requiring completion |
| `description` | textarea | Shown on the task |
| `inputs` (Task inputs) | keyval, value = `$processVar` or literal | taskVar ← processVar, seeds the form |
| `outputs` (Task outputs) | keyval, key = process variable | processVar ← taskVar, applied when completed |

## Behavior

Creates a `Task` row (`status: 'created'`) and parks the token on `wait: { kind: 'task' }`. The task's
`inputs` are computed once at creation (`$var` reads the process variable at that moment — later
changes to the process variable don't retroactively update an already-created task's inputs).
Completing the task (`TaskService.complete`) applies `outputs` back into the process variables and
resumes the token. See [Human tasks](../07-human-tasks.md) for the full lifecycle (claim/start/stop/
complete/skip/delegate/forward) and the ownership rules that gate each action.

## Example

```json
{
  "id": "approve", "type": "userTask", "name": "Approve claim",
  "group": "claims-examiners", "form": "ClaimApproval", "dueDate": "PT8H",
  "inputs": { "amount": "$claimAmount", "policyNumber": "$policyNumber" },
  "outputs": { "decision": "approvalDecision", "notes": "approvalNotes" }
}
```

## Gotchas

- `group`/`assignee` alone don't bypass [IAM authorization](../03-authentication-and-authorization.md)
  — even an `admin`-role user must actually be a member of `group` (or be the `assignee`/
  `businessAdmin`) to claim/complete it. This matches real jBPM's segregation-of-duties design; it is
  not a bug if an admin can't complete a task they're not assigned to.
- Without a `form`, the Task Detail page falls back to a raw field editor for `inputs`/`outputs` — set
  a real [form asset](../assets/forms.md) for anything a real user will fill out.
