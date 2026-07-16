# Claims & Policy Status Reference

> **Scope.** This document catalogues every **status** in the WS2 Claims solution — for **both the claim/case and the policy** — with, for each value: when it is **updated (set)**, when it is **used (read)**, and a **comment** on its intent. Derived from the four BRDs, `mock_server/server.js` / `swagger.json`, and the jBPM processes (`src/main/resources/**/*.bpmn`).
>
> Companion: see [claims_flags.md](claims_flags.md) for **flags**.

---

## 0. The golden rule: two independent status axes

There are **two separate status axes** that must never be conflated (Workbench BRD, Data Model Reference):

| Axis | Field | System of record | Changes often? |
|------|-------|------------------|----------------|
| **Case / Claim workflow status** | `CASE.CASE_STATUS` | The workflow engine (jBPM) | Yes — moves through the full lifecycle |
| **Policy status** | `POLICY.STATUS` (FAST) | PAS / FAST | No — updated at only **3 points** |

> **WB decision.** *"FAST policy status is updated only at death-claim submission, the rescind decision, and TI approval — distinct from `CASE_STATUS`."* The workbench **surfaces** policy status but is not its owner; it **drives** `CASE_STATUS`.

---

## 1. Case / Claim Status — `CASE.CASE_STATUS` (WB-5)

A **single workflow status** (there is no separate "decision axis"; decision outcomes are statuses the workflow passes through). Displayed as a coloured pill in the Workbench header and as the Inbox "Case Status" column. Set exclusively by workflow transitions. *Evolving set; `Appeal` reserved for future.*

Values **in flow order**:

