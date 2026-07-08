# Call Activity — properties

| Property | XML | Required | Notes |
|----------|-----|:--------:|-------|
| id | `id` | yes | e.g. `_V_ASSIGN` |
| name | `name` | no | Label |
| calledElement | `@calledElement` | yes | Target process id |
| independent | `@drools:independent` | jBPM | `true`/`false` |
| waitForCompletion | `@drools:waitForCompletion` | jBPM | usually `true` |
| onEntry-script | `drools:onEntry-script` | no | build `reqPayload` |
| onExit-script | `drools:onExit-script` | no | parse `resPayload` |
| ioSpecification | dataInput/Output | yes | params passed to child |

## Input / output mapping (REST-wrapper convention used here)
Inputs mapped on the call activity: `ContentData` <- `reqPayload`; `ContentType`=`application/json`;
`HandleResponseErrors`=`true`; `Method`=`POST|PUT`; `Url`=`#{baseUrl}/v1/...`.
Output: `Result` -> `resPayload`. The 16 REST param dataInputs are declared even if unmapped.
See `_data-mapping-reference.md`.
