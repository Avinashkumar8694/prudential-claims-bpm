# System Claim Assessment — Node Rules → API Mapping

> Grounds every node of `pru-claims-examination` (and the evaluation sub-processes) in the **WS2 System Claim Assessment BRD** (Features 10–11) and the **WS2 Upload Pending Requirement BRD** (Feature 12). For each node: the BRD user story, the exact rule, and the mock/integration API that implements it.
>
> Sources: `docs/WS2_System_Claim_Assessment_BRD.docx` (US 10.01–10.39, 11.01–11.08), `docs/WS2_Upload_Pending_Requirement_BRD.docx` (US 12.01).
> Companions: [pru_claim_evaluation_solution.md](pru_claim_evaluation_solution.md), [claims_flags.md](claims_flags.md), [claims_status.md](claims_status.md).

---

## 1. Global rules (the ones that drive the APIs)

| Rule | Definition (from the BRD) | Decision |
|------|---------------------------|----------|
| **Contestability** | A policy is contestable if **`DOD − issue date ≤ 730 days`** OR a **reinstatement within 2 years** before death. Case = **ANY policy contestable** → drives one insured-level MRX. At launch all policies < 2 yrs ⇒ always contestable. | #35, AD-2, AD-29 |
| **Flag polarity** | Every per-claim flag is stored **true = exception**. | AD-28 |
| **STP-blocking** | **Every** per-claim flag (US 10.06–10.29) blocks STP. The **only** open case is `Suicide_Exclusion` (10.10) — its blocking status is undecided (AD-31); treated **non-blocking** in the mock. | AD-1, AD-31 |
| **Claim STP** | `CLAIM_STP_ELIGIBLE = true` **iff no blocking flag is set** (US 10.30). | AD-18 |
| **Case STP** | `CASE_STP_ELIGIBLE = (no case-level flag) AND (ALL CLAIM_STP_ELIGIBLE)`. Any single non-STP claim ⇒ whole case non-STP (US 10.31). | AD-18 |
| **Outcome (3 only)** | **STP** if case STP; **Pending Requirement** if not-STP AND the *only* blocking condition is `Requirements_Pending` AND all pending parties are **contactable**; **Refer to Examiner** for any other non-STP reason (any non-pending exception flag, or Requirements_Pending with a non-contactable party). No auto-denials. | US 10.32, AD-1, AD-6 |
| **Pending follow-up** | One claimant email (documents only, never bene forms) + a **single absolute 30-day timer** from first entry into Pending Requirement (**not** reset by partial uploads). Day 30 still pending → examiner. | US 10.34–10.36, AD-25 |
| **Benefit (STP)** | Benefit = **policy face amount** per claim; **no loans / no cash value**; DCI/interest is **payment-lane**, not here. | US 10.33, AD-7 |
| **TI** | TI is **always non-STP** → Reviewer; **no PEND_DEATH, no MRX/records pull** by the system; **no 30-day self-service hold** (straight to reviewer). | AD-32, AD-33, AD-34 |

---

## 2. Death system lane — node → rule → API (US 10.01–10.39)

Legend: **API** = the mock/integration endpoint the node calls (its full URL is built once in the bootstrap script node into a `url…` process variable — no path hardcoded on the node, and no `/v1` in the path; the version lives in `baseUrl`); **script** = in-process logic (no REST). Every REST payload carries `piid` **and** `cid` (the case-level numeric correlation id). *STP?* = does a `true` result block STP.

