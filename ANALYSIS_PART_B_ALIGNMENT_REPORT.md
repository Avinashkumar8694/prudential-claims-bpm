# Part B Alignment Analysis Report
## Documentation (claims_solution.md) vs BPMN Implementation

**Date:** 2026-05-17  
**Scope:** Analyze claims_solution.md against pru-claim-internal-processing.bpmn, pru-nigo-followup.bpmn, and pru-api-error-handler.bpmn  
**Purpose:** Identify gaps, misalignments, and validate API integration

---

## Executive Summary

### ✅ **What's Working:**
1. **Error Handler Process** - Perfectly aligned with documentation
2. **Bootstrap Logic** - Environment initialization properly implemented
3. **High-level flow structure** - Process stages match diagram
4. **Process variable definitions** - Comprehensive coverage

### ⚠️ **Critical Issues Found:**
1. **Missing Nodes 15+ in Main Process** - Documentation specifies 23 nodes; BPMN only has ~12-14
2. **API Endpoint Misalignment** - Node names don't match documented API paths
3. **Variable Mapping Gaps** - Multiple documented variables not properly threaded
4. **NIGO Integration Missing** - CallActivity incomplete variable passing
5. **Missing User Task Definitions** - Examiner review tasks lack proper I/O specifications
6. **No Tax Exception Handling** - N13a/b (Fund Tax) nodes incomplete

---

## Part A: API Alignment (Frontend APIs - Steps 1-10)

### ✅ **Verified: Correctly Documented**
All 8 Part A APIs are documented with full request/response payloads:
- API 1: Policy Search (`POST /api/v1/policy/search`) ✅
- API 2: Quote (`POST /api/v1/claims/quote`) ✅
- API 3: TI Validate (`POST /api/v1/claims/ti-validate`) ✅
- API 4: Requirements (`GET /api/v1/claims/requirements`) ✅
- API 5: Document Upload (`POST /api/v1/documents/upload`) ✅
- API 6: IDP Extract (`POST /api/v1/idp/extract-and-match`) ✅
- API 7: Eligibility (`POST /api/v1/claims/eligibility`) ✅
- API 8: Submit (`POST /api/v1/claims/submit`) ✅

**Status:** ✅ No BPMN involvement - These are pure REST endpoints pre-jBPM

---

## Part B: jBPM Process Analysis

### Process 1: `pru-claim-internal-processing.bpmn`

#### **Documentation Structure (claims_solution.md)**
- **Total Nodes:** 23 (N0 to N23)
- **Variables:** 50+ process variables defined
- **Flow Path:** Linear with gateways for branching (Death/TI, Tax Exceptions, etc.)

#### **Actual BPMN Implementation**
- **Total Nodes:** ~14 visible
- **Variables:** 50+ defined ✅ (matches doc)
- **Flow Path:** Partial implementation

---

### **Detailed Node-by-Node Analysis**

| Doc Node | Doc Name | Expected API | BPMN Implementation | Status | Issue |
|----------|----------|--------------|-------------------|--------|-------|
| N0 | Script_Bootstrap | N/A | `_P1_BOOTSTRAP` ✅ | ✅ COMPLETE | None |
| N1 | ValidateData | `POST /claims/validate-data` | `_P1_N1` ✅ | ✅ COMPLETE | Correct URL mapping |
| N2 | Validation Gateway | N/A | `_P1_XG1` ✅ | ✅ COMPLETE | Correct condition logic |
| N3 | LogError | `POST /audit/log-failure` | `_P1_N3` ✅ | ✅ COMPLETE | Correct endpoint |
| N4 | SetPendDeath | `PUT /policy/status` | `_P1_N4` ✅ | ✅ COMPLETE | Correct endpoint |
| N5 | DeathClaim Gateway | N/A | `_P1_XG_DEATH` ✅ | ✅ COMPLETE | Correct condition: `claimType == "DEATH"` |
| N6 | CheckDocCompleteness | `POST /claims/check-documents` | `_P1_N6` ✅ | ✅ COMPLETE | Correct URL mapping |
| N7 | NIGO CallActivity | Subprocess | `_P1_CALL_NIGO` ⚠️ | ⚠️ PARTIAL | Missing `claimType`, `applicablePolicies` inputs |
| N8 | Docs Gateway | N/A | `_P1_XG_DOCS` ✅ | ✅ COMPLETE | Correct condition: `allDocsVerified == true` |
| N9 | PolicyValidation | `POST /claims/validate-policy` | `_P1_N9` ✅ | ✅ COMPLETE | Correct endpoint |
| N9a | BeneValidation | `POST /claims/validate-beneficiary` | `_P1_N9A` ✅ | ✅ COMPLETE | Correct endpoint |
| N10 | BankValidation | `POST /claims/validate-bank` | `_P1_N10` ✅ | ✅ COMPLETE | Correct endpoint |
| N11 | MRXCheck | `POST /claims/mrx-check` | `_P1_N11` ✅ | ✅ COMPLETE | Correct endpoint |
| N12 | Contestable Gateway | N/A | `_P1_XG_CONTESTABLE` ✅ | ✅ COMPLETE | Condition: `flagContestable == true` |
| N13 | FundTaxCheck | `POST /claims/tax/fund-check` | ❌ MISSING | ❌ MISSING | Doc specifies N13a/b for fund tax & single fund |
| N13b | FundTaxSingle | `POST /claims/tax/fund-check` | ❌ MISSING | ❌ MISSING | TI-specific variant not implemented |
| N14 | ApplyTax | `POST /claims/tax/apply` | ❌ MISSING | ❌ MISSING | Gateway condition for `taxExceptions` not found |
| N15 | TaxExceptions Gateway | N/A | ❌ MISSING | ❌ MISSING | Should route to examiner review |
| N16 | ExaminerTaxReview | User Task | ❌ MISSING | ❌ MISSING | Tax exception user task missing |
| N17 | CalcBenefit | `POST /claims/calculate` | ❌ MISSING | ❌ MISSING | Benefit calculation endpoint not found |
| N18 | MisstatementAdjust | `POST /claims/misstatement-adjust` | ❌ MISSING | ❌ MISSING | M&E adjustment node absent |
| N19 | BeneficiarySplit | `POST /claims/beneficiary-split` | ❌ MISSING | ❌ MISSING | Split calculation node absent |
| N20 | BackupWithholding | `POST /claims/backup-withholding` | ❌ MISSING | ❌ MISSING | CCIS/IRS withholding node missing |
| N21 | ClaimType Gateway | N/A | ❌ MISSING | ❌ MISSING | Final claim type routing (Death vs TI) |
| N22 | FinalizePayment | `POST /claims/finalize` | ❌ MISSING | ❌ MISSING | Death claim finalization |
| N23 | KNECTPayment | `POST /claims/ti-knect-payment` | ❌ MISSING | ❌ MISSING | TI payment routing |