| # | Status | When it is **set** | When it is **used / read** | Comment |
|---|--------|--------------------|-----------------------------|---------|
| 1 | `Notification` | First notice of a death/TI event received, before a formal claim | Inbox intake; verifier picks up | Track-B entry point (external notification) |
| 2 | `For Verification` | Verifier needs to capture external death evidence (Track B) | **Verifier** role inbox filter | Verifier does Promote / Hold / Decline |
| 3 | `Claim Submitted` | Track A: claimant submits · Track B: verifier **Promotes** | Start of the internal pipeline | Promote = the Track-B equivalent of Submit |
| 4 | `For Examination` | Outcome gateway routes to a human (refer-to-examiner, non-contactable pending, NIGO Day-30 escalation); **all TI** cases | **Examiner** role inbox filter | Distinguishes examiner work from verifier work in the mixed inbox |
| 5 | `Pending` | A blocking dependency exists (referral, medical review, awaiting docs / claim form) | Examiner worklist; SLA clock | **One** Pending status — the *reason* shows as a task, not a separate status (#32) |
| 6 | `Pending Received` | The awaited item (doc/form/response) arrives | Examiner re-engages the case | Signals the pending dependency is satisfied |
| 7 | `Approved` | Examiner records an approve decision | → transitions toward `For Payment` | Decision outcome (not a separate axis) |
| 8 | `Rejected` | Examiner records a reject decision | Terminal (pre-payment) | Human decision only (`AD-6`: no auto-denials) |
| 9 | `Rescinded` | Contestable-window rescission decision | **Also updates POLICY status** (§2) | One of the 3 policy-status update points |
| 10 | `For Payment` | Approved/Rescinded case handed to the Payment lane | Payment lane picks up | Workbench orchestrates; it does **not** compute benefit |
| 11 | `Settled` | Payment disbursed | Case nears closure | Payment lane sets this |
| 12 | `APO` | 3 unsuccessful NIGO follow-up cycles exhausted | NIGO sub-process terminal route | **A**bandoned **P**roperty **O**ffice hand-off |
| 13 | `Reversed` | `Reverse Pend_Death` executed (pre-payment only, `AD-22`/`AD-27`) | Rolls a case back out of pending-death | Pre-payment boundary only |
| 14 | `Closed` | Case fully concluded | Terminal | Final state |
| — | `Appeal` | *(reserved — future)* | — | Not in MVP |

> **How it is used:** (a) **Inbox visibility** — Alpha filters the mixed inbox by the statuses each role handles (`For Verification` → Verifier; `For Examination` etc. → Examiner). (b) **SLA** — the clock (default 2 days from assignment) runs against the current status. (c) **Routing** — the workflow's gateways transition between these values.
>
> **Open point:** mapping this workbench set to the **FAST case status** (system-of-record reconciliation) is pending the data-model sync (US 13.01 open point).

### 1.1 Notification status — Track B verification axis (`pru-claim-verification`)

Before a Track B case becomes a formal claim it exists as a **notification** that the Verifier works. The verification process (`pru-claim-verification.bpmn`) drives a small notification-status axis that is **distinct from** `CASE_STATUS` and feeds into it on Promote. The Verifier's `Update Decision` user task sets `verifierDecision` (`PROMOTE` / `HOLD` / `CLOSE`), which the gateway routes on.

| Notification status | Set by (verification node → mock endpoint) | When it is **set** | When it is **used** | Comment |
|---------------------|--------------------------------------------|--------------------|---------------------|---------|
| `FOR_VERIFICATION` | Update Case Status → `POST /v1/claims/status` (status=`FOR_VERIFICATION`) | On process start, before assignment | Verifier inbox filter (→ `CASE_STATUS = For Verification`) | Uses the shared status API (same one NIGO uses) |
| `VERIFIED_PROMOTED` | Promote → `POST /v1/claims/verification/promote` | Verifier chooses **Promote to Claim** | Generates the `caseId` (one per case, **no claim id** — a case has multiple claims); hands off to **System Claim Process** | Track B equivalent of Track A Submit — formal claim begins (→ `CASE_STATUS = Claim Submitted`) |
| `ON_HOLD` | Verifier chooses **Hold** (status update handled **internally**) | Verifier chooses **Hold** | Control **loops straight back to the `Claims Verifier` task**, re-assigned to the **same user** (via `ActorId`) | No process node/endpoint for Hold — the verifier keeps working the same case |
| `NOT_VERIFIED_CLOSED` | Close → `POST /v1/claims/verification/close` | Verifier chooses **Close** | Followed by a closure notification; terminates the case | → `CASE_STATUS = Closed`; process ends via a terminate end-event |

> **Promote hand-off.** On `VERIFIED_PROMOTED` the verification process invokes `prudential-claims-submission.pru-claim-processing` as a **call activity** (`System Claim Process`), passing `caseId`, `claimType`, `policyNumber`, `applicablePolicies`, and event/document context — **no claim id** (the main process derives the claim ids per-case via **Get Claim IDs**). This is the entry point from Track B into the main internal-processing pipeline.

---

## 2. Policy Status — `POLICY.STATUS` (FAST / PAS)

### 2.1 Baseline PAS values (read-only, shown at policy lookup)

Displayed transparently at policy search / "Policies Found" (US 2.03) **without alteration** — a non-Active status is shown as-is so the claimant/examiner sees reality.

| Value | Meaning | Comment |
|-------|---------|---------|
| `Active` / `In Force` | Policy in force, premiums current | Normal happy-path |
| `Lapsed` | Coverage dropped for non-payment | Drives `hasLapseAlert`; timeline shows a red "no coverage" band |
| `In Grace` | Within the grace period after a missed premium | Coverage conditional |
| `Reinstated` | Reinstated after lapse | A reinstatement inside the contestable window "restarts the contestable window" |
| `Terminated` | Policy ended | Not claimable |
| `Other` | Any other PAS status | Displayed verbatim |

### 2.2 Claims-driven policy status updates — **only 3 points**

Per the WB decision, the claims solution writes policy status at exactly these moments (via `PUT /api/v1/policy/status`, Node **N4: SetPendDeath**):

| Update point | New status | When it is **set** | Comment |
|--------------|-----------|--------------------|---------|
| **1. Death-claim submission** | `PENDING_DEATH_CLAIM` | Right after data validation passes, before document/policy checks (Node N4) | Locks the policy against conflicting servicing while the claim runs; `pasLockStatus` variable captures the mainframe response |
| **2. Rescind decision** | `Rescinded` | When the examiner records a contestable-window rescission (`CASE_STATUS = Rescinded`) | The claim axis and policy axis move together only here |
| **3. TI approval** | *(accelerated-benefit endorsement)* | When a TI claim is approved | TI is an acceleration against the in-force policy, not a death termination |

> **How it is used:** (a) as an **input flag** — the re-queried policy status feeds `validationPassed` and `policyFlags.isActive/hasLapseAlert`, which feed the derived `flagContestable`; (b) to **prevent double-processing** (the `PENDING_DEATH_CLAIM` lock); (c) on the **policy event timeline** in the Workbench (issue / lapse / reinstatement bands).
>
> The mock's `PUT /api/v1/policy/status` echoes `{ policyNumber, status, updatedAt }` for each `applicablePolicies` entry, defaulting `status` to `PENDING_DEATH_CLAIM`.

---

## 3. Internal claim-processing statuses (jBPM / integration APIs)

Transient outcome statuses produced by the mock/integration APIs during the internal pipeline. They are read by BPMN gateways, not stored on `CASE.CASE_STATUS`.

| Status value | Source API | When it is **set** | When it is **used** | Comment |
|--------------|-----------|--------------------|---------------------|---------|
| `PENDING_REQUIREMENTS` | `POST /api/v1/claims/status` (NIGO) | When NIGO detects missing/insufficient documents | NIGO follow-up loop | Corresponds to `CASE_STATUS = Pending` (awaiting docs) |
| `verificationStatus` = `VERIFIED` / `FAILED` | `POST /api/v1/claims/nigo/death-verification` | After an examiner death-verification attempt in NIGO | Node **N13: ExaminerDeathVerif** routing | `FAILED` re-loops or escalates |
| `payoutStatus` = `SUCCESS` / `FAILED` | `POST /api/v1/claims/finalize` | On EFT finalisation (death) | Gateway **"Payment Route?"** completion | `FAILED` → payment retry/exception |
| KNECT `success` (+ `knectTransactionId`) | `POST /api/v1/claims/ti-knect-payment` | On TI accelerated-benefit payment | TI payment completion | `KNECTFAIL` scenario returns a gateway timeout |
| `allDocsReceived` (true/false) | `POST /api/v1/claims/nigo/update-status` | Each NIGO status check | Gateway **"All Docs Received?"** | Drives loop exit vs continue chasing |

---

## 4. Document statuses — `CLAIM_DOCUMENT`

Two fields on each document: `STATUS` (upload lifecycle) and `VALIDATION_STATUS` (AI classification/extraction lifecycle).

| Field / value | When it is **set** | When it is **used** | Comment |
|---------------|--------------------|---------------------|---------|
| `STATUS = UPLOADED` | On successful file upload (US 4.01) | Progress indicator; extraction trigger | `UPLOADED_BY = CLAIMANT` |
| `VALIDATION_STATUS = PENDING` | At record creation, before classification | — | Initial state |
| `VALIDATION_STATUS = CLASSIFIED_PENDING_EXTRACTION` | AI classification confirms the file matches the expected slot | Extraction pipeline picks it up (US 4.02) | Shows the ✓ indicator |
| `VALIDATION_STATUS = OVERALL_VALIDATED` (`= TRUE`) | Extraction + cross-validation complete | Sets downstream flags (e.g. conservatorship → `INCAPACITATED_FLAG`) | Feeds discrepancy flags |
| `UPLOAD_SOURCE` | On any upload (incl. examiner out-of-channel) | Provenance | Workbench Documents page |

> **How it is used:** the **"Docs OK?"** gateway (`allDocsVerified`) and the NIGO loop depend on document validation states; the Workbench Documents page surfaces per-document status.

---

## 5. Claim-form status — `CLAIM_BENEFICIARY.CLAIM_FORM_STATUS`

Per-beneficiary claim-form lifecycle (Workbench US 13.04, Annex E). **No expiry / no "valid until".**

| Value | When it is **set** | When it is **used** | Comment |
|-------|--------------------|---------------------|---------|
| `Sent` | On **Send** (bene/authority newly identified with email, or email changed) | Overview/Documents status | Recipient = bene if able to act, else the captured authority |
| `Completed` | Recipient completes & returns the form | `ALL_BENE_CLAIM_FORMS_COMPLETE` roll-up | Feeds case completion % |
| `No contact info` | No email/phone captured yet | Disables **Send** | Tracing item raised instead |

> **Single-sourced:** the same status record is read/written from both the Claimant & Beneficiaries page (in-context) and the Documents page (consolidated). Every Send/Reissue appends a status line (action, time, actor).

---

## 6. Beneficiary living status & capacity — `CLAIM_BENEFICIARY`

Not a workflow status, but a party state that gates authority handling (Workbench US 13.04, Annex B).

| Field | Values | When it is **set** | When it is **used** | Comment |
|-------|--------|--------------------|---------------------|---------|
| Living status | `Living` (default) / `Deceased` | Default `Living` (assume living unless proven); examiner sets `Deceased` with date+basis | `Deceased` → opens estate-handling item; recipient becomes estate executor | **No "Unknown"** — an untraced bene raises a tracing item instead |
| Capacity | `Able to act for self` / `Minor` / `Requires representative` | Age-derived (Minor < 18, state-configurable); examiner editable | Drives guardian/representative authority block | Hidden when `Deceased` |
| Authority validation outcome | `Validated` / `Not validated` | Examiner judgement | **Resolves** the authority open item | The act that clears the authority item |

---

## 7. Update-point summary (who writes what, when)

| Trigger event | Case status → | Policy status → | Notes |
|---------------|---------------|-----------------|-------|
| Track-A submit / Track-B promote | `Claim Submitted` | `PENDING_DEATH_CLAIM` (death) | Node N4 sets the policy lock |
| Validation fails (N1) | *(stays; error logged)* | — | `validationErrors` audited; no auto-denial |
| Docs incomplete (N6) | `Pending` (`PENDING_REQUIREMENTS`) | — | NIGO sub-process starts |
| NIGO docs received | `Pending Received` | — | Loop exits |
| 3 NIGO cycles exhausted | `APO` | — | Abandoned Property Office |
| Routed to human | `For Examination` | — | Fast-track/contestable gate → examiner |
| Examiner approves | `Approved` → `For Payment` | — (TI approval → endorsement) | Decision recorded in Workbench |
| Examiner rejects | `Rejected` | — | Terminal, pre-payment |
| Rescind decision | `Rescinded` | `Rescinded` | Both axes move together |
| Payment disbursed | `Settled` | — | Payment lane |
| Reverse Pend_Death | `Reversed` | *(lock released)* | Pre-payment only (`AD-22`/`AD-27`) |

---

## 8. Open points to confirm

- **FAST mapping.** The workbench `CASE_STATUS` set → FAST case-status mapping is pending the data-model sync (US 13.01).
- **Policy-status write-back.** Confirm whether claims-side address/status changes flow through to PAS or stay claims-side (US 13.04 open point).
- **SLA storage.** Where the SLA target and per-stage timing are stored is parked (WB-14).
- **TI approval policy endorsement.** Confirm the exact policy-status value written on TI approval (the 3rd update point) against the TI BOG.
