# Intermediate Throw Event — usage guide

## 1. Details
`<bpmn2:intermediateThrowEvent>` — sits in the flow and **throws** (emits) something, then continues:
none (pass-through), signal, message, escalation, link, compensation.

## 2. Usage
Broadcast a signal / send a message / raise an escalation mid-flow without ending the branch.

## 3. How / when to use
- Use to notify other flows while continuing (e.g. throw a signal a parallel branch waits on).
- SDK type `intermediateThrowEvent` with `eventType` + the matching ref (`signalName`/`messageRef`/`escalationRef`).