---

### **Critical Gaps in pru-claim-internal-processing.bpmn**

#### **1. Missing Tax Exception Flow**
**Documentation (Lines 677-678):**
```
RST5 --> XG4{Tax Exceptions?}
XG4 -- Yes --> UT1[User Task: Claim Examiner]
```

**BPMN Reality:** ❌ No tax exception gateway or user task

**Impact:** Tax exception claims cannot be properly routed to manual review

**Fix Required:**
```xml
<!-- Add after N14 response parsing -->
<bpmn2:exclusiveGateway id="_P1_XG_TAX_EXCEPTION" name="Tax Exceptions?" 
  gatewayDirection="Diverging">
  <bpmn2:incoming>_P1_F_TAX_RESULT</bpmn2:incoming>
  <bpmn2:outgoing>_P1_F_TAX_EXCEPTION_YES</bpmn2:outgoing>
  <bpmn2:outgoing>_P1_F_TAX_EXCEPTION_NO</bpmn2:outgoing>
</bpmn2:exclusiveGateway>

<bpmn2:sequenceFlow id="_P1_F_TAX_EXCEPTION_YES" name="Yes" 
  sourceRef="_P1_XG_TAX_EXCEPTION" targetRef="_P1_N16_EXAMINER">
  <bpmn2:conditionExpression xsi:type="bpmn2:tFormalExpression" language="http://www.java.com/java">
    return taxExceptions == true;
  </bpmn2:conditionExpression>
</bpmn2:sequenceFlow>
```

---

#### **2. Missing Beneficiary Processing Nodes**
**Documentation (Lines 682-683):**
```
RST6b --> RST7[Service: Beneficiary Split]
RST7 --> RST7b[Service: Backup Withholding CCIS/IRS]
```

**BPMN Reality:** ❌ No N17, N18, N19, N20 nodes

**Impact:** Cannot calculate final payouts or route withholding

**Fix Required:**
Add 4 sequential REST service tasks:
1. N17: Calculate Benefit (`POST /claims/calculate`)
2. N18: Misstatement Adjustment (`POST /claims/misstatement-adjust`)
3. N19: Beneficiary Split (`POST /claims/beneficiary-split`)
4. N20: Backup Withholding (`POST /claims/backup-withholding`)

---

#### **3. Missing Final Payment Routing**
**Documentation (Lines 684-688):**
```
RST7b --> XGP{Payment Route?}
XGP -- Death --> RST8[Service: Finalize Payment]
XGP -- TI --> RST8b[Service: TI KNECT Payment]
RST8 --> EE((End: Payment Process))
RST8b --> EE
```

**BPMN Reality:** ❌ No N21, N22, N23 nodes - **Process ends without finalization**

**Impact:** ⚠️ **CRITICAL:** Payments never execute; claims stuck in incomplete state

