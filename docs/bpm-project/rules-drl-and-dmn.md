# Rules & Decisions — DRL / DMN and the Business Rule Task

## What they are
- **DRL** (`.drl`) — Drools Rule Language files: `when <conditions> then <actions>` rules that the
  KIE engine evaluates against facts (process variables/objects).
- **DMN** (`.dmn`) — Decision Model & Notation files: business decision tables / logic authored to
  the DMN standard, evaluated by the Kogito/Drools DMN engine.

Both live in `src/main/resources/` of the kjar and are compiled by the `kie-maven-plugin` at build.

## How a process uses them — the Business Rule Task
A `<bpmn2:businessRuleTask>` (see `../bpm-nodes/business-rule-task/`) delegates a decision to rules:

### DRL via ruleflow-group
```xml
<bpmn2:businessRuleTask id="_br" drools:ruleFlowGroup="validateClaim"
                        implementation="##unspecified" name="Validate"/>
```
```drl
package com.acme.rules;
rule "reject large claim"
  ruleflow-group "validateClaim"          // <-- matches the task's ruleFlowGroup
  when   $c : Claim( amount > 500000 )
  then   $c.setStatus("REFER"); update($c);
end
```
When the token reaches the task, the engine fires all rules in that `ruleflow-group` against the
current session facts. Process variables are the facts (insert/update them from scripts or make them
process globals).

### DMN
```xml
<bpmn2:businessRuleTask id="_d" implementation="http://www.jboss.org/drools/dmn" name="Eligibility">
  <bpmn2:extensionElements>
    <drools:metaData name="Namespace"><drools:metaValue>https://acme/dmn/eligibility</drools:metaValue></drools:metaData>
    <drools:metaData name="Model"><drools:metaValue>Eligibility</drools:metaValue></drools:metaData>
    <drools:metaData name="Decision"><drools:metaValue>isEligible</drools:metaValue></drools:metaData>
  </bpmn2:extensionElements>
  <!-- ioSpecification maps process variables <-> DMN inputs/outputs -->
</bpmn2:businessRuleTask>
```
The task's data inputs become DMN input data; outputs are written back to process variables.

## kmodule.xml and rules
An empty `kmodule.xml` gives a default kbase that includes **all** rules/processes in the kjar. To
scope rules (e.g. separate kbases/ksessions or event-processing mode), declare `<kbase>`/`<ksession>`
in `kmodule.xml` (see `kjar-scaffolding.md`). Rules must be in the **same kjar** as the process.

## When you need them
Only if a process contains a `businessRuleTask`. The processes in *this* project use REST service
tasks and gateways, not rules — so there are currently **no** `.drl`/`.dmn` files.

## How the SDK handles them
`.drl`/`.dmn` are **not** generated from JSON (they're authored rule/decision assets). The SDK
models the `businessRuleTask` node (ruleFlowGroup/implementation) so the BPMN wiring is first-class,
but the rule/decision **file content** must be supplied verbatim via `descriptor.files` (e.g.
`descriptor.files["src/main/resources/com/acme/rules/validate.drl"] = "<drl text>"`) or added to the
project directly. The `kie-maven-plugin` compiles them on build. See `descriptor-and-extra-files.md`.

## Sources
- jBPM Processes (business rule task) — https://docs.jbpm.org/7.0.0.Beta1/jbpm-docs/html/ch07.html
- Drools rule language & kmodule — https://docs.drools.org/
