# Claims Flags Reference

> **Scope.** This document catalogues every flag used across the WS2 Claims solution — where it comes from (which API / source), what it means, and where it is consumed. It is derived from the four BRDs (`WS2_Claims_Submission_BRD_Death`, `WS2_TI_Claim_Submission_BRD`, `WS2_TIQuote_Package_BRD`, `WS2_Workbench_BRD`), the mock API contract (`mock_server/swagger.json`, `mock_server/server.js`), and the live jBPM processes (`src/main/resources/**/*.bpmn`).
>
> Companion: see [claims_status.md](claims_status.md) for claim/policy **status** values.

---

## 1. The three layers of flags

A flag travels through three distinct layers. The same business concept (e.g. "contestable") can appear in more than one layer with a different name and a different owner. Keep the layers straight — they are produced and consumed at different times.

| Layer | Store / carrier | Produced by | Consumed by | Lifecycle |
|-------|-----------------|-------------|-------------|-----------|
| **L1 — Submission-time flags** | `CLAIM_FLAG_REGISTRY` (+ a few entity fields) | The claimant intake journey (Death/TI submission screens, IDP extraction) | jBPM re-validation and the examiner workbench | Raised at submission; never blocks the claimant |
| **L2 — Internal-processing flags** | jBPM process variables | The `pru-claim-internal-processing` and `pru-nigo-followup` processes, populated from the integration/mock APIs | BPMN gateways (routing) | Live only for the duration of the process instance |
| **L3 — Per-claim evaluation / workbench flags** | Reels engine + `CLAIM_FLAG_REGISTRY` resolution layer | `Run Per Claim Evaluation` (Features 10–11) + examiner actions | The Outcome Gateway (routing) + Operational Workbench screens | Persist through examination; examiner resolves them |

> **L3 is the authoritative flag inventory** — the named `Set *_Flag` outputs of the per-claim evaluation. See §4 for the full catalogue.

### Flag-vs-field discipline (Master decision #32 / WB-6)

> `CLAIM_FLAG_REGISTRY` stores **only computed cross-cutting indicators** — multi-field comparisons or aggregations across entities. A condition that is derivable from a single entity-field read is **not** stored as a flag; the rules engine queries the field directly. This avoids data duplication and stale state.

This is why, for example, `MINOR_BENE_DETECTED` (an aggregate across all beneficiaries) is a stored flag, while "policy is lapsed" is **not** — it is read live off `POLICY.STATUS`.

---

## 2. L1 — Submission-time flags (`CLAIM_FLAG_REGISTRY`)

Raised during the claimant-facing submission journey. **None of these block submission** — they are captured for the examiner to resolve later (`AD-6`: no auto-denials). `FLAG_VALUE`, `RAISED_AT`, `RAISED_BY`, and `REASON` are populated per row.

### 2.1 Role / claimant flags

| Flag | Meaning | How we get it | Where used |
|------|---------|---------------|------------|
| `NOT_SURE_ROLE` | Claimant selected "I am not sure" for their role | Set at submission when `CLAIMANT.ROLE_TYPE = NOT_SURE` (US 2.01 / US 5.01) | Examiner resolves role in Workbench → Claimant & Beneficiaries (US 13.04) |
| `INCORRECT_CLAIMANT` | Claimant declared BENEFICIARY but the silent PAS bene-match returned `NO_MATCH` | Set at submission after the silent bene match runs (post-D5) | Examiner triggers "Incorrect Claimant" letter (BOG §7); claim proceeds to the PAS bene of record |
| `MINOR_BENE_DETECTED` | One or more beneficiaries are minors (computed aggregate across all benes) | Raised at submission (US 5.01); a genuine cross-cutting aggregate → stays a stored flag per #32 | Drives guardian-authority handling on Workbench US 13.04; feeds internal `minorDetected` (L2) |

> **Note.** "Incorrect Claimant" and "NOT_SURE role" are treated in later BRD revisions as *derived conditions* off `CLAIMANT.BENE_MATCH_STATUS` / `ROLE_TYPE` rather than stored flags. Confirm the final data-model choice during the data-model sync.

### 2.2 Event flags (Details of Passing — US 3.03)

