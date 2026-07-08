# User Task — usage guide

## 1. Details
BPMN element: `<bpmn2:userTask>`. Creates a human task in the jBPM task list and **waits** for a
human (or the task API) to complete it. Assigned via `GroupId` (a role) or actor.

## 2. Usage
Examples: verification `Review notification in workbench`, `Capture Verification findings`,
`Update Decision` (group `Verifier`); system-claim `Update followup to 30 days` (group `System`);
main-process `ExaminerReview` (group `ClaimsExaminer`).

## 3. How / when to use
- Use when the flow must pause for human judgement/input.
- Set `GroupId` to the role that owns the queue; `Skippable=false` to force completion.
- Task output variables (form fields) map back to process variables via data output associations.
- Attach a `boundary-event-timer` to escalate if the task isn't completed in time (see system-claim await).
