# Service Task (REST Work Item) — properties

| Data input | Meaning | Example |
|------------|---------|---------|
| Url | endpoint | `#{baseUrl}/v1/claims/mrx-check` |
| Method | HTTP verb | `POST` / `PUT` |
| ContentData | request body | mapped from `reqPayload` var |
| ContentType | header | `application/json` |
| HandleResponseErrors | throw on non-2xx | `true` |
| ConnectTimeout / ReadTimeout | ms | optional |
| AuthType / Username / Password / AuthUrl | auth | optional |
| Headers | extra headers | optional |
| ResultClass | deserialize target | optional |
| Data output: Result | response body | mapped to `resPayload` var |

| Element property | XML | Notes |
|------------------|-----|-------|
| taskName | `drools:taskName="Rest"` | selects the work-item handler |
| ioSpecification | dataInput/dataOutput set | declares the params above |

## Input / output mapping
Two mapping styles are used (see `_data-mapping-reference.md`):
- **from a variable**: `<dataInputAssociation><sourceRef>reqPayload</sourceRef><targetRef>..ContentData</targetRef>`
- **constant/expression**: `<assignment><from><![CDATA[POST]]></from><to>..Method</to>`
Output: `<dataOutputAssociation><sourceRef>Result</sourceRef><targetRef>resPayload</targetRef>`