| Flag | Meaning | How we get it | Where used |
|------|---------|---------------|------------|
| `FOREIGN_DEATH` | Death occurred outside {USA, Canada} | Set at submission if `COUNTRY_OF_DEATH ∉ {US, Canada}`; also mirrored to `CLAIM_EVENT.FOREIGN_DEATH` | Foreign-death handling; corresponds to L2 `flagForeignDeath` and Workbench `Foreign_Death` |
| `HOMICIDE_ADDITIONAL_INVESTIGATION` | Manner of death declared as Homicide | Set at submission when `MANNER_OF_DEATH_DECLARED = HOMICIDE` (per BOG, **all SS 5-year policies** trigger homicide investigation) | Workbench Event page → Homicide review section (US 13.03); resolved by "Beneficiary ruled out? = Yes" |

### 2.3 IDP extraction discrepancy flags (Review Extracted Information — US 4.02)

One `CLAIM_FLAG_REGISTRY` row per discrepancy, `FLAG_TYPE` = the enum below, `FLAG_VALUE = TRUE`, `RAISED_BY = AI_EXTRACTION`, `REASON` = short description. Raised by cross-validating declared values against document-extracted values.

| `FLAG_TYPE` | Meaning |
|-------------|---------|
| `MANNER_DISCREPANCY` | Declared manner ≠ manner read from the death certificate |
| `MARITAL_STATUS_DISCREPANCY` | Declared marital status ≠ extracted |
| `NAME_DISCREPANCY` | Declared name ≠ name on document |
| `AGE_MISSTATEMENT` | DOB/age on document ≠ policy record |
| `CONSERVATORSHIP_DECLARATION_MISMATCH` | Conservatorship document validated but conflicts with `submission_details.bene_incapacitated` |
| `FUNERAL_HOME_NAME_MISMATCH` | Funeral-home name inconsistency |

> **Soft flags (SF1–SF9).** SF-conditions are persisted as `CLAIM_FLAG_REGISTRY` rows but are **non-blocking** — the claimant proceeds without acting on them (SF1 additionally drives the Manner-Confirm section). The examiner reviews them post-submission.

---

## 3. L2 — Internal-processing flags (jBPM `pru-claim-internal-processing`)

These are the flags the **integration layer / mock APIs return** and the process stores as variables. They drive the BPMN routing gateways. This is the layer your mock APIs implement.

### 3.1 How the mock derives them (test harness convention)

The mock server (`mock_server/server.js`) derives flag values from **substrings in `caseId`** so any scenario can be exercised without a real backend. Real integrations will replace this with true system lookups; the **response shape stays identical**.

| `caseId` contains | Effect |
|-------------------|--------|
| `CONTEST` | `isContestable`/`isSuicide` true, MRX contestable alert |
| `SUICIDE` | `isSuicide` true |
| `FOREIGN` | `isForeignDeath` true |
| `AIDS` | `isAIDS` true |
| `LAPSE` / `POLICYFAIL` | policy inactive, `hasLapseAlert` true |
| `MINOR` | `minorDetected` true |
| `SANCTION` | beneficiary sanctions/identity fail |
| `BANKFAIL` | bank `ownerMatch` false |
| `NIGO` | documents missing |
| `VALFAIL` | data validation fails |
| `FASTTRACKFAIL` | fast-track rule not clear |
| `TAXEXCEPT` | tax exception review needed |
| `MISSTATE` | misstatement adjustment applied |
| `WITHHOLD` | 24% IRS backup withholding applied |

### 3.2 Flags from `POST /api/v1/claims/validate-data` → `policyFlags`

Node **N1: ValidateData**. Mapped into the four `flag*` process variables.

| API field (`policyFlags.*`) | Process variable | Meaning | Where used |
|-----------------------------|------------------|---------|------------|
| `isSuicide` | `flagSuicide` | Suicide indicator | Carried for examiner/MRX context |
| `isContestable` | *(advisory)* | Within the 2-year contestability window per data validation | **Advisory only** — the authoritative gateway flag is the derived `flagContestable` (§3.7) |
| `isForeignDeath` | `flagForeignDeath` | Foreign-death indicator | Foreign-death routing/examiner |
| `isAIDS` | `flagAIDS` | AIDS indicator | Examiner/underwriting context |
| *(top-level)* `validationPassed` | `validationPassed` | Server-side re-validation result | Gateway **"Validation Passed?"** → No routes to N3 LogError |
| `validationErrors[]` | `validationErrors` | Field/error list | Audit + error notice |

### 3.3 Flags from `POST /api/v1/claims/validate-policy` → `policyFlags`

Node **N9: PolicyValidation**. Note: this response **overwrites** the `policyFlags` variable with the policy-level set below.