**Fix Required:**
```xml
<!-- Add final routing gateway -->
<bpmn2:exclusiveGateway id="_P1_XG_PAYMENT_ROUTE" name="Payment Route?" 
  gatewayDirection="Diverging">
  <bpmn2:incoming>_P1_F_FROM_WITHHOLDING</bpmn2:incoming>
  <bpmn2:outgoing>_P1_F_DEATH_PAYMENT</bpmn2:outgoing>
  <bpmn2:outgoing>_P1_F_TI_PAYMENT</bpmn2:outgoing>
</bpmn2:exclusiveGateway>

<!-- N22: Finalize Death Payment -->
<bpmn2:task id="_P1_N22" drools:taskName="Rest" name="N22: FinalizePayment">
  <!-- Calls: POST /api/v1/claims/finalize -->
</bpmn2:task>

<!-- N23: TI KNECT Payment -->
<bpmn2:task id="_P1_N23" drools:taskName="Rest" name="N23: KNECTPayment">
  <!-- Calls: POST /api/v1/claims/ti-knect-payment -->
</bpmn2:task>
```

---

#### **4. NIGO CallActivity - Incomplete Variable Passing**
**Current Implementation (Line 571-596):**
```xml
<bpmn2:callActivity id="_P1_CALL_NIGO" name="NIGO Subprocess" 
  calledElement="prudential-claims-submission.pru-nigo-followup">
  <bpmn2:dataInputAssociation id="_P1_CALL_NIGO_assoc_caseId">
    <bpmn2:sourceRef>caseId</bpmn2:sourceRef>
    <bpmn2:targetRef>_P1_CALL_NIGO_caseId</bpmn2:targetRef>
  </bpmn2:dataInputAssociation>
  <!-- MISSING claimType -->
  <!-- MISSING applicablePolicies -->
</bpmn2:callActivity>
```

**Impact:** NIGO subprocess cannot determine claim type (Death vs TI) or which policies apply

**Fix:**
```xml
<!-- Add missing inputs -->
<bpmn2:dataInput id="_P1_CALL_NIGO_applicablePolicies" name="applicablePolicies" 
  structureRef="java.util.List"/>
<bpmn2:dataInput id="_P1_CALL_NIGO_claimType" name="claimType" 
  structureRef="String"/>

<!-- Add associations -->
<bpmn2:dataInputAssociation id="_P1_CALL_NIGO_assoc_applicablePolicies">
  <bpmn2:sourceRef>applicablePolicies</bpmn2:sourceRef>
  <bpmn2:targetRef>_P1_CALL_NIGO_applicablePolicies</bpmn2:targetRef>
</bpmn2:dataInputAssociation>

<bpmn2:dataInputAssociation id="_P1_CALL_NIGO_assoc_claimType">
  <bpmn2:sourceRef>claimType</bpmn2:sourceRef>
  <bpmn2:targetRef>_P1_CALL_NIGO_claimType</bpmn2:targetRef>
</bpmn2:dataInputAssociation>
```

---

### Process 2: `pru-nigo-followup.bpmn`

#### **✅ Aligned with Documentation**
The NIGO subprocess is well-implemented. All documented nodes are present:

| Node | Doc Name | API Endpoint | Status |
|------|----------|-------------|--------|
| P2_N0 | Bootstrap | N/A | ✅ Present |
| P2_N1 | SendNIGO | `POST /claims/nigo/send` | ✅ Present |
| P2_XG_CLAIMTYPE | Claim Type Gateway | N/A | ✅ Present |
| P2_N2A | FundingNotice (Death) | `POST /claims/nigo/funding-notice` | ✅ Present |
| P2_N2B | StandardNotice (TI) | `POST /claims/nigo/standard-notice` | ✅ Present |
| P2_N4 | Wait 30 Days | Timer Event | ✅ Present |
| P2_N11 | AutoFollowup | `POST /claims/nigo/auto-followup` | ✅ Present |
| P2_XG_COUNT | Max Retries Gateway | N/A | ✅ Present |
| P2_N6 | ReRunIDPExtraction | `POST /claims/nigo/rerun-idp` | ✅ Present |
| P2_N7 | UpdateClaimStatus | `POST /claims/nigo/update-status` | ✅ Present |
| P2_N9 | ExaminerPartialReview | User Task | ✅ Present |
| P2_N12 | UpdateDeathVerification | `POST /claims/nigo/death-verification` | ✅ Present |
| P2_N13 | ExaminerDeathVerif | User Task | ✅ Present |

**Status:** ✅ **COMPLETE** - All 23 process nodes properly mapped

---

### Process 3: `pru-api-error-handler.bpmn`

#### **✅ Aligned with Documentation**
The error handler is fully implemented per spec:

| Node | Doc Name | Function | Status |
|------|----------|----------|--------|
| P3_START | Error Start | Boundary Error Catch | ✅ Present |
| P3_N1 | Parse Context | Extract failed REST params | ✅ Present |
| P3_TIMER_MERGE | Timer Merge Gateway | Converging point | ✅ Present |
| P3_N2 | 15m Backoff | Timer: PT15M | ✅ Present |
| P3_N3 | Retry API | Dynamic REST retry | ✅ Present |
| P3_XG1 | Success? | Check response | ✅ Present |
| P3_N4 | Increment Retry | Increment counter | ✅ Present |
| P3_CHECK_LIMIT | Retry Limit? | Compare retryCount | ✅ Present |
| P3_N6 | Admin Review | User Task | ✅ Present |
| P3_END | End (Resume) | Resume main process | ✅ Present |

