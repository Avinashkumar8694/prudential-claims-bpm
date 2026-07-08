# Script Task — properties

| Property | XML | Required | Notes |
|----------|-----|:--------:|-------|
| id | `id` | yes | e.g. `_BOOT` |
| name | `name` | no | Label |
| scriptFormat | `@scriptFormat` | yes | `http://www.java.com/java` (Java) |
| script | `<bpmn2:script><![CDATA[...]]>` | yes | Body; use `&amp;&amp;` for `&&` if not in CDATA |
| incoming / outgoing | elements | yes | one each (typically) |

## Input / output mapping
No `ioSpecification`. Data flows purely through **process variables** touched in the script.
Document the vars read/written as an engine-level contract:
- reads: any process variable via `kcontext.getVariable("x")`
- writes: `kcontext.setVariable("x", value)`
