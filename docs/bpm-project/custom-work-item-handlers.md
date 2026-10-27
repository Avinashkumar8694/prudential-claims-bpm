# Custom Work Item Handlers (Java) & custom service tasks

## What a work item handler is
A **service task** in jBPM is a `<bpmn2:task drools:taskName="X">` (or `serviceTask`). At runtime the
engine looks up a **Work Item Handler** registered under the name `X` and calls it. A handler is a
plain **Java class** implementing `org.kie.api.runtime.process.WorkItemHandler`:

```java
package com.acme;
import org.kie.api.runtime.process.*;

public class MyCustomHandler implements WorkItemHandler {
  public void executeWorkItem(WorkItem wi, WorkItemManager mgr) {
    String input = (String) wi.getParameter("input");        // task data inputs
    String output = doWork(input);
    java.util.Map<String,Object> results = new java.util.HashMap<>();
    results.put("output", output);                            // task data outputs
    mgr.completeWorkItem(wi.getId(), results);                // signal completion (async: call later)
  }
  public void abortWorkItem(WorkItem wi, WorkItemManager mgr) {
    mgr.abortWorkItem(wi.getId());
  }
}
```
`getParameter(...)` reads the task's data inputs; `completeWorkItem(id, results)` returns data outputs
(mapped back to process variables). `Rest` (the `RESTWorkItemHandler`) used throughout this project is
exactly such a handler, shipped by jBPM.

## The three places a handler is wired
1. **BPMN task** — `drools:taskName="MyCustomTask"` on the task (the SDK models this on
   `serviceTask` nodes; the REST wrapper is a specialised case).
2. **Runtime registration** — `kie-deployment-descriptor.xml` binds the name to the class:
   ```xml
   <work-item-handler>
     <resolver>mvel</resolver>
     <identifier>new com.acme.MyCustomHandler()</identifier>
     <parameters/>
     <name>MyCustomTask</name>
   </work-item-handler>
   ```
   Resolvers: `mvel` (a constructor expression — most common), `reflection`, or `spring`.
   See `deployment-descriptor.md`.
3. **Design-time definition** — `WorkDefinitions.wid` declares the palette entry + parameters/results
   (see `work-definitions-wid.md`).

## Where the Java class lives
Either **inside the kjar** (`src/main/java/com/acme/MyCustomHandler.java`, compiled by the build and
put on the container classpath), or in a **dependency jar** the kjar/kie-server has on its classpath.
Simple handlers can even be instantiated inline via the mvel `identifier` if the class is available.

## When you need one
Only for custom automated integrations beyond the built-ins (`Rest`, `WebService`, `Email`, `Log`,
`BusinessRuleTask`, `DecisionTask`). This project uses only `Rest`, so no custom Java handler is
required.

## How the SDK handles it
- **BPMN side**: a custom service task round-trips (as a first-class REST call, or via `raw`/generic
  task for other `drools:taskName`s).
- **Registration**: add a `WorkItemHandler` entry to `descriptor.deployment.workItemHandlers` — the
  SDK writes it into the generated `kie-deployment-descriptor.xml` from JSON.
- **Java source & .wid**: **not** generated from JSON — supply the `.java` (or dependency jar) and the
  `.wid` verbatim (`descriptor.files`) or add them to the project. See `descriptor-and-extra-files.md`.

## Sources
- Create a custom WorkItemHandler — https://www.mastertheboss.com/bpm/jbpm6/how-to-create-a-custom-workitem-handler-in-jbpm/
- jBPM Work Items — https://blog.kie.org/2018/04/jbpm-work-items-are-really-simple.html
