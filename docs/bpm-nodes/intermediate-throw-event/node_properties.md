# Intermediate Throw Event — properties

| Property | XML | Notes |
|----------|-----|-------|
| eventType | (SDK) | none / signal / message / escalation |
| signalName / messageRef / escalationRef | matching event def | per type |
| incoming / outgoing | elements | one each |

## SDK
`{ "type":"intermediateThrowEvent", "eventType":"signal", "signalName":"Go" }`
