# Exclusive Gateway — properties

| Property | XML | Notes |
|----------|-----|-------|
| id / name | attrs | name shown for diverging decisions |
| gatewayDirection | `@gatewayDirection` | `Diverging` or `Converging` |
| default | `@default` | optional default outgoing flow id |
| incoming | `<bpmn2:incoming>` | 1 (diverging) or many (converging) |
| outgoing | `<bpmn2:outgoing>` | many (diverging) or 1 (converging) |

## Condition expressions (on the OUTGOING sequence flows, not the gateway)
```xml
<bpmn2:sequenceFlow id="_fdeath" name="Death" sourceRef="_XG_TYPE" targetRef="_SC_PEND">
  <bpmn2:conditionExpression xsi:type="bpmn2:tFormalExpression"
     language="http://www.java.com/java"><![CDATA[return "DEATH".equals(claimType);]]></bpmn2:conditionExpression>
</bpmn2:sequenceFlow>
```

## Input / output mapping
None — routing only. Decisions read process variables inside condition expressions.