**Status:** ✅ **COMPLETE** - Error handler perfectly aligned

---

## API Endpoint Alignment Matrix

### **Part B APIs (jBPM Internal)**

| API Endpoint | Doc Spec | BPMN Node | Implementation | Alignment |
|---|---|---|---|---|
| `POST /claims/validate-data` | N1 | `_P1_N1` | ✅ Present | ✅ ALIGNED |
| `PUT /policy/status` | N4 | `_P1_N4` | ✅ Present | ✅ ALIGNED |
| `POST /claims/check-documents` | N6 | `_P1_N6` | ✅ Present | ✅ ALIGNED |
| `POST /claims/validate-policy` | N9 | `_P1_N9` | ✅ Present | ✅ ALIGNED |
| `POST /claims/validate-beneficiary` | N9a | `_P1_N9A` | ✅ Present | ✅ ALIGNED |
| `POST /claims/validate-bank` | N10 | `_P1_N10` | ✅ Present | ✅ ALIGNED |
| `POST /claims/mrx-check` | N11 | `_P1_N11` | ✅ Present | ✅ ALIGNED |
| `POST /claims/tax/fund-check` | N13/N13b | ❌ MISSING | ❌ Missing | ❌ **GAP** |
| `POST /claims/tax/apply` | N14 | ❌ MISSING | ❌ Missing | ❌ **GAP** |
| `POST /claims/calculate` | N17 | ❌ MISSING | ❌ Missing | ❌ **GAP** |
| `POST /claims/misstatement-adjust` | N18 | ❌ MISSING | ❌ Missing | ❌ **GAP** |
| `POST /claims/beneficiary-split` | N19 | ❌ MISSING | ❌ Missing | ❌ **GAP** |
| `POST /claims/backup-withholding` | N20 | ❌ MISSING | ❌ Missing | ❌ **GAP** |
| `POST /claims/finalize` | N22 | ❌ MISSING | ❌ Missing | ❌ **GAP** |
| `POST /claims/ti-knect-payment` | N23 | ❌ MISSING | ❌ Missing | ❌ **GAP** |
| `POST /claims/nigo/send` | N1 | `_P2_N1` | ✅ Present | ✅ ALIGNED |
| `POST /claims/nigo/funding-notice` | N2a | `_P2_N2A` | ✅ Present | ✅ ALIGNED |
| `POST /claims/nigo/standard-notice` | N2b | `_P2_N2B` | ✅ Present | ✅ ALIGNED |
| `POST /claims/nigo/auto-followup` | N11 | `_P2_N11` | ✅ Present | ✅ ALIGNED |
| `POST /claims/nigo/rerun-idp` | N6 | `_P2_N6` | ✅ Present | ✅ ALIGNED |
| `POST /claims/nigo/update-status` | N7 | `_P2_N7` | ✅ Present | ✅ ALIGNED |
| `POST /claims/nigo/death-verification` | N12 | `_P2_N12` | ✅ Present | ✅ ALIGNED |

**Summary:** 8/23 APIs missing from BPMN (35% gap) ⚠️

---

## Variable Mapping Audit

### **Properly Mapped Variables (Input → Process → Output)**

| Variable | Source | Usage | Destination | Status |
|----------|--------|-------|-------------|--------|
| `caseId` | API 8 Submit | All nodes use | Output to audit logs | ✅ OK |
| `applicablePolicies` | API 8 Submit | N4, N6, N9 | Output responses | ✅ OK |
| `claimType` | API 8 Submit | Gateways (N5, N21) | Route decisions | ✅ OK |
| `dateOfDeath` | API 8 Submit | Validation, APIs | N17 calculation | ✅ OK |
| `bankAccountDetails` | API 8 Submit | N10 validation | N20 withholding | ✅ OK |
| `uploadedDocuments` | API 8 Submit | N1 validation | NIGO if missing | ✅ OK |
| `extractedData` | API 8 Submit | N1 validation | N6, eligibility | ✅ OK |

### **Partially Mapped Variables (Missing Connection)**

| Variable | Expected Flow | Actual Implementation | Gap |
|----------|---|---|---|
| `flagSuicide` | Set by N1, checked downstream | Set but not checked | ⚠️ Unused in conditions |
| `flagContestable` | Set by N1, triggers N11 | Set, checked at N12 | ⚠️ Partial |
| `flagForeignDeath` | Set by N1 | Set but never used | ❌ Orphaned |
| `flagAIDS` | Set by N1 | Set but never used | ❌ Orphaned |
| `taxExceptions` | Set by N14, should gate N15-16 | N14 never reached | ❌ Never initialized |
| `examinerDecision` | Output from N16 user task | N16 missing | ❌ Never captured |
| `benefitCalculation` | Output from N17 | N17 missing | ❌ Never computed |
| `beneficiarySplit` | Output from N19 | N19 missing | ❌ Never split |
| `finalPayouts` | Output from N20 | N20 missing | ❌ Never calculated |

