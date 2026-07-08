# kie-deployment-descriptor.xml — runtime configuration

## What it is
`src/main/resources/META-INF/kie-deployment-descriptor.xml` configures **how** the kjar runs in the
KIE server: which **work-item handlers** are bound, which **environment entries** (config values)
are available, persistence/audit mode, runtime strategy, listeners, and marshalling. It is the
**runtime** counterpart to the design-time `.wid`.

## Key sections
```xml
<deployment-descriptor xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.jboss.org/jbpm deployment-descriptor.xsd">
  <persistence-unit>org.jbpm.domain</persistence-unit>
  <audit-persistence-unit>org.jbpm.domain</audit-persistence-unit>
  <audit-mode>JPA</audit-mode>
  <persistence-mode>JPA</persistence-mode>
  <runtime-strategy>SINGLETON</runtime-strategy>        <!-- SINGLETON | PER_REQUEST | PER_PROCESS_INSTANCE -->
  <work-item-handlers>
    <work-item-handler>
      <resolver>mvel</resolver>
      <identifier>new org.jbpm.process.workitem.rest.RESTWorkItemHandler(classLoader)</identifier>
      <parameters/>
      <name>Rest</name>                                  <!-- matches drools:taskName on the task -->
    </work-item-handler>
  </work-item-handlers>
  <environment-entries>
    <environment-entry>
      <resolver>mvel</resolver>
      <identifier>"https://soar.neutrinos-apps.com/claims-ms"</identifier>
      <parameters/>
      <name>INTEGRATION_LAYER_URL</name>                 <!-- read by the bootstrap script -->
    </environment-entry>
  </environment-entries>
  <globals/> <event-listeners/> <task-event-listeners/>
  <marshalling-strategies/> <required-roles/> <remoteable-classes/>
  <limit-serialization-classes>true</limit-serialization-classes>
</deployment-descriptor>
```

## What matters most (and why this project needs it)
- **work-item-handlers**: binds task `drools:taskName` → handler class. This project needs the
  `Rest` handler so every REST call (`callActivity → pru-rest-executor → RESTWorkItemHandler`) works.
- **environment-entries**: named config values resolvable at runtime. `INTEGRATION_LAYER_URL` is read
  by each process's bootstrap script (`kcontext.getKieRuntime().getEnvironment().get(...)` / system
  property fallback) to build `baseUrl`. Change the target host here without touching the BPMN.
- **runtime-strategy**: `SINGLETON` (one shared session), `PER_REQUEST`, or `PER_PROCESS_INSTANCE`.
- **resolver**: `mvel` (constructor expression), `reflection`, or `spring`.

## How the SDK handles it
**Generated from JSON** — `descriptor.deployment` maps directly:
```jsonc
"deployment": {
  "runtimeStrategy": "SINGLETON",
  "workItemHandlers": [{ "name": "Rest", "resolver": "mvel",
    "identifier": "new org.jbpm.process.workitem.rest.RESTWorkItemHandler(classLoader)" }],
  "environmentEntries": [{ "name": "INTEGRATION_LAYER_URL", "resolver": "mvel",
    "identifier": "\"http://localhost:3000\"" }]
}
```
`parseProject` reads this file into `descriptor.deployment`; `writeProject` **regenerates** it from
that model (so you can add handlers/env entries in JSON). Add a custom handler here (see
`custom-work-item-handlers.md`).
