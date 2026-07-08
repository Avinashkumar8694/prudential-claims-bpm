# Receive Task — properties

| Property | XML | Notes |
|----------|-----|-------|
| id / name | attrs | |
| messageRef | `@messageRef` | -> `<bpmn2:message>` id |
| implementation | `@implementation` | e.g. `##WebService`, `Other` |
| operationRef | `@operationRef` | WSDL operation (optional) |

## Declaration (definitions scope)
```xml
<bpmn2:itemDefinition id="_msgItem" structureRef="String"/>
<bpmn2:message id="MSG" itemRef="_msgItem" name="Msg"/>
```

## SDK
`{ "type":"receiveTask", "messageRef":"MSG", "implementation":"##WebService" }` + `declarations.messages`.