| Node (BPMN) | US | Rule | API / impl | STP? |
|-------------|----|------|-----------|------|
| Set Pol Status to Pend Death | 10.01 | Set **every** associated policy = `PENDING_DEATH_CLAIM` regardless of verification (stops billing; reversible). | `PUT /v1/policy/status` | n/a |
| Check contestability | 10.02 | Contestable if `DOD−issue ≤ 730d` OR reinstatement < 2 yr; **ANY policy**. | `POST /v1/claims/check-contestability` → `{contestable}` | gateway |
| MRX Pull | 10.03 | Case-level, once, **async** pull of MRX/MIB/pharmacy for the insured (contestable only). | `POST /v1/claims/mrx-check` | n/a |
| MRX check, Set MRx_Discrepancy | 10.04 | Compare records to the **single purchase health question** only; non-disclosure/disclosure-related/indeterminable → `mrxDiscrepancy=true` (carried per-claim, no rerun). | `POST /v1/claims/mrx-check` → `{mrxDiscrepancy}` | **yes** |
| Run Per Claim Evaluation | 10.05 | **One instance per claim** (multi-instance); runs the full flag battery, then per-claim STP. | callActivity → `pru-claim-run-evaluation` (self-contained: Get Claim IDs → parallel per-claim → B) | orchestrator |
| Set flags (per claim) | 10.06–10.29 | The 24-flag battery (see §4). Each `true = exception`, each STP-blocking (except 10.10). | `POST /v1/claims/evaluate-claim` → `claimFlags{…}` (subprocess B) | **yes** |
| Aggregate Claim_STP_Eligible | 10.30 | `true` iff no blocking flag set. | `evaluate-claim` → `claimStpEligible` | — |
| Aggregate Case_STP_Eligible | 10.31 | `AND(all claimStpEligible)`; any non-STP claim ⇒ case non-STP. | Aggregate scriptTask (main BPMN) → `caseStpEligible`, `outcome` | — |
| Outcome | 10.32 | STP / Pending Requirement / Refer to Examiner per §1. | exclusive gateway on `outcome` | router |
| Calculate Benefit Amount | 10.33 | STP-only; benefit = **face amount** per claim; no loans/cash-value; no interest here. | `POST /v1/claims/calculate` → `{payoutAmount, benefitCalculation}` | n/a |
| Send Requirement eMail | 10.34 | One claimant email + secure upload link; **documents only** (never bene forms). | `POST /v1/claims/nigo/send` | n/a |
| Update Case+claim status Pending Req | 10.35 | CASE + CLAIM status = `Pending Requirement`. | `POST /v1/claims/status` (status=`PENDING_REQUIREMENTS`) | n/a |
| Update followup to 30 days | 10.36 | Absolute 30-day timer from first Pending entry (not reset by partial uploads). | user task + **boundary timer `P30D`** | n/a |
| Run AI classification, extraction, validation | 10.37 | Per-document classify/extract/validate; sets `VALIDATION_STATUS` (VALID / NEEDS_REVIEW / INVALID) + confidence/completeness (AD-21). | `POST /v1/claims/nigo/rerun-idp` | n/a |
| Update Case data | 10.38 | Update doc statuses/extracted fields/bene-form completion; **loop back to Run Per Claim Evaluation** (MRX not re-run). | `POST /v1/claims/nigo/update-status` → loop | n/a |
| Assign case to examiner | 10.39 | Single shared handoff for the Refer-to-Examiner branch **and** the Day-30 escalation; system lane ends. | **Human task** (user task, `ClaimsExaminer` group) — lands on the examiner worklist; no REST call | n/a |

**Claimant self-service upload (US 12.01, Feature 12):** the secure upload landing reached from `Send Requirement eMail` — checklist of outstanding required docs + a single bin; each file classified in real time (10.37/10.38); only **required** items resolve the pending condition; partial submit allowed with the 30-day clock still running; `UPLOAD_SOURCE = claimant self-service`.

---

## 3. TI system lane — how it differs (US 11.01–11.08)

| Node | US | Rule |
|------|----|------|
| Run TI Per Claim Evaluation | 11.01 | One instance per TI-rider policy; **always non-STP** — no Fast Track, no STP gateway; **no PEND_DEATH, no MRX/records pull** (AD-32/33). Enriches the case for the reviewer. |
| Set Contestable_Flag (TI) | 11.02 | Contestable if policy < 2 yr from issue OR reinstated < 2 yr — **measured to the claim/assessment date** (insured alive, no DOD). Routes to medical-records contestable investigation (reviewer/medical side); **system pulls no records**. |
| Set Life_Expectancy_Not_Confirmed | 11.03 | Threshold **≤ 6 months (CA ≤ 12 months)**; `true` when a within-threshold LE **can't be confirmed** from the physician statement (missing/over-threshold/low-confidence). Mandatory medical review runs regardless. |
| Set Owner_Incapacity_Indicated | 11.04 | `true` when submission indicates a POA/guardian acting for the owner. |
| Set Payout_Account_Changed | 11.05 | `true` when payout account differs from account on record. **Blocked on open dependency** (no documented account-of-record source, AD-39); GIACT validation is payment-lane. |
| Shared flags (TI applicability) | 11.06 | Reuses Requirements_Pending, Document_Invalid, Policy_NotInForce, Prior_Claim, Policy_Alert, Age_Gender_Misstatement — with TI nuances (e.g. paid TI terminates policy; **no 30-day hold — pending TI goes straight to reviewer**, AD-34). |
| Consolidate TI Flags | 11.07 | Roll up per-claim flags to a case view; **no STP roll-up, no Outcome gateway** — always to reviewer. |
| Assign TI Case to Reviewer | 11.08 | Every TI case → reviewer (sole TI outcome); shared handoff with US 10.39. |

> **BPMN note (implemented).** The TI branch is now built in `pru-claims-examination`: the **Claim Type** gate routes TI to **Run TI Per Claim Evaluation** (callActivity → `pru-claim-run-evaluation` with `claimType=TI`, reusing subprocess A/B) → **Consolidate TI Flags for the Case** (script, sets `outcome=REVIEWER`) → **Assign TI Case to Reviewer** (**human task**, `Reviewer` group — shared reviewer/examiner handoff per US 11.08/10.39) → **End (Claim Reviewer)**. There is **no** STP/Outcome gateway on the TI branch (TI is always non-STP, AD-32). The `evaluate-claim` endpoint returns the TI flag set (Contestable, Life_Expectancy_Not_Confirmed, Owner_Incapacity_Indicated, Payout_Account_Changed + shared) with `claimStpEligible=false` and `reviewerRequired=true` when `claimType=TI`. Mandatory medical-expert review itself is reviewer-side (Examiner/Workbench BRDs).