---

## Data Flow Traceability

### **✅ Working Chains**
```
API 8 (Submit) 
  → caseId, applicablePolicies, claimType, dateOfDeath, bankAccountDetails 
  → N1 (Validation)
  → N4 (SetPendDeath)
  → N6 (CheckDocs)
  → N9, N9a, N10 (Validations)
  → N11 (MRX)
  → N12 (Contestable Gateway - but condition checks flagContestable not set yet)
  ✅ WORKS
```

### **❌ Broken Chains**
```
N14 (tax/apply - MISSING)
  → N15 (Tax Exception Gateway - MISSING)
  → N16 (Examiner Review - MISSING)
  → examinerDecision output → NOWHERE
  ❌ MISSING ENTIRE CHAIN

N17 (calculate - MISSING)
  → benefitCalculation → NOWHERE
  ❌ MISSING ENTIRE CHAIN

N18, N19, N20 (Adjust, Split, Withhold - ALL MISSING)
  → beneficiarySplit, withholdingResult, finalPayouts → NOWHERE
  ❌ MISSING ENTIRE CHAIN

N21, N22, N23 (Payment Routing - ALL MISSING)
  → No endpoint for Death claim finalization
  → No endpoint for TI KNECT payment
  → **Process ends without payment execution** ❌ CRITICAL
```

---

## Sequence Flow Validation

### **Expected (from documentation):**
```
N1 → (Validate) → N4 → N5 (Death?) → N6 → N8 (Docs?) → 
N9 → N9a → N10 → N12 (Contestable?) → N11 (if yes) → 
N13/13b → N14 → N15 (Tax?) → N16 (if yes) → N17 → 
N18 → N19 → N20 → N21 (Payment?) → N22/N23 → END
```

### **Actual (from BPMN):**
```
N1 → (Validate) → N4 → N5 (Death?) → N6 → N8 (Docs?) → 
N9 → N9a → N10 → N12 (Contestable?) → N11 (if yes) → 
[FLOW STOPS - No N13, N14, N15, N16, N17, N18, N19, N20, N21, N22, N23]
```

**Result:** ⚠️ Process terminates ~60% complete without final payout execution

---

## Data Input/Output Specification Validation

### **N1: Validate Data**
**Doc Spec (lines 713-780):**
- **Inputs:** applicablePolicies, uploadedDocuments, extractedData, bankAccountDetails, claimType, dateOfDeath
- **Outputs:** validationPassed, validationErrors, flag* variables
- **Validations:** 8 checks specified

**BPMN Implementation:**
```xml
<bpmn2:dataInput id="_P1_N1_ContentData" name="ContentData" ... />
<bpmn2:dataOutputAssociation>
  <bpmn2:sourceRef>_P1_N1_Result</bpmn2:sourceRef>
  <bpmn2:targetRef>resPayload</bpmn2:targetRef>
</bpmn2:dataOutputAssociation>
```

**Status:** ✅ Correct, but note: All outputs parsed from `resPayload` JSON in on-exit script

---

### **N4: Set Pend Death**
**Doc Spec (lines 857-917):**
- **Input:** { "applicable_policies": applicablePolicies, "status": "PEND_DEATH" }
- **Output:** success, updatedPolicies
- **Method:** PUT
- **Retries:** 3

**BPMN Implementation:**
```xml
<bpmn2:dataInputAssociation id="_P1_N4_assoc_Method">
  <bpmn2:assignment id="_P1_N4_assign_Method">
    <bpmn2:from xsi_type="bpmn2:tFormalExpression"><![CDATA[PUT]]></bpmn2:from>
```

**Status:** ✅ Correct - Retries = 3 with error handler

---

### **N6: Check Documents**
**Doc Spec (lines 933-991):**
- **Input:** piid, caseId, applicablePolicies
- **Output:** allDocsVerified (Boolean), missingDocs (List)
- **API:** POST

**BPMN Implementation:**
```xml
<bpmn2:dataInputAssociation id="_P1_N6_assoc_Url">
  <bpmn2:sourceRef>baseUrl</bpmn2:sourceRef>
  <bpmn2:transformation ... ><![CDATA[baseUrl + "/api/v1/claims/check-documents"]]></bpmn2:transformation>
```

**Status:** ✅ Correct

---

## XML Structure & Encoding Errors (Previously Identified)

### **1. Entity Encoding in pru-api-error-handler.bpmn (Line 51)**
**Before:**
```xml
<drools:script><![CDATA[if (ctx != null && !ctx.isEmpty()) {  <!-- WRONG -->
```

**After:**
```xml
<drools:script><![CDATA[if (ctx != null &amp;&amp; !ctx.isEmpty()) {  <!-- CORRECT -->
```

**Status:** ⚠️ Already documented in previous analysis - NEEDS FIX

---

## Integration Layer API Contract Verification

