# Escalation Event — properties

| Property | XML | Notes |
|----------|-----|-------|
| eventType | (SDK) | `"escalation"` |
| escalationRef | `escalationEventDefinition/@escalationRef` | -> `<bpmn2:escalation>` id |
| cancelActivity | boundary only | true=interrupting, false=non-interrupting |

## Declaration
`declarations.escalations: [{ id, escalationCode, name }]`

## SDK
`{ "type":"endEvent", "eventType":"escalation", "escalationRef":"ESC" }`
