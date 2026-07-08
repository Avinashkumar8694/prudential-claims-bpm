# Node → API Map (all BPM processes)

Base: every REST node is a `callActivity` → `pru-rest-executor`, calling `#{baseUrl}/v1/...`
where `baseUrl` = `INTEGRATION_LAYER_URL`. Backing mock: `prudential-claims-ms/server/src/sd-services/mock.ts`
(endpoints served at `${serviceBasePath}/v1/...`).

Legend: ✓ = present in mock.ts · ✗ = missing (see `JUNE18_MISSING_APIS.md`)

## 1. pru-claim-processing (main)
| Node | Method | Endpoint | mock.ts |
|------|--------|----------|:---:|
| N1 ValidateData | POST | /v1/claims/validate-data | ✓ |
| N3 LogError | POST | /v1/audit/log-failure | ✓ |
| N4 SetPendDeath | PUT | /v1/policy/status | ✓ |
| N6 CheckDocCompleteness | POST | /v1/claims/check-documents | ✓ |
| N9 PolicyValidation | POST | /v1/claims/validate-policy | ✓ |
| N9a BeneValidation | POST | /v1/claims/validate-beneficiary | ✓ |
| N10 BankValidation | POST | /v1/claims/validate-bank | ✓ |
| N11 MRXCheck | POST | /v1/claims/mrx-check | ✓ |
| N13a Fast Track Rules | POST | /v1/claims/check-fast-track-rule | ✓ |
| N14 ApplyTax | POST | /v1/claims/tax/apply | ✓ |
| N17 CalcBenefit | POST | /v1/claims/calculate | ✓ |
| N18 BeneSplit | POST | /v1/claims/beneficiary-split | ✓ |
| N19 FinalizePayment | POST | /v1/claims/finalize | ✓ |

## 2. pru-nigo-followup
| Node | Endpoint | mock.ts |
|------|----------|:---:|
| N1 SendNIGO | /v1/claims/nigo/send | ✓ |
| N1b SetStatusPendingReq | /v1/claims/status | ✓ |
| N6 ReRunIDPExtraction | /v1/claims/nigo/rerun-idp | ✓ |
| N7 UpdateClaimStatus | /v1/claims/nigo/update-status | ✓ |
| N11 AutoFollowup | /v1/claims/nigo/auto-followup | ✓ |
| N12 UpdateDeathVerification | /v1/claims/nigo/death-verification | ✓ |

## 3. pru-verification-process (NEW)
| Node | Type | Method | Endpoint | mock.ts |
|------|------|--------|----------|:---:|
| Update Case Status For Verification | REST | POST | /v1/claims/status | ✓ reused |
| Assign Case to Verifier | REST | POST | /v1/claims/verification/assign | ✗ new |
| Review notification in workbench | User task | — | (none) | — |
| Run External Verifications | REST | POST | /v1/claims/verification/external | ✗ new |
| Capture Verification findings | User task | — | (none) | — |
| Update Beneficiary contact | User task | — | (none) | — |
| Update Decision | User task | — | (none) | — |
| Set Verified_Promoted + Generate Claim ID | REST | POST | /v1/claims/verification/promote | ✗ new |
| Send email confirmation + claim form | REST | POST | /v1/claims/verification/notify-promotion | ✗ new |
| Retain case in verifier queue (Hold) | REST | POST | /v1/claims/status (status=ON_HOLD) | ✓ reused |
| Set Not_Verified_Closed (Close) | REST | POST | /v1/claims/status (status=NOT_VERIFIED_CLOSED) | ✓ reused |
| Generate and send Closure Notification | REST | POST | /v1/claims/verification/notify-closure | ✗ new |

Hand-off: Promote branch throws signal `StartSystemClaim` → starts pru-system-claim-process.

## 4. pru-system-claim-process (NEW) — reuses main-process endpoints
| Node | Type | Method | Endpoint | mock.ts |
|------|------|--------|----------|:---:|
| Set Pol Status Pend Death (all assoc.) | REST | PUT | /v1/policy/status | ✓ reused |
| Check contestability (ANY policy) | REST | POST | /v1/claims/validate-policy (reads policyFlags.isContestable) | ✓ reused |
| MRX Pull | REST | POST | /v1/claims/mrx-check | ✓ reused |
| All MRX check, Set MRX_Discrepancy | Script | — | (parses mrx-check response) | — |
| Run Per Claim Evaluation (loop) | **Multi-instance callActivity** → `pru-process-single-claim` | — | (loops `applicablePolicies`; REST is in the child) | — |
| Aggregate Case_STP_Eligible + Outcome | REST | POST | /v1/claims/stp-aggregate | ✗ new |
| Calculate Benefit Amount (STP) | REST | POST | /v1/claims/calculate | ✓ reused |
| Send Requirement eMail | REST | POST | /v1/claims/nigo/send | ✓ reused |
| Update Case + claim status Pending Req | REST | POST | /v1/claims/status | ✓ reused |
| Update followup to 30 days | User task (30-day timer) | — | (none) | — |
| Run AI Classification / extraction / validation | REST | POST | /v1/claims/nigo/rerun-idp | ✓ reused |
| Update Case data | REST | POST | /v1/claims/status (status=CASE_UPDATED) | ✓ reused |
| Assign case to examiner (timeout) | REST | POST | /v1/claims/assign-examiner | ✗ new |
| Assign case to examiner (refer) | REST | POST | /v1/claims/assign-examiner | ✗ new |

Hand-offs: STP → signal `PaymentProcess`; examiner branches → signal `ClaimExaminer`.

### Per-claim loop
`Run Per Claim Evaluation (loop)` is a **multi-instance call activity** that iterates `applicablePolicies`
and invokes the reusable child process `pru-process-single-claim` once per policy:
- passes `currentPolicy` (the loop item) + constant `caseId`, `claimId`
- collects each child's `claimResult` into the `claimResults` list
- `stp-aggregate` then consumes `claimResults` to decide the outcome.

## 5. pru-process-single-claim (NEW, reusable child — one claim per invocation)
| Node | Type | Method | Endpoint | mock.ts |
|------|------|--------|----------|:---:|
| Script_Bootstrap | Script | — | — | — |
| Evaluate Claim (Fast Track / STP) | REST | POST | /v1/claims/check-fast-track-rule | ✓ reused |

Input vars: `currentPolicy`, `caseId`, `claimId` · Output var: `claimResult` (`{policyNumber, claimStpEligible}`).

## Coverage summary
| Process | REST nodes | Reused from mock.ts | New (missing) |
|---------|-----------|--------------------|---------------|
| main | 13 | 13 | 0 |
| nigo | 6 | 6 | 0 |
| verification | 7 | status ×3 | 5 (assign, external, promote, notify-promotion, notify-closure) |
| system-claim | 11 | 9 | 2 (stp-aggregate, assign-examiner) |
| process-single-claim (child) | 1 | 1 (check-fast-track-rule) | 0 |
| **Total unique NEW endpoints** | | | **7** |

> Reworked from the first cut (15 new → 7) by reusing the endpoints the old `pru-claim-processing` already calls: `validate-policy` (contestability), `check-fast-track-rule` (STP), `mrx-check`, `calculate`, `status`, `policy/status`, plus NIGO's `nigo/send` (requirement notice) and `nigo/rerun-idp` (AI re-extraction).