| API field (`policyFlags.*`) | Meaning | Where used |
|-----------------------------|---------|------------|
| `isActive` | Policy is in force | Input to derived `flagContestable` |
| `premiumsPaid` | Premiums are current | Input to derived `flagContestable` |
| `hasLapseAlert` | Lapse alert present | Input to derived `flagContestable` |
| `validationPassed` | Policy re-validation passed | Continue vs error routing |

### 3.4 Flags from `POST /api/v1/claims/validate-beneficiary`

Node **N9a: BeneValidation**.

| API field | Process variable / carrier | Meaning | Where used |
|-----------|----------------------------|---------|------------|
| `minorDetected` | `minorDetected` | A minor beneficiary exists | Input to derived `flagContestable`; guardian handling |
| `beneficiaryFlags.identitiesVerified` | `beneficiaryFlags` | Bene identities verified | Input to derived `flagContestable` |
| `beneficiaryFlags.sanctionsChecked` | `beneficiaryFlags` | OFAC/sanctions screening clear | Input to derived `flagContestable` |

### 3.5 Flags from `POST /api/v1/claims/validate-bank` (PVS)

Node **N9b: BankValidation**.

| API field | Meaning | Where used |
|-----------|---------|------------|
| `pvsMatch` | Payment-verification-service match | Bank validation gate |
| `bankValidationResult.accountActive` | Account is active | Input to derived `flagContestable` |
| `bankValidationResult.ownerMatch` | Account owner matches payee | Input to derived `flagContestable` (`OWNER_MISMATCH` when false) |
| `bankValidationResult.routingValid` | Routing number valid | Input to derived `flagContestable` |

### 3.6 Flags from `POST /api/v1/claims/mrx-check` (Contestability / MRX)

Node **N11: MRXCheck** — runs only when the case is routed contestable.

| API field | Meaning | Where used |
|-----------|---------|------------|
| `alerts[]` (e.g. `SUICIDE_CONTESTABLE_WINDOW`) | Medical-records alerts | Examiner review |
| `mrxCheckResult.medicalRecordsMatch` | Medical records reconcile | Examiner review |
| `mrxCheckResult.preExistingExclusionsChecked` | Pre-existing exclusions checked | Examiner review |
| `mrxCheckResult.isSuicide` / `isContestable` | Confirmed suicide / contestable from MRX | Examiner review |

### 3.7 Derived flag — `flagContestable` (authoritative routing flag)

**Node `Script_CalcContestable`** computes `flagContestable` *after* policy + beneficiary + bank validation. It does **not** use `isContestable` from `validate-data`. This is the flag the **"Contestable?"** gateway actually reads.

```java
boolean contestable =
       !policyIsActive          // policyFlags.isActive == false
    || !policyPremiumsPaid       // policyFlags.premiumsPaid == false
    || policyHasLapseAlert       // policyFlags.hasLapseAlert == true
    || minorDetectedVal          // minorDetected == true
    || !beneIdentitiesVerified   // beneficiaryFlags.identitiesVerified == false
    || !beneSanctionsChecked     // beneficiaryFlags.sanctionsChecked == false
    || !bankAccountActive        // bankValidationResult.accountActive == false
    || !bankOwnerMatch           // bankValidationResult.ownerMatch == false
    || !bankRoutingValid;        // bankValidationResult.routingValid == false
```

**Meaning:** the claim is contestable / cannot be fast-tracked if **any** upstream policy, beneficiary, or bank check failed. **Used by:** gateway **"Contestable?"** → `Yes` sends the case to MRX / examiner; `No` continues toward fast-track/payment.

### 3.8 Documents & fast-track flags

| Flag | Source API | Node | Meaning | Where used |
|------|-----------|------|---------|------------|
| `allDocsVerified` | `POST /api/v1/claims/check-documents` (`allDocsVerified`, `missingDocs[]`) | N6: CheckDocCompleteness | All required docs present & verified | Gateway **"Docs OK?"** → No launches the NIGO sub-process |
| `isFastTrackRuleClear` | `POST /api/v1/claims/check-fast-track-rule` | N13a: Run Fast Track Rules | No fast-track blockers | Gateway **"All Flags and FastTrack clear?"**: routes to auto-payment vs **N13b/N16 ExaminerReview**. Combined with `flagContestable` |
| `taxExceptions` | `POST /api/v1/claims/tax/apply` | N14: ApplyTax | Manual tax-exception review needed | Gateway **"Tax Exceptions?"** → Yes routes to examiner |
| `misstatementExclusionApplied` | `POST /api/v1/claims/misstatement-adjust` | N18: MisstatementAdjust | Age/gender misstatement adjustment applied to payout | Benefit adjustment |

