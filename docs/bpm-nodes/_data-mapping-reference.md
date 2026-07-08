# Data Mapping Reference

How data is declared and moved between nodes in jBPM BPMN. A generator must emit these
consistently or the file will not import / execute.

## 1. Type definitions — `itemDefinition`
Every typed thing references an `itemDefinition` (by `itemSubjectRef`). Declared at definitions scope.
```xml
<bpmn2:itemDefinition id="_caseIdItem" structureRef="String"/>
<bpmn2:itemDefinition id="_applicablePoliciesItem" structureRef="java.util.List"/>
```
Common `structureRef`: `String`, `Integer`, `java.lang.Boolean`, `java.lang.Object`,
`java.util.List`, `java.lang.Double`.

## 2. Process variables — `property`
Declared inside `<bpmn2:process>`; this is what `kcontext.getVariable("caseId")` reads.
```xml
<bpmn2:property id="caseId" itemSubjectRef="_caseIdItem" name="caseId"/>
```

## 3. Node data ports — `ioSpecification`
A task/callActivity declares its inputs/outputs and groups them into input/output sets.
```xml
<bpmn2:ioSpecification>
  <bpmn2:dataInput  id="_N_UrlInputX"    name="Url"/>
  <bpmn2:dataOutput id="_N_ResultOutputX" name="Result"/>
  <bpmn2:inputSet><bpmn2:dataInputRefs>_N_UrlInputX</bpmn2:dataInputRefs></bpmn2:inputSet>
  <bpmn2:outputSet><bpmn2:dataOutputRefs>_N_ResultOutputX</bpmn2:dataOutputRefs></bpmn2:outputSet>
</bpmn2:ioSpecification>
```

## 4. Moving values in — `dataInputAssociation` (two styles)
**A. From a process variable** (source = variable id):
```xml
<bpmn2:dataInputAssociation>
  <bpmn2:sourceRef>reqPayload</bpmn2:sourceRef>
  <bpmn2:targetRef>_N_ContentDataInputX</bpmn2:targetRef>
</bpmn2:dataInputAssociation>
```
**B. Constant / expression** (assignment):
```xml
<bpmn2:dataInputAssociation>
  <bpmn2:targetRef>_N_UrlInputX</bpmn2:targetRef>
  <bpmn2:assignment>
    <bpmn2:from xsi:type="bpmn2:tFormalExpression"><![CDATA[#{baseUrl}/v1/claims/mrx-check]]></bpmn2:from>
    <bpmn2:to   xsi:type="bpmn2:tFormalExpression">_N_UrlInputX</bpmn2:to>
  </bpmn2:assignment>
</bpmn2:dataInputAssociation>
```
`#{var}` is MVEL interpolation resolved at runtime (e.g. `#{baseUrl}`). Plain text is a constant.

## 5. Moving values out — `dataOutputAssociation`
```xml
<bpmn2:dataOutputAssociation>
  <bpmn2:sourceRef>_N_ResultOutputX</bpmn2:sourceRef>
  <bpmn2:targetRef>resPayload</bpmn2:targetRef>
</bpmn2:dataOutputAssociation>
```

## 6. On-entry / on-exit scripts (build/parse payloads)
```xml
<bpmn2:extensionElements>
  <drools:onEntry-script scriptFormat="http://www.java.com/java"><drools:script><![CDATA[
    com.fasterxml.jackson.databind.node.ObjectNode j = new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode();
    j.putPOJO("caseId", kcontext.getVariable("caseId"));
    kcontext.setVariable("reqPayload", j.toString());
  ]]></drools:script></drools:onEntry-script>
  <drools:onExit-script scriptFormat="http://www.java.com/java"><drools:script><![CDATA[
    com.fasterxml.jackson.databind.JsonNode r = new com.fasterxml.jackson.databind.ObjectMapper().readTree((String)kcontext.getVariable("resPayload"));
    kcontext.setVariable("anyContestable", r.path("policyFlags").path("isContestable").asBoolean());
  ]]></drools:script></drools:onExit-script>
</bpmn2:extensionElements>
```

## 7. REST-wrapper convention (this project)
Business REST call = call activity -> `pru-rest-executor`. Fixed input mapping:
`ContentData` <- `reqPayload` (var) · `ContentType` = `application/json` (const) ·
`HandleResponseErrors` = `true` (const) · `Method` = `POST|PUT` (const) ·
`Url` = `#{baseUrl}/v1/...` (expression). Output: `Result` -> `resPayload` (var).
Build request in on-entry, parse response in on-exit.

## 8. Escaping
Inside CDATA, `&&`/`<`/`>` are literal. Outside CDATA they must be `&amp;&amp;`, `&lt;`, `&gt;`.
