# Escalation Event — usage guide

## 1. Details
`<bpmn2:escalationEventDefinition escalationRef="…">`. Like a signal but attachable to activity
boundaries and capable of **non-interrupting** behaviour. Raises attention without necessarily
aborting (unlike error).

## 2. Usage
- Escalation **throw** (intermediate/end): raise an escalation (e.g. SLA breach warning).
- Escalation **boundary** (interrupting or non-interrupting) / event-subprocess start: catch it.

## 3. How / when to use
- Use for "notify/raise but keep going" semantics; pair a throw with a catching boundary/subprocess.
- Declare `<bpmn2:escalation>`; reference by `escalationRef`.
- SDK: event node with `eventType:"escalation"` + `escalationRef`.