> **Fast-track gate logic.** The "All Flags and FastTrack clear?" gateway takes the `Yes` (auto) branch only when `isFastTrackRuleClear == true` **AND** `flagContestable != true` (per the BPMN condition on `Script_CalcContestable`'s outgoing flow). The mock's `check-fast-track-rule` treats `BANKFAIL / CONTEST / MINOR / SANCTION / LAPSE / POLICYFAIL` as blockers, mirroring the `flagContestable` inputs.

### 3.9 NIGO sub-process flags (`pru-nigo-followup`)

| Flag | Source API | Meaning | Where used |
|------|-----------|---------|------------|
| `allDocsReceived` | `POST /api/v1/claims/nigo/update-status` | Outstanding docs now all received | Gateway **"All Docs Received?"** → loop exit |
| `verificationStatus` (`VERIFIED` / `FAILED`) | `POST /api/v1/claims/nigo/death-verification` | Death verification outcome | N13: ExaminerDeathVerif routing |
| `followupCount` | `POST /api/v1/claims/nigo/auto-followup` (incremented) | Number of reminder cycles sent | Gateways **"Max Retries?" / "Continue Chasing?"** → after 3 cycles routes to **APO** (Abandoned Property Office) |

---

## 4. L3 — Per-Claim Evaluation flags (System Assessment / Features 10–11)

This is the **authoritative flag inventory** — the named `Set *_Flag` outputs of the per-claim evaluation (Features 10–11, "System Claim Assessment"). They are written by **`Run Per Claim Evaluation`** (Reels), informed by the preceding assessment tasks (`Check Contestability`, `MRX Pull`, `MRX Non-Disclosure Check`, document AI validation). Each is a `CLAIM_FLAG_REGISTRY` row per the flag-vs-field discipline (#32). They are consumed by the **Outcome Gateway** (routing) and then surfaced on the Operational Workbench as **Open items** (US 13.02–13.05), where the examiner resolves them.

**Lifecycle.** A flag is **Open** when its check outcome is `true` and unresolved; **Cleared** when the check passed, the examiner resolved it on its owning page, or a checklist item completed. Resolution is a separate workbench layer over the registry (`RESOLUTION_STATUS`, `RESOLVED_BY/AT/ACTION/RATIONALE`) — the original detection is never overwritten, and resolving never re-runs the rule (only genuinely new data does, via the re-extraction loop).

> **Producing task, per flag:** unless a more specific source is named in the "How obtained" column, the flag is set by **`Run Per Claim Evaluation`** for Death (and **`Run TI Per Claim Evaluation`** for TI, §4.7).

### 4.1 Event / proof-of-death flags (Death)

| Flag | Meaning | How obtained | Where used / resolved (Workbench) |
|------|---------|--------------|-----------------------------------|
| `Death_Unverified` | Death not yet verified with acceptable proof | True until ≥1 accepted proof captured | Event page → **"Death verified with proof"** gate = Yes |
| `Manner_Unverified` | Manner of death not validated (Natural / Accidental / Homicide / Suicide / Undetermined) | Per-claim eval; declared manner unconfirmed | Event → confirm/validate manner. **STP-critical** (`AD-24`) — unvalidated manner blocks straight-through |
| `Homicide_Hold` | Manner = Homicide → hold pending beneficiary ruled-out (all SS 5-yr policies trigger, per BOG) | Set when `MANNER = HOMICIDE` (mirrors L1 `HOMICIDE_ADDITIONAL_INVESTIGATION`) | Event → Homicide review, "Beneficiary ruled out? = Yes" (never waits on an investigation referral) |
| `Suicide_Exclusion` | Death falls within the state suicide-exclusion window (benefit may be limited to premium refund) | Set when `MANNER = SUICIDE` and DOD within the state window (US 10.10; state-configured) | Worksheet → benefit limitation / decision |
| `Suicide_ADB_State` | Suicide interacting with an ADB rider under state-specific ADB-suicide rules | Set when suicide + ADB rider present (state config) | Worksheet → ADB handling |
| `Foreign_Death` | Death outside {US, Canada} | Set when `COUNTRY_OF_DEATH ∉ {US, Canada}` (US 10.11; mirrors L1 `FOREIGN_DEATH` / L2 `flagForeignDeath`) | Event → country in evidence grid + gate |
| `Accident_ADB_Investigation` | Accidental death with an ADB rider → investigate | Set when `MANNER = ACCIDENTAL` and ADB rider present (rule 10.29) | Event → Accident details section |

### 4.2 Contestability / MRX flags

| Flag | Meaning | How obtained | Where used / resolved |
|------|---------|--------------|------------------------|
| `Contestable` | Claim falls in the 2-year contestable window → medical review required | `Check Contestability` (DOD − policy/reinstatement date ≤ 2 yrs, US 10.02) | Drives `MRX Pull`; Workbench → MRX / contestable investigation |
| `MRx_Discrepancy` | MRX pull / non-disclosure check found a medical-records discrepancy or material non-disclosure | `MRX Pull` + `MRX Non-Disclosure Check` (contestable path only) | Worksheet → contestable adjudication |

### 4.3 Requirements & document flags

| Flag | Meaning | How obtained | Where used / resolved |
|------|---------|--------------|------------------------|
| `Requirements_Pending` | Outstanding requirements/documents pending from the claimant | Per-claim eval when required docs/info missing | **Outcome Gateway** → *Pending Requirement* branch → `PENDING_REQUIREMENTS` status + NIGO follow-up |
| `Document_Invalid` | An uploaded document failed AI classification/validation | AI classification/extraction/validation on upload (mirrors `VALIDATION_STATUS` failure) | Documents page → re-request / re-upload (triggers re-extraction) |

### 4.4 Policy-level flags

| Flag | Meaning | How obtained | Where used / resolved |
|------|---------|--------------|------------------------|
| `Policy_NotInForce` | Policy not in force (lapsed / in-grace / terminated) at the event date | Read from `POLICY.STATUS` (mirrors L2 `policyFlags.isActive=false` / `hasLapseAlert`) | Blocks STP; Worksheet + timeline "no coverage" band |
| `Prior_Claim` | A prior claim exists on the policy / insured | Per-claim eval against claim history | Examiner review — possible duplicate / offset |
| `Assignment` | Policy carries an assignment (collateral / absolute assignee) affecting payout | Per-claim eval against PAS assignment record | Payment lane — assignee entitlement |
| `Policy_Alert` | A general policy alert / hold is present in PAS | Read from PAS policy alerts | Examiner review before proceeding |
| `Bene_Change` | Beneficiary designation changed (esp. shortly before the event) | Per-claim eval against PAS servicing history | Examiner review — possible undue influence / contest |

### 4.5 Beneficiary / party flags

| Flag | Meaning | How obtained | Where used / resolved |
|------|---------|--------------|------------------------|
| `Minor_Bene` | A minor beneficiary exists | Aggregate across benes (mirrors L1 `MINOR_BENE_DETECTED` / L2 `minorDetected`) | Claimant & Beneficiaries → guardian authority block |
| `Bene_Deceased` | A beneficiary is deceased → estate handling | Per-claim eval / examiner status = Deceased | Claimant & Beneficiaries → estate capture block |
| `Bene_Incompetent` | A beneficiary lacks legal capacity → representative required | Per-claim eval / capacity = Requires representative | Claimant & Beneficiaries → representative authority block |
| `Foreign_Payee` | A payee is foreign → foreign withholding / tax handling | Per-claim eval on payee residency/tax status | Payment lane → foreign-payee withholding |
| `Divorce_Review` | Divorce may have revoked a spousal designation (state revocation-on-divorce) | Per-claim eval on marital status change | Parked for Worksheet; linked item on bene accordion |
| `FL_OK_Spouse` | FL/OK state spouse consent / notice required | Per-claim eval on state + spouse (rule 10.25) | Actions item → send state spouse consent/notice |
| `Bene_Mismatch` | Beneficiary name variance vs PAS | Upstream Levenshtein name-match score (read-only; never re-run) | Claimant & Beneficiaries → **Confirm match / Reject match** (Reject stays Open → blocks approval) |
| `Age_Gender_Misstatement` | DOB/gender on proof ≠ policy record → benefit adjustment | Per-claim eval cross-check (US 10.27; mirrors L1 `AGE_MISSTATEMENT`) | Event evidence grid → drives misstatement adjustment (L2 `misstatementExclusionApplied`) |
| `Claimant_NotBene` | Claimant is not the beneficiary of record ("Incorrect Claimant", BOG §7) | Silent PAS bene match = NO_MATCH (mirrors L1 `INCORRECT_CLAIMANT`) | Examiner triggers Incorrect-Claimant letter; processes to PAS bene of record |

### 4.6 STP aggregation flags (drive the Outcome Gateway)

| Flag | Meaning | How obtained | Where used |
|------|---------|--------------|------------|
| `Aggregate_Claim_STP_Eligible` | Per-**claim** roll-up: this claim has **no** blocking flags → eligible for straight-through | Computed at the end of `Run Per Claim Evaluation` by AND-ing the claim's blocking flags | Per-claim STP decision |
| `Aggregate_Case_STP_Eligible` | Case-level roll-up across **all** claims → the whole case can go STP | Aggregation of every claim's `Aggregate_Claim_STP_Eligible` | **Outcome Gateway** → *STP* vs *Examiner* routing |

> **POC/mock equivalence.** In the current jBPM/mock POC these two aggregates are implemented by **`isFastTrackRuleClear`** (§3.8) combined with the derived **`flagContestable`** (§3.7). When the real Features 10–11 rules land, `Aggregate_*_STP_Eligible` replaces that derivation as the authoritative STP gate.

### 4.7 TI per-claim evaluation flags

**TI is never STP** — every TI case exits to a mandatory examiner medical review (no Fast Track, no STP, `LD #10`). `Run TI Per Claim Evaluation` sets the TI-specific flags below, then **`Shared Flag Tasks (from Death US) — TI Applicability`** applies the Death flags in §4.1–4.5 that also apply to TI, **`Consolidate TI Flags for the Case`** rolls them up, and **`Assign TI Case to Reviewer`** routes to the Reviewer role.

| Flag | Meaning | How obtained | Where used / resolved |
|------|---------|--------------|------------------------|
| `Contestable` (TI) | TI claim within the contestable window | `Check Contestability` on the TI claim | Reviewer / medical review |
| `Life_Expectancy_Not_Confirmed` | Certified life expectancy not yet verified | Set until physician statement + medical records + medical-expert outcome present (US 11.03) | Event (TI) → **"Life expectancy verified"** gate. Threshold state-driven (≤6 mo; ≤12 mo CA) |
| `Owner_Incapacity_Indicated` | Policy owner cannot act for themselves | Per-claim eval / R-9.07b owner-incapacity extraction flag | Claimant & Payee → Owner authority block (POA/Guardian); validation outcome resolves |
| `Payout_Account_Changed` | TI payout account changed | Per-claim eval on payee account change | Awareness notice only; resolution parked for Worksheet |

> **General decision gate (WB).** A final **Accept/Approve** on the Worksheet requires **all Reels flags resolved AND all blocking checklist items complete** — one gate, two sources. Any Open item keeps its claim below 100% completion.

### 4.8 Items from the task list that are **not** flags (excluded)

The following entries in the source list are tasks/gateways, not flags, so they are documented elsewhere rather than as flags here:

| Excluded item | What it actually is | Documented in |
|---------------|---------------------|---------------|
| Set Pend Death Policy Status | Policy-status write | [claims_status.md](claims_status.md) §2.2 |
| Check Contestability | Assessment task (produces `Contestable`) | §4.2 above |
| MRX Pull · MRX Non-Disclosure Check | Assessment tasks (produce `MRx_Discrepancy`) | §4.2 above |
| Run Per Claim Evaluation · Run TI Per Claim Evaluation | Rules-engine tasks that **set** the flags | §4 (producing tasks) |
| Outcome Gateway – STP / Pending Requirement / Examiner Routing | Routing gateway (reads the STP-aggregate flags) | §4.6 above |
| Calculate Benefit Amount | Payment-lane computation task | Payment BRD (out of scope) |
| Send Claimant Requirement Notifications | Notification task | NIGO / requirements flow |
| Update Case and Claim status to Pending Requirement | Status write | [claims_status.md](claims_status.md) §1, §3 |
| Pending Requirement Followup and 30-day escalation | NIGO sub-process | §3.9 · [claims_status.md](claims_status.md) |
| Run AI classification, extraction & validation on document upload | IDP task (produces `Document_Invalid`) | §4.3 above |
| Assign Case to Examiner · Assign TI Case to Reviewer | Routing/assignment tasks | [claims_status.md](claims_status.md) §1 (`For Examination`) |
| Shared Flag Tasks (from Death US) – TI Applicability · Consolidate TI Flags for the Case | Flag-orchestration tasks (not flags themselves) | §4.7 above |

---

## 5. End-to-end mapping cheat-sheet

The same business concept can surface at all three layers under different names. This table reconciles them (L3 uses the **authoritative Features 10–11 names** from §4).

| Business concept | L1 submission (`CLAIM_FLAG_REGISTRY`) | L2 process var (API field) | L3 per-claim eval (authoritative, §4) |
|------------------|---------------------------------------|----------------------------|----------------------------------------|
| Suicide | — | `flagSuicide` (`validate-data.isSuicide`) | `Suicide_Exclusion`, `Suicide_ADB_State` |
| Contestable | — | **`flagContestable`** (derived, §3.7) | `Contestable` + `MRx_Discrepancy` |
| Foreign death | `FOREIGN_DEATH` | `flagForeignDeath` (`validate-data.isForeignDeath`) | `Foreign_Death` |
| AIDS | — | `flagAIDS` (`validate-data.isAIDS`) | *(examiner context; no named eval flag)* |
| Homicide | `HOMICIDE_ADDITIONAL_INVESTIGATION` | — | `Homicide_Hold` |
| Death not verified | — | — | `Death_Unverified`, `Manner_Unverified` |
| Minor bene | `MINOR_BENE_DETECTED` | `minorDetected` (`validate-beneficiary`) | `Minor_Bene` |
| Bene deceased / incompetent | — | — | `Bene_Deceased`, `Bene_Incompetent` |
| Bene name mismatch | `NAME_DISCREPANCY` | — | `Bene_Mismatch` |
| Wrong claimant | `INCORRECT_CLAIMANT` | — | `Claimant_NotBene` |
| Lapse / not in force | *(read live off `POLICY.STATUS`)* | `policyFlags.hasLapseAlert` / `isActive` | `Policy_NotInForce`, `Policy_Alert` |
| Prior claim / assignment | — | — | `Prior_Claim`, `Assignment`, `Bene_Change` |
| Docs incomplete / invalid | — | `allDocsVerified` / `allDocsReceived` | `Requirements_Pending`, `Document_Invalid` |
| Tax / foreign payee | — | `taxExceptions` (`tax/apply`) | `Foreign_Payee` |
| Misstatement | `AGE_MISSTATEMENT` | `misstatementExclusionApplied` | `Age_Gender_Misstatement` |
| Divorce / spouse consent | — | — | `Divorce_Review`, `FL_OK_Spouse` |
| Accident + ADB | — | — | `Accident_ADB_Investigation` |
| STP eligibility | — | `isFastTrackRuleClear` + `flagContestable` | `Aggregate_Claim_STP_Eligible`, `Aggregate_Case_STP_Eligible` |
| Life expectancy (TI) | — | *(TI KNECT path)* | `Life_Expectancy_Not_Confirmed` |
| Owner incapacity (TI) | — | — | `Owner_Incapacity_Indicated` |
| Payout account (TI) | — | — | `Payout_Account_Changed` |

---

## 6. Open points to confirm

- **`isContestable` (validate-data) vs `flagContestable` (derived).** The data-validation `isContestable` is currently advisory; the routing decision uses the derived flag. Confirm whether `validate-data.isContestable` should feed the derivation or be dropped.
- **Flag-vs-field discipline (#32).** Reconcile which submission conditions remain stored flags vs derived reads during the data-model sync.
- **State-driven flags** (`FL_OK_Spouse`, IL/FL 45-day notice, life-expectancy threshold) — name each exactly from the BOG / `STATE_REFERENCE_RULES` before the actions catalogue is configured.
- **Reels input-binding audit** — confirm every rule reads **canonical case fields**, not document-extraction paths (Track B STP depends on it) (US 13.03 open point).
- **STP-aggregate authority.** Confirm the exact blocking-flag set that feeds `Aggregate_Claim_STP_Eligible` (which §4 flags are STP-blocking vs advisory), and align the jBPM POC (`isFastTrackRuleClear` + `flagContestable`) to it.
- **`Prior_Claim` / `Assignment` / `Policy_Alert` / `Suicide_ADB_State` / `Foreign_Payee`** — these names come from the task inventory; confirm precise trigger conditions and BOG rule references against the System Claim Assessment BRD (Features 10–11), which is not in this repo.