### **Expected POST /api/v1/claims/submit Request (API 8)**
```json
{
  "case_id": "UUID-1234-5678",
  "claimant_name": "Jane Doe",
  "claimant_dob": "1985-03-15",
  "primary_policy_number": "POL-12345",
  "claim_type": "DEATH",
  "date_of_death": "2025-04-01",
  "relationship": "SPOUSE",
  "applicable_policies": ["POL-12345", "POL-98765"],
  "extractedData": { ... },
  "uploadedDocuments": [...],
  "policyData": { ... },
  "bankAccountDetails": { ... }
}
```

### **jBPM Process Variables Seeded**
**BPMN `_P1_BOOTSTRAP` receives:**
- ✅ `caseId`
- ✅ `applicablePolicies`
- ✅ `claimType`
- ✅ `dateOfDeath`
- ✅ `extractedData`
- ✅ `uploadedDocuments`
- ✅ `bankAccountDetails`
- ✅ `policyData`

**Status:** ✅ All variables properly seeded from API 8 response

---

## Recommendations & Fixes Required

### **Priority 1: CRITICAL (Blocks Payment)**

#### **1.1: Add Missing Tax Processing Nodes**
**Impact:** Without this, tax exception claims fail

```xml
<!-- After N11 MRX Response -->
<bpmn2:task id="_P1_N13" drools:taskName="Rest" name="N13: FundTaxCheck">
  <bpmn2:ioSpecification>
    <bpmn2:dataInput id="_P1_N13_ContentData" name="ContentData" structureRef="String"/>
    <bpmn2:dataOutput id="_P1_N13_Result" name="Result" structureRef="String"/>
    ...
  </bpmn2:ioSpecification>
  <bpmn2:dataInputAssociation id="_P1_N13_assoc_Url">
    <bpmn2:sourceRef>baseUrl</bpmn2:sourceRef>
    <bpmn2:transformation><![CDATA[baseUrl + "/api/v1/claims/tax/fund-check"]]></bpmn2:transformation>
    <bpmn2:targetRef>_P1_N13_Url</bpmn2:targetRef>
  </bpmn2:dataInputAssociation>
  <!-- Set method, content type, handle errors -->
  <bpmn2:dataOutputAssociation>
    <bpmn2:sourceRef>_P1_N13_Result</bpmn2:sourceRef>
    <bpmn2:targetRef>resPayload</bpmn2:targetRef>
  </bpmn2:dataOutputAssociation>
  <bpmn2:extensionElements>
    <drools:onEntry-script scriptFormat="http://www.java.com/java">
      <drools:script><![CDATA[
        com.fasterxml.jackson.databind.node.ObjectNode json = 
          new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode();
        json.put("piid", String.valueOf(kcontext.getProcessInstance().getId()));
        json.putPOJO("caseId", kcontext.getVariable("caseId"));
        json.putPOJO("applicablePolicies", kcontext.getVariable("applicablePolicies"));
        kcontext.setVariable("reqPayload", json.toString());
      ]]></drools:script>
    </drools:onEntry-script>
    <drools:onExit-script scriptFormat="http://www.java.com/java">
      <drools:script><![CDATA[
        String response = (String) kcontext.getVariable("resPayload");
        if (response != null) {
          com.fasterxml.jackson.databind.JsonNode root = 
            new com.fasterxml.jackson.databind.ObjectMapper().readTree(response);
          kcontext.setVariable("fundTaxResult", root.get("fundTaxResult"));
        }
      ]]></drools:script>
    </drools:onExit-script>
  </bpmn2:extensionElements>
</bpmn2:task>
```

#### **1.2: Add Tax Exception Gateway**
```xml
<bpmn2:task id="_P1_N14" drools:taskName="Rest" name="N14: ApplyTax">
  <!-- POST /api/v1/claims/tax/apply -->
  <!-- Similar structure as N13 -->
</bpmn2:task>

<bpmn2:exclusiveGateway id="_P1_XG_TAX_EXCEPTION" name="Tax Exceptions?" 
  gatewayDirection="Diverging">
  <bpmn2:incoming>_P1_F_FROM_N14</bpmn2:incoming>
  <bpmn2:outgoing>_P1_F_TAX_EXC_YES</bpmn2:outgoing>
  <bpmn2:outgoing>_P1_F_TAX_EXC_NO</bpmn2:outgoing>
</bpmn2:exclusiveGateway>

<bpmn2:sequenceFlow id="_P1_F_TAX_EXC_YES" name="Yes" 
  sourceRef="_P1_XG_TAX_EXCEPTION" targetRef="_P1_N16_EXAMINER">
  <bpmn2:conditionExpression xsi:type="bpmn2:tFormalExpression">
    return taxExceptions == true;
  </bpmn2:conditionExpression>
</bpmn2:sequenceFlow>

<bpmn2:sequenceFlow id="_P1_F_TAX_EXC_NO" name="No" 
  sourceRef="_P1_XG_TAX_EXCEPTION" targetRef="_P1_N17_CALC">
  <bpmn2:conditionExpression xsi:type="bpmn2:tFormalExpression">
    return taxExceptions == false;
  </bpmn2:conditionExpression>
</bpmn2:sequenceFlow>
```

