# Exclusive Gateway — usage guide

## 1. Details
BPMN element: `<bpmn2:exclusiveGateway>`. Two roles:
- **Diverging** (`gatewayDirection="Diverging"`): routes the token down **exactly one** outgoing
  flow whose `conditionExpression` evaluates true (optionally a `default` flow).
- **Converging** (`gatewayDirection="Converging"`): merges multiple incoming flows into one out.

## 2. Usage
Diverging: verification `Update Decision?` (Promote/Hold/Close), system-claim `Claim Type`,
`Contestable?`, `Outcome`. Converging: the `_MERGE` before per-claim evaluation joins the
non-death, not-contestable, MRX-checked, and loop-back paths.

## 3. How / when to use
- Use diverging when exactly one path should be taken; put a Java `conditionExpression` on each
  outgoing flow; consider a `default` for the else-case.
- Use converging to join alternative paths without waiting (unlike a parallel gateway).
- Conditions are Java: `return "DEATH".equals(claimType);`
