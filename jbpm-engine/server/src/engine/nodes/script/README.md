# Script Task (`script`)

## 1. Overview & Purpose
The **Script Task** executes custom procedural code synchronously inside a secure, sandboxed execution realm. It is used to perform data transformations, calculate derived variables, format payloads, or implement custom business logic directly in the process token flow.

## 2. Supported Scenarios & Behavioral Variants

### Scenario A: JavaScript Native Execution (`lang: 'js'`)
- **Behavior**: Runs natively within an isolated Node.js `node:vm` sandbox with access to `kcontext` and all in-scope process variables.
- **kcontext API**:
  - `kcontext.getVariable("key")`: Reads a process variable.
  - `kcontext.setVariable("key", value)`: Writes or updates a process variable.
  - `kcontext.getNodeInstance()`: Returns runtime node metadata (node ID, token ID).
  - `kcontext.getProcessInstance()`: Returns instance ID, process ID, and deployment ID.
  - Direct variable access: Variables are also accessible directly by name (e.g. `amount = amount * 1.1`).
- **When to Use**: Modern enterprise workflows, JSON manipulations, mathematical calculations, and array processing.

### Scenario B: Java 8 Compatibility Dialect (`lang: 'java'`)
- **Behavior**: Dispatched to the high-performance local Java sidecar subprocess. The sidecar compiles and executes real Java 8 bytecode against typed variables (`java.lang.String`, `java.lang.Integer`, `java.util.Map`, etc.) with full standard library support (lambdas, streams, `Optional`).
- **When to Use**: Migrating existing jBPM / Drools processes directly from legacy Java engines without rewriting scripts into JavaScript.

## 3. Property Reference & Possible Values

| Field | JSON Path | Type | Allowed Values | Default | Description |
|---|---|---|---|---|---|
| **Name** | `name` | `string` | Free text | `"Script Task"` | Title shown in diagrams and execution trees. |
| **Language** | `lang` | `string` | `'js'`, `'java'` | `'js'` | Execution sandbox dialect. |
| **Script Code** | `code` | `string` | Code string | `""` | The script statements executed against `kcontext`. |
| **Documentation** | `documentation` | `string` | Text notes | `""` | Documentation explaining the script logic. |

## 4. When to Use & When NOT to Use
- **Do Use**:
  - Quick, synchronous data transformations (e.g. combining `firstName` and `lastName` into `fullName`).
  - Parsing and manipulating JSON payloads before or after external API calls.
  - Setting up routing flags evaluated by downstream Exclusive Gateways.
- **Do NOT Use**:
  - Do NOT make network calls (HTTP/DB) inside a Script Task (use a **Service/REST Task** for outbound HTTP).
  - Do NOT execute long-running CPU loops (governed by `scriptTimeoutSeconds`, default 5s).
  - Do NOT spawn asynchronous worker threads (rejected by sandbox security).

## 5. Concrete Step-by-Step Examples

### Example 1: JavaScript Variable Calculation & Transformation
```json
{
  "id": "script_calc",
  "name": "Calculate Net Premium",
  "type": "script",
  "lang": "js",
  "code": "const base = kcontext.getVariable('basePremium') || 0;\nconst tax = base * 0.18;\nconst total = base + tax;\nkcontext.setVariable('totalPremium', total);\nkcontext.setVariable('taxAmount', tax);"
}
```

### Example 2: Legacy jBPM Java Dialect Execution
```json
{
  "id": "script_java",
  "name": "Java Date Formatter",
  "type": "script",
  "lang": "java",
  "code": "String customer = (String) kcontext.getVariable(\"customerName\");\nkcontext.setVariable(\"greeting\", \"Welcome back, \" + customer.toUpperCase());"
}
```

## 6. Testing Scenarios & Verification Guide
1. **Variable Mutation Test**: Pass `{ x: 10 }`; script sets `kcontext.setVariable('y', x * 2)`; verify `inst.variables.y === 20`.
2. **Timeout Enforcement Test**: Infinite loop `while(true) {}`; verify engine terminates script with `SCRIPT_ERROR: script timeout`.
3. **Quota Rejection Test**: Exceed `maxConcurrentScripts`; verify rejection with `QUOTA_EXCEEDED`.

## 7. Operational Gotchas & Edge Cases
- **Quota & Timeout Limits**: Script execution is bounded by the system setting `scriptTimeoutSeconds` (default 5s) and tenant concurrency limit `maxConcurrentScripts`.
- **Sidecar Availability**: Java dialect requires the compiled Java runtime sidecar. If Java is unavailable, scripts report a clean `SCRIPT_ERROR`.