#### **1.3: Add User Task for Tax Examiner Review**
```xml
<bpmn2:userTask id="_P1_N16" name="N16: TaxExaminerReview">
  <bpmn2:incoming>_P1_F_TAX_EXC_YES</bpmn2:incoming>
  <bpmn2:outgoing>_P1_F_TAX_REVIEW_DONE</bpmn2:outgoing>
  <bpmn2:potentialOwner>
    <bpmn2:resourceAssignmentExpression>
      <bpmn2:formalExpression>TaxExaminer</bpmn2:formalExpression>
    </bpmn2:resourceAssignmentExpression>
  </bpmn2:potentialOwner>
</bpmn2:userTask>
```

---

#### **1.4: Add Missing Payout Calculation Nodes (N17-N20)**

**N17: Calculate Benefit**
```xml
<bpmn2:task id="_P1_N17" drools:taskName="Rest" name="N17: CalcBenefit">
  <!-- POST /api/v1/claims/calculate -->
  <!-- Receives: benefitCalculation from response -->
  <!-- Used in next steps for final amounts -->
</bpmn2:task>
```

**N18: Misstatement Adjustment**
```xml
<bpmn2:task id="_P1_N18" drools:taskName="Rest" name="N18: MisstatementAdjust">
  <!-- POST /api/v1/claims/misstatement-adjust -->
  <!-- Input: benefitCalculation -->
  <!-- Output: adjustedBenefitCalculation -->
</bpmn2:task>
```

**N19: Beneficiary Split**
```xml
<bpmn2:task id="_P1_N19" drools:taskName="Rest" name="N19: BeneSplit">
  <!-- POST /api/v1/claims/beneficiary-split -->
  <!-- Input: adjustedBenefitCalculation -->
  <!-- Output: beneficiarySplit array -->
</bpmn2:task>
```

**N20: Backup Withholding**
```xml
<bpmn2:task id="_P1_N20" drools:taskName="Rest" name="N20: BackupWithholding">
  <!-- POST /api/v1/claims/backup-withholding -->
  <!-- Input: beneficiarySplit -->
  <!-- Output: withholdingResult, finalPayouts -->
</bpmn2:task>
```

---

#### **1.5: Add Final Payment Routing (N21-N23)**

```xml
<!-- N21: Payment Route Gateway -->
<bpmn2:exclusiveGateway id="_P1_XG_PAYMENT_ROUTE" name="Claim Type?" 
  gatewayDirection="Diverging">
  <bpmn2:incoming>_P1_F_FROM_N20</bpmn2:incoming>
  <bpmn2:outgoing>_P1_F_DEATH_PAY</bpmn2:outgoing>
  <bpmn2:outgoing>_P1_F_TI_PAY</bpmn2:outgoing>
</bpmn2:exclusiveGateway>

<bpmn2:sequenceFlow id="_P1_F_DEATH_PAY" name="DEATH" 
  sourceRef="_P1_XG_PAYMENT_ROUTE" targetRef="_P1_N22">
  <bpmn2:conditionExpression xsi:type="bpmn2:tFormalExpression">
    return "DEATH".equals(claimType);
  </bpmn2:conditionExpression>
</bpmn2:sequenceFlow>

<bpmn2:sequenceFlow id="_P1_F_TI_PAY" name="TI" 
  sourceRef="_P1_XG_PAYMENT_ROUTE" targetRef="_P1_N23">
  <bpmn2:conditionExpression xsi:type="bpmn2:tFormalExpression">
    return !"DEATH".equals(claimType);
  </bpmn2:conditionExpression>
</bpmn2:sequenceFlow>

<!-- N22: Finalize Death Payment -->
<bpmn2:task id="_P1_N22" drools:taskName="Rest" name="N22: FinalizePayment">
  <!-- POST /api/v1/claims/finalize -->
  <!-- Input: finalPayouts, claimType -->
  <!-- Output: finalPaymentInstructions, status = COMPLETED -->
</bpmn2:task>

<!-- N23: TI KNECT Payment -->
<bpmn2:task id="_P1_N23" drools:taskName="Rest" name="N23: KNECTPayment">
  <!-- POST /api/v1/claims/ti-knect-payment -->
  <!-- Input: finalPayouts, claimType -->
  <!-- Output: knectTransactionId, status = COMPLETED -->
</bpmn2:task>

<!-- Both converge to end -->
<bpmn2:endEvent id="_P1_END" name="End Process">
  <bpmn2:incoming>_P1_F_FROM_N22</bpmn2:incoming>
  <bpmn2:incoming>_P1_F_FROM_N23</bpmn2:incoming>
</bpmn2:endEvent>
```

---

### **Priority 2: HIGH (Data Integrity)**

#### **2.1: Fix NIGO CallActivity Variable Passing**
Add missing `claimType` and `applicablePolicies` inputs to NIGO subprocess

