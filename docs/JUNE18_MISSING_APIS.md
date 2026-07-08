# Missing APIs — to add to mock.ts

After reusing the endpoints the old `pru-claim-processing` already calls, only **7** endpoints
are still missing from `prudential-claims-ms/server/src/sd-services/mock.ts`.
Add them the same way existing claims endpoints are registered (served at `${serviceBasePath}/v1/...`,
`application/json`). Every request carries `piid` + `caseId` (+ `claimId` after promotion).

## Reused existing endpoints (no work needed)
| Purpose | Endpoint |
|---------|----------|
| Set case status (For Verification / Hold / Close / Pending Req / Case Updated) | `/v1/claims/status` |
| Pend Death (all policies) | `/v1/policy/status` (PUT) |
| Contestability (reads `policyFlags.isContestable`) | `/v1/claims/validate-policy` |
| MRX pull | `/v1/claims/mrx-check` |
| Per-claim STP / fast-track eligibility | `/v1/claims/check-fast-track-rule` |
| Benefit calculation | `/v1/claims/calculate` |
| Requirement notice | `/v1/claims/nigo/send` |
| AI re-classification / extraction | `/v1/claims/nigo/rerun-idp` |

---

## Verification process — 5 new

### 1. `POST /v1/claims/verification/assign`
```json
// req
{ "piid":"99812", "caseId":"UUID-1234", "queue":"VERIFICATION" }
// res
{ "verifierId":"VER-007", "status":"ASSIGNED", "assignedAt":"2026-07-08T10:00:00Z" }
```
### 2. `POST /v1/claims/verification/external`
```json
// req
{ "piid":"99812", "caseId":"UUID-1234", "sources":["ACURINT","DMF","OBITUARY","TELE_EMAIL"] }
// res
{ "results":[{"source":"ACURINT","match":true,"detail":"Identity confirmed"}], "overallOutcome":"VERIFIED" }
```
### 3. `POST /v1/claims/verification/promote`  (generates Claim ID)
```json
// req
{ "piid":"99812", "caseId":"UUID-1234", "notificationStatus":"VERIFIED_PROMOTED" }
// res
{ "claimId":"CLM-88001", "caseId":"UUID-1234", "status":"VERIFIED_PROMOTED" }
```
### 4. `POST /v1/claims/verification/notify-promotion`
```json
// req
{ "piid":"99812", "caseId":"UUID-1234", "claimId":"CLM-88001", "recipients":["CLAIMANT","BENEFICIARIES"] }
// res
{ "notificationSent":true, "claimFormSent":true, "sentAt":"2026-07-08T10:05:00Z" }
```
### 5. `POST /v1/claims/verification/notify-closure`
```json
// req
{ "piid":"99812", "caseId":"UUID-1234" }
// res
{ "notificationSent":true, "sentAt":"2026-07-08T10:07:00Z" }
```

---

## System Claim process — 2 new

### 6. `POST /v1/claims/stp-aggregate`  (drives the Outcome gateway)
```json
// req
{ "piid":"99812", "caseId":"UUID-1234", "claimId":"CLM-88001", "applicablePolicies":["POL-12345","POL-98765"] }
// res
{ "caseStpEligible":true, "outcome":"STP" }   // outcome ∈ STP | PENDING_REQ | EXAMINER
```
### 7. `POST /v1/claims/assign-examiner`
```json
// req
{ "piid":"99812", "caseId":"UUID-1234", "claimId":"CLM-88001", "reason":"REFERRED" }  // or "PENDING_TIMEOUT"
// res
{ "examinerId":"EXM-042", "status":"ASSIGNED_TO_EXAMINER", "assignedAt":"2026-07-08T10:12:00Z" }
```

---

## Branch toggles (for testing)
- `stp-aggregate`: caseId contains `PENDING` → `outcome:"PENDING_REQ"`; `EXAMINER` → `outcome:"EXAMINER"`; else `STP`.
- `validate-policy` (contestability): caseId contains `CONTEST` → `policyFlags.isContestable:true` (already supported in mock.ts).
- `check-fast-track-rule` (per-claim STP): caseId contains `FASTTRACKFAIL` → `isFastTrackRuleClear:false` (already supported).
- Verification decision (Promote/Hold/Close) is set by the `Update Decision` user-task output `verificationDecision`.

> Optional: `stp-aggregate` could also be computed in-process from per-claim `check-fast-track-rule` results (script), and `assign-examiner` could reuse `/v1/claims/status` (status=`ASSIGNED_TO_EXAMINER`) — that would bring new endpoints to **0**. Kept as 2 explicit endpoints for clarity/testability.
