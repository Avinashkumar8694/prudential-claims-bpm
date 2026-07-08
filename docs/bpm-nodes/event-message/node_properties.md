# Message Event — properties

| Property | XML | Notes |
|----------|-----|-------|
| eventType | (SDK) | `"message"` |
| messageRef | `messageEventDefinition/@messageRef` | -> `<bpmn2:message>` id |
| position | start / intermediateCatch / intermediateThrow / end / boundary | |

## Declaration
`declarations.messages: [{ id, name, itemRef }]` + an `itemDefinition` for the payload type.

## SDK
`{ "type":"startEvent", "eventType":"message", "messageRef":"MSG" }`