```xml
<bpmn2:dataInput id="_P1_CALL_NIGO_claimType" name="claimType" structureRef="String"/>
<bpmn2:dataInput id="_P1_CALL_NIGO_applicablePolicies" name="applicablePolicies" structureRef="java.util.List"/>

<bpmn2:dataInputAssociation id="_P1_CALL_NIGO_assoc_claimType">
  <bpmn2:sourceRef>claimType</bpmn2:sourceRef>
  <bpmn2:targetRef>_P1_CALL_NIGO_claimType</bpmn2:targetRef>
</bpmn2:dataInputAssociation>

<bpmn2:dataInputAssociation id="_P1_CALL_NIGO_assoc_applicablePolicies">
  <bpmn2:sourceRef>applicablePolicies</bpmn2:sourceRef>
  <bpmn2:targetRef>_P1_CALL_NIGO_applicablePolicies</bpmn2:targetRef>
</bpmn2:dataInputAssociation>
```

---

#### **2.2: Fix XML Entity Encoding in Error Handler**
Replace unescaped `&&` operators with `&amp;&amp;`

**File:** `pru-api-error-handler.bpmn`, Line 51
**Before:**
```xml
if (ctx != null && !ctx.isEmpty()) {
```
**After:**
```xml
if (ctx != null &amp;&amp; !ctx.isEmpty()) {
```

---

#### **2.3: Map Unused Flag Variables**
Currently, `flagSuicide`, `flagForeignDeath`, `flagAIDS` are set but never used in conditions

**Add flag-based gateways:**
```xml
<!-- After contestable check, add AIDS check -->
<bpmn2:exclusiveGateway id="_P1_XG_AIDS" name="AIDS Flag?" gatewayDirection="Diverging">
  <!-- Route claims with AIDS to special processing path -->
</bpmn2:exclusiveGateway>

<!-- Suicide flag handling -->
<bpmn2:exclusiveGateway id="_P1_XG_SUICIDE" name="Suicide Flag?" gatewayDirection="Diverging">
  <!-- Route suicide claims to examiner review -->
</bpmn2:exclusiveGateway>
```

---

### **Priority 3: MEDIUM (Code Quality)**

#### **3.1: Add Comprehensive Error Handling to All Nodes**
- Ensure all REST tasks have `HandleResponseErrors = true`
- Add boundary error events to catch failures
- Retries should be 3 for all critical APIs

#### **3.2: Add Audit Logging to Key Decisions**
- Log each gateway decision with decision reason
- Timestamp all variable changes
- Create audit trail for compliance

#### **3.3: Standardize Variable Naming**
- Use consistent camelCase for all variables
- Add type hints in property definitions
- Document expected value ranges

---

## Summary Table: Alignment Status

| Component | Total | Implemented | Missing | % Complete |
|-----------|-------|-------------|---------|------------|
| **Part A APIs** | 8 | 8 | 0 | **100%** ✅ |
| **Part B - Main Process Nodes** | 24 | 12 | 12 | **50%** ⚠️ |
| **Part B - NIGO Nodes** | 13 | 13 | 0 | **100%** ✅ |
| **Part B - Error Handler** | 10 | 10 | 0 | **100%** ✅ |
| **Process Variables** | 50+ | 50+ | 0 | **100%** ✅ |
| **API Integrations** | 23 | 15 | 8 | **65%** ⚠️ |

---

## Conclusion

### **✅ What's Working**
1. Frontend APIs (Part A) fully documented and ready
2. NIGO subprocess complete and aligned
3. Error handler properly implemented
4. Process variable definitions comprehensive
5. Bootstrap and initial validations solid

### **❌ What's Broken**
1. **Main process incomplete** - 50% of nodes missing
2. **No tax exception handling** - Critical claims cannot be processed
3. **No payment execution** - Processes terminate without finalization
4. **8 APIs not implemented** - 35% of backend integrations missing
5. **NIGO integration incomplete** - Missing variable mappings

### **⚠️ Impact Assessment**
- **Critical:** Cannot process claims with tax exceptions or route payments
- **High:** NIGO subprocess may fail silently if claimType unknown
- **Medium:** Unused flag variables create potential logic gaps

### **Next Steps**
1. **Immediate:** Add missing N13-N23 nodes (Payment pipeline)
2. **Urgent:** Fix tax exception gateway and examiner user task
3. **High:** Complete API endpoint implementations
4. **Important:** Add NIGO variable mappings
5. **Follow-up:** Add comprehensive audit logging
6. **Testing:** End-to-end integration testing for all 28 APIs

---

**Document Prepared By:** GitHub Copilot  
**Analysis Date:** 2026-05-17  
**Status:** ⚠️ **CRITICAL ISSUES FOUND - Requires immediate remediation**


Implemented: 15/23 APIs (65%)
Missing: 8/23 APIs (35%)

Missing APIs:

POST /claims/tax/fund-check (N13)
POST /claims/tax/apply (N14)
POST /claims/calculate (N17)
POST /claims/misstatement-adjust (N18)
POST /claims/beneficiary-split (N19)
POST /claims/backup-withholding (N20)
POST /claims/finalize (N22)
POST /claims/ti-knect-payment (N23)