---

## 4. The 24-flag battery (US 10.06–10.29) — condition each sets `true`

Each is **STP-blocking** (true = exception) except `Suicide_Exclusion` (open, AD-31). Full detail in [claims_flags.md](claims_flags.md) §4; conditions per the BRD:

| Flag | US | `true` when… |
|------|----|--------------|
| `Death_Unverified` | 10.06 | `DEATH_VERIFIED = false` |
| `Manner_Unverified` | 10.07 | `MANNER_VALIDATED = false` (manner rules still run on declared value) |
| `Homicide_Hold` | 10.08 | manner = homicide (hold until bene ruled out) |
| `Suicide_ADB_State` | 10.09 | suicide **AND** ADB rider **AND** (issued in MO OR insured resided in one of 18 listed states) |
| `Suicide_Exclusion` | 10.10 | suicide within the exclusion period (interim: < 2 yr from issue) → return-of-premium benefit (**blocking OPEN**) |
| `Foreign_Death` | 10.11 | death outside US/Canada (US territories = foreign) |
| `MRx_Discrepancy` | 10.12 | case-level MRX non-disclosure (carried from 10.04; false if non-contestable) |
| `Requirements_Pending` | 10.13 | any required doc not received OR any bene form incomplete |
| `Document_Invalid` | 10.14 | any required doc `VALIDATION_STATUS ≠ VALID` |
| `Policy_NotInForce` | 10.15 | policy not in force **at DOD** |
| `Prior_Claim` | 10.16 | prior death claim paid/in-progress on the policy |
| `Assignment` | 10.17 | collateral assignment OR funeral-home assignment of record |
| `Policy_Alert` | 10.18 | any alert/lien/rights restriction on the policy |
| `Bene_Change` | 10.19 | pending bene change OR change recorded after DOD |
| `Minor_Bene` | 10.20 | any beneficiary `IS_MINOR` |
| `Bene_Deceased` | 10.21 | any beneficiary of record deceased |
| `Bene_Incompetent` | 10.22 | any beneficiary legally incompetent |
| `Foreign_Payee` | 10.23 | a payee is not a US person |
| `Divorce_Review` | 10.24 | spouse/ex-spouse bene with a divorce indicated (revocation-on-divorce) |
| `FL_OK_Spouse` | 10.25 | insured resided in FL/OK + spouse-bene state condition |
| `Bene_Mismatch` | 10.26 | claimant claims Beneficiary but `BENE_MATCH_STATUS = NO_MATCH` |
| `Age_Gender_Misstatement` | 10.27 | sourced DOB (or gender, if rate-relevant) ≠ PAS → benefit recalculation |
| `Claimant_NotBene` | 10.28 | claimant ROLE ≠ Beneficiary (third-party filer) |
| `Accident_ADB_Investigation` | 10.29 | ADB rider **AND** manner = accident |

---

## 5. How the mock encodes these (test harness)

The mock derives scenarios from **keywords in `caseId`/`claimId`** (consistent with the existing convention). Key ones for the new rules:

| Keyword | Effect |
|---------|--------|
| *(none)* | contestability defaults **true** (launch); a clean claim evaluates **STP** |
| `NONCONTEST` | contestability → false (skip MRX) |
| `CONTEST` / `MRX` / `NONDISCLOSURE` | MRX non-disclosure → `MRx_Discrepancy` → examiner |
| `NIGO` / `PARTIAL` / `REQPENDING` | `Requirements_Pending` → **Pending Requirement** (if contactable) |
| `NOCONTACT` | pending party non-contactable → **examiner** instead of the loop |
| `HOMICIDE`, `FOREIGN`, `MINOR`, `LAPSE`, `MISSTATE`, `DIVORCE`, `ASSIGNMENT`, `PRIOR`, `ALERT`, `MISMATCH`, … | set the corresponding flag → **examiner** |

Verified behaviour: happy → STP; `NIGO` → pending; `NIGO`+`NOCONTACT` → examiner; `HOMICIDE` → examiner; contestability with real dates > 2 yr → false; `calculate` returns face amount with no interest.

---

## 6. Open items (from the BRD — carry into the real integration)

- **MRX/MIB/pharmacy retrieval** (10.03) is a **critical open dependency** — API availability, async SLA, and authorization basis are open. Until automated, a contestable case cannot stay straight-through.
- **`Suicide_Exclusion` blocking** (10.10/AD-31) — whether a below-face suicide settlement stays STP or is forced non-STP (Schedule F) is open.
- **Canonical status model** (AD-16) — FAST vs Agreement status values and real-time vs nightly-batch write to PAS are open (affects `policy/status` and `status`).
- **Gender-rating** (AD-30) — whether SS GI is gender-rated (affects Age_Gender_Misstatement).
- **TI `Payout_Account_Changed`** (11.05/AD-39) — no documented account-of-record source; comparison key undefined.
- **State-specific rule content** — FL/OK spouse (10.25), divorce revocation (10.24), suicide-exclusion periods (10.10) are Reels config, pending.
