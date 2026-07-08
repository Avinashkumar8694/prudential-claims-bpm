# Conditional Event — properties

| Property | XML | Notes |
|----------|-----|-------|
| eventType | (SDK) | `"conditional"` |
| conditionExpr | `conditionalEventDefinition/condition` (CDATA) | boolean expression |
| conditionExprLanguage | `condition/@language` | Java / MVEL |

## SDK
`{ "type":"intermediateCatchEvent", "eventType":"conditional", "conditionExpr":"return x != null;" }`
