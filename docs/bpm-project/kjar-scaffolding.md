# kjar scaffolding — pom.xml, kmodule.xml, persistence.xml, project.imports/repositories

The remaining project files that make the `.bpmn` set a buildable, importable kjar.

## pom.xml — Maven build & packaging
Declares the artifact coordinates (**GAV**), `kjar` packaging, and the `kie-maven-plugin` that
compiles processes/rules at build time.
```xml
<project ...>
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.kie.templates</groupId>
  <artifactId>prudential-claims-bpm</artifactId>
  <version>1.0.9-SNAPSHOT</version>
  <packaging>kjar</packaging>                       <!-- KEY: triggers KIE packaging -->
  <name>prudential-claims-bpm</name>
  <dependencies>
    <dependency><groupId>org.kie</groupId><artifactId>kie-api</artifactId><version>7.73.0.Final</version></dependency>
    <dependency><groupId>org.kie</groupId><artifactId>kie-internal</artifactId><version>7.73.0.Final</version></dependency>
  </dependencies>
  <build><plugins>
    <plugin><groupId>org.kie</groupId><artifactId>kie-maven-plugin</artifactId>
            <version>7.73.0.Final</version><extensions>true</extensions></plugin>
  </plugins></build>
</project>
```
Build with `mvn clean install` → produces the deployable kjar. **SDK**: generated from
`descriptor.gav` (or round-tripped verbatim).

## kmodule.xml — knowledge base / session config
`src/main/resources/META-INF/kmodule.xml`. An **empty** kmodule (as in this project) means one
default kbase containing *all* processes/rules, with a default stateful session:
```xml
<kmodule xmlns="http://www.drools.org/xsd/kmodule" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
```
Declare explicit kbases/ksessions only when you need to scope packages, set `equalsBehavior`,
`eventProcessingMode="stream"`, or multiple sessions:
```xml
<kmodule ...>
  <kbase name="claims" packages="org.jbpm" default="true">
    <ksession name="claimsSession" default="true" type="stateful"/>
  </kbase>
</kmodule>
```
**SDK**: generated (empty template) if absent, else round-tripped verbatim.

## persistence.xml — JPA (optional)
`src/main/resources/META-INF/persistence.xml` defines the JPA persistence unit (e.g.
`org.jbpm.domain`) used when `persistence-mode`/`audit-mode` in the deployment descriptor is `JPA`
(process instance state + audit logs survive restarts). Omit for in-memory/no-persistence.
**SDK**: round-tripped verbatim if present.

## project.imports / project.repositories — Business Central metadata
- `project.imports` — data-type imports (`java.lang.Number`, etc.) Business Central offers in
  expression editors. Design-time convenience; not required to build.
- `project.repositories` — Maven repositories Business Central uses to resolve dependencies.
Both are BC workbench metadata. **SDK**: round-tripped verbatim.

## Build & deploy flow
```
mvn clean install            # kie-maven-plugin compiles bpmn/rules -> <artifact>-<version>.jar (kjar)
# deploy to KIE server: register the GAV as a container (via BC or the KIE Server REST API)
```

## SDK mapping summary
| File | From JSON | Field |
|------|:---------:|-------|
| pom.xml | ✅ template | `descriptor.gav` (`groupId/artifactId/version/name/kieVersion`) |
| kmodule.xml | ✅ empty template | (or verbatim) |
| kie-deployment-descriptor.xml | ✅ generated | `descriptor.deployment` (see deployment-descriptor.md) |
| persistence.xml | ⚠️ verbatim | `descriptor.files` |
| project.imports | ✅ default template (or verbatim) | generated when absent; round-tripped verbatim when present |
| project.repositories | ✅ default template (or verbatim) | central + redhat-ga defaults; round-tripped verbatim when present |
