# 📘 Prudential Claims BPM: Mock Testing Blueprint

This testing blueprint serves as the **Mock Solution Document** for testing your industrialized jBPM claims process end-to-end. It details the different business scenarios, the exact **Startup JSON Payloads** to send to KIE Server, how the BPMN execution branches, and how the Mock API server responds to trigger each specific scenario.

---

## 🗺️ Process Scenarios & Execution Matrix

```mermaid
graph TD
    Start([Start Process Instance]) --> Validate[N1: ValidateData]
    Validate --> ValPass{Validation Passed?}
    
    ValPass -- No --> LogErr[N3: LogError] --> FailEnd([End: Failure])
    ValPass -- Yes --> SetPend[N4: SetPendDeath]
    
    SetPend --> IsDeath{Is Death Claim?}
    
    IsDeath -- Yes --> CheckDocs[N6: CheckDocCompleteness]
    CheckDocs --> DocsOK{Docs OK?}
    
    DocsOK -- No --> NIGO[N8: NIGO Subprocess]
    NIGO --> WaitDocs[Wait for Upload]
    WaitDocs --> CheckDocs
    
    DocsOK -- Yes --> PolicyVal[N9: PolicyValidation]
    IsDeath -- No --> PolicyVal
    
    PolicyVal --> BeneVal[N9a: BeneValidation]
    BeneVal --> BankVal[N10: BankValidation]
    
    BankVal --> MatchCheck{Bank & Bene OK?}
    MatchCheck -- No --> Examiner[N16: Examiner Review User Task]
    
    MatchCheck -- Yes --> IsDeath2{Is Death Claim?}
    
    IsDeath2 -- Yes --> MRX[N11: MRXCheck]
    MRX --> MRXCheck{Contestable / Alert?}
    MRXCheck -- Yes --> Examiner
    
    MRXCheck -- No --> SingleTax[N13b: SingleFundTax] --> ApplyTax[N14: ApplyTax]
    IsDeath2 -- No --> MultiTax[N13a: MultiFundTax] --> ApplyTax
    
    ApplyTax --> Calc[N17: CalcBenefit] --> Adjust[N18: MisstatementAdjust]
    Adjust --> Split[N19: BeneSplit] --> Withhold[N20: BackupWithholding]
    
    Withhold --> PayRoute{Payment Route?}
    PayRoute -- Death --> Finalize[N22: FinalizePayment] --> Success([End: Success])
    PayRoute -- TI --> KNECT[N23: KNECTPayment] --> Success
    
    Examiner --> ExDecision{Examiner Decision?}
    ExDecision -- Approve --> SingleTax
    ExDecision -- Reject/Abort --> FailEnd
```

---

## 🧪 Scenario 1: Happy Path Death Claim (Fully Automated Route)
This tests the standard automatic processing of a death claim with complete documentation, valid bank details, and no contestability issues.

### 📥 Startup Payload (`POST /server/containers/{containerId}/processes/{processId}/instances`)
```json
{
  "caseId": "CASE-DEATH-HAPPY-001",
  "policyNumber": "POL-12345",
  "claimType": "DEATH",
  "dateOfDeath": "2025-04-01",
  "applicablePolicies": ["POL-12345"],
  "uploadedDocuments": [
    "s3://prudential-claims/claims_form_signed.pdf",
    "s3://prudential-claims/certified_death_certificate.pdf"
  ],
  "policyData": {
    "eligibility_passed": true,
    "requires_manual_review": false
  },
  "bankAccountDetails": {
    "bank_name": "Chase Bank",
    "routing_number": "021000021",
    "account_number": "987654321",
    "payment_method": "ACH"
  }
}
```

### ⚙️ Mock API Interactions & Behaviors
1. **`POST /api/v1/claims/validate-data`**
   * **BPM sends:** `{ "piid": "...", "caseId": "CASE-DEATH-HAPPY-001", ... }`
   * **Mock responds:** `{ "success": true, "validationPassed": true }`
2. **`PUT /api/v1/policy/status`**
   * **BPM sends:** Sets status to pending.
   * **Mock responds:** `{ "success": true, "updatedPolicies": [...] }`
3. **`POST /api/v1/claims/check-documents`**
   * **Mock responds:** `{ "success": true, "allDocsVerified": true, "missingDocs": [] }`
   * *BPM branches to **PolicyValidation** (bypassing NIGO loop).*
4. **`POST /api/v1/claims/validate-policy`** $\rightarrow$ Responds `{ "validationPassed": true }`
5. **`POST /api/v1/claims/validate-beneficiary`** $\rightarrow$ Responds `{ "minorDetected": false }`
6. **`POST /api/v1/claims/validate-bank`** $\rightarrow$ Responds `{ "pvsMatch": true }`
7. **`POST /api/v1/claims/mrx-check`** $\rightarrow$ Responds `{ "alerts": [] }` *(no contestability)*
8. **`POST /api/v1/claims/tax/single-fund`** $\rightarrow$ Returns tax rates.
9. **`POST /api/v1/claims/tax/apply`** $\rightarrow$ Responds `{ "taxExceptions": false }`
10. **`POST /api/v1/claims/calculate`** $\rightarrow$ Returns face value & interest calculation.
11. **`POST /api/v1/claims/misstatement-adjust`** $\rightarrow$ Returns adjustments.
12. **`POST /api/v1/claims/beneficiary-split`** $\rightarrow$ Returns payout split.
13. **`POST /api/v1/claims/backup-withholding`** $\rightarrow$ Returns net payout amounts.
14. **`POST /api/v1/claims/finalize`**
    * **Mock responds:** `{ "success": true, "finalPaymentInstructions": { "status": "DISPATCHED" } }`

🏁 **Expected Outcome:** Process executes under 1 second in the background and reaches **End (Success)**.

---

## 🧪 Scenario 2: Happy Path Terminal Illness (TI) Claim
This tests the accelerated Terminal Illness route using the **TI KNECT Payment Pipeline**.

### 📥 Startup Payload
```json
{
  "caseId": "CASE-TI-HAPPY-002",
  "policyNumber": "POL-98765",
  "claimType": "TI",
  "applicablePolicies": ["POL-98765"],
  "uploadedDocuments": [
    "s3://prudential-claims/claims_form_signed.pdf",
    "s3://prudential-claims/physician_statement_ti.pdf"
  ],
  "policyData": {
    "eligibility_passed": true,
    "requires_manual_review": false
  },
  "bankAccountDetails": {
    "bank_name": "First National Bank",
    "routing_number": "121000248",
    "account_number": "554433221",
    "payment_method": "ACH"
  }
}
```

### ⚙️ Mock API Interactions & Behaviors
* **BPM routes differently at `Is Death Claim?` gateway:** Takes the **No** path (direct to `PolicyValidation`).
* **`POST /api/v1/claims/validate-bank`** $\rightarrow$ Responds `{ "pvsMatch": true }`
* **BPM routes differently at second `Is Death Claim?` gateway:** Takes the **No** path (direct to `MultiFundTax`).
* **`POST /api/v1/claims/tax/multi-fund`** $\rightarrow$ Returns multi-fund tax rates.
* **BPM routes differently at `Payment Route?` gateway:** Takes the **TI** path to `N23: KNECTPayment`.
* **`POST /api/v1/claims/ti-knect-payment`**
  * **Mock responds:** `{ "success": true, "knectTransactionId": "TXN-KNECT-99218A" }`

🏁 **Expected Outcome:** Process reaches **End (Success)** and logs the KNECT Transaction ID.

---

## 🧪 Scenario 3: Death Claim with Missing Documents (NIGO Loop)
This tests the integration and suspension of the process when documents are missing, triggering the **NIGO Subprocess** and waiting for manual document upload.

### 📥 Startup Payload
```json
{
  "caseId": "CASE-DEATH-NIGO-003",
  "policyNumber": "POL-12345",
  "claimType": "DEATH",
  "dateOfDeath": "2025-04-01",
  "applicablePolicies": ["POL-12345"],
  "uploadedDocuments": [] 
}
```

### ⚙️ Mock API Interactions & Behaviors
1. **`POST /api/v1/claims/check-documents`**
   * **Mock responds:** `{ "success": true, "allDocsVerified": false, "missingDocs": ["CERTIFIED_DEATH_CERTIFICATE"] }`
   * *BPM branches to NIGO Subprocess (`pru-nigo-followup`).*
2. **`POST /api/v1/claims/nigo/send`** $\rightarrow$ Responds `{ "success": true, "noticeSentAt": "2026-05-18T12:00:00Z" }`
3. **`POST /api/v1/claims/nigo/funding-notice`** $\rightarrow$ Responds `{ "success": true, "documentS3Key": "nigo/notices/death_funding_notice.pdf" }`
4. **BPM enters Wait State:** Suspends execution on a Catch Signal/Message event named **`DocumentUploaded`**.

### 🔄 How to Resume & Complete Scenario 3:
1. Trigger the **Document Upload Event** on your process instance using KIE Server REST:
   `POST /server/containers/{containerId}/processes/instances/{processInstanceId}/signal/DocumentUploaded`
   *Payload:* `["s3://prudential-claims/certified_death_certificate.pdf"]`
2. **`POST /api/v1/claims/nigo/rerun-idp`** $\rightarrow$ Responds `{ "success": true, "extractionResult": { "verified": true } }`
3. **`POST /api/v1/claims/nigo/update-status`**
   * **Mock responds:** `{ "success": true, "allDocsReceived": true }`
4. **`POST /api/v1/claims/nigo/death-verification`** $\rightarrow$ Responds `{ "success": true, "verificationStatus": "VERIFIED_PUBLIC_RECORDS" }`
5. Subprocess exits; main process resumes from `N9: PolicyValidation` and continues to completion!

---

## 🧪 Scenario 4: Bank Validation Ownership Failure (Manual Underwriting Review)
This tests the automatic escalation to a **Human Task** if Bank Details ownership verification fails.

### 📥 Startup Payload
```json
{
  "caseId": "CASE-DEATH-BANKFAIL-004",
  "policyNumber": "POL-12345",
  "claimType": "DEATH",
  "applicablePolicies": ["POL-12345"],
  "uploadedDocuments": ["s3://claims/death_cert.pdf", "s3://claims/form.pdf"],
  "bankAccountDetails": {
    "bank_name": "Fraud Bank",
    "routing_number": "999999999",
    "account_number": "111111111",
    "payment_method": "ACH"
  }
}
```

### ⚙️ Mock API Interactions & Behaviors
1. **`POST /api/v1/claims/validate-bank`**
   * **Mock responds:** `{ "success": true, "pvsMatch": false, "bankValidationResult": { "error": "OWNER_MISMATCH" } }`
2. **BPM Escales to Human Task:** Suspends execution on node `N16: ExaminerReview` in Business Central.
3. **Task Owner:** Mapped to group `ClaimExaminer`.

### 🔄 How to Resume & Complete Scenario 4:
An Underwriter claims the task and makes a decision:
* **Option A (Approve / Force Override):** The underwriter overrides the banking flag. The flow resumes to `N13b` and successfully finishes automated payment.
* **Option B (Reject / Abort):** The underwriter aborts the claim. The flow goes to `N3: LogError` and reaches `End (Failed)`.

---

## 🧪 Scenario 5: Contestability Check Failure (Suicide/Contestable Flags)
This tests escalation to manual underwriting if a claim flags contestability rules.

### 📥 Startup Payload
Include suicide flags or contestable dates:
```json
{
  "caseId": "CASE-DEATH-CONTEST-005",
  "policyNumber": "POL-12345",
  "claimType": "DEATH",
  "dateOfDeath": "2025-04-01"
}
```

### ⚙️ Mock API Interactions & Behaviors
1. **`POST /api/v1/claims/mrx-check`**
   * **Mock responds:** `{ "success": true, "alerts": ["SUICIDE_CONTESTABLE_WINDOW"], "mrxCheckResult": { "isSuicide": true, "isContestable": true } }`
2. **BPM Escales to Human Task:** Bypasses automated payment nodes and routes directly to node `N16: ExaminerReview` (Manual Underwriting).


---

## 🧪 Scenario 6: Ingestion Data Invalidation (VALFAIL)
This tests the bootstrap validation failure where the claim is rejected immediately at step `N1: ValidateData` and routed to `N3: LogError` to write audit logs.

### 📥 Startup Payload
```json
{
  "caseId": "CASE-DEATH-VALFAIL-006",
  "policyNumber": "POL-12345",
  "claimType": "DEATH",
  "applicablePolicies": ["POL-12345"]
}
```

### ⚙️ Mock API Interactions & Behaviors
1. **`POST /api/v1/claims/validate-data`**
   * **Mock responds:**
     ```json
     {
       "success": true,
       "validationPassed": false,
       "policyFlags": {
         "isSuicide": false,
         "isContestable": false,
         "isForeignDeath": false,
         "isAIDS": false
       },
       "validationErrors": [
         { "field": "claimType", "error": "Claim type selection is missing or invalid" },
         { "field": "primaryPolicyNumber", "error": "Target policy status is inactive" }
       ]
     }
     ```
2. **BPM execution branches to "No" path at exclusive gateway:** Routes directly to node `N3: LogError` (dynamic `validationErrors` list parsed by BPMN exit script).
3. **`POST /api/v1/audit/log-failure`**
   * **BPM sends:**
     ```json
     {
       "piid": "...",
       "caseId": "CASE-DEATH-VALFAIL-006",
       "errors": [
         { "field": "claimType", "error": "Claim type selection is missing or invalid" },
         { "field": "primaryPolicyNumber", "error": "Target policy status is inactive" }
       ]
     }
     ```
   * **Mock responds:** `{ "success": true, "auditLogId": "AUD-129481" }`
4. Process terminates at **End: Failure**.


---

## 🧪 Scenario 7: Tax Rules Exception (TAXEXCEPT)
This tests the branching where a tax exception is flagged at node `N14: ApplyTax` and escalated to manual underwriter review `N16: ExaminerReview`.

### 📥 Startup Payload
```json
{
  "caseId": "CASE-DEATH-TAXEXCEPT-007",
  "policyNumber": "POL-12345",
  "claimType": "DEATH",
  "applicablePolicies": ["POL-12345"]
}
```

  * **Mock responds:**
     ```json
     {
       "success": true,
       "taxExceptions": true,
       "taxCheckResult": {
         "withholdingApplied": true,
         "irsReportingGenerated": true
       }
     }
     ```
2. **BPM execution branches to "Yes" path at Tax Exceptions gateway:** Routes directly to node `N16: ExaminerReview` (Manual Underwriting).
3. **BPM suspends execution at Human Task:** Wait for underwriter approval.


---

## 🧪 Scenario 8: Policy Lapsed or Inactive (LAPSE / POLICYFAIL)
Tests policy validation failing on the mainframe, flagging the policy as inactive.

### 📥 Startup Payload
```json
{
  "caseId": "CASE-DEATH-LAPSE-008",
  "policyNumber": "POL-12345",
  "claimType": "DEATH"
}
```

### ⚙️ Mock API Interactions & Behaviors
1. **`POST /api/v1/claims/validate-policy`**
   * **Mock responds:**
     ```json
     {
       "success": true,
       "validationPassed": false,
       "policyFlags": {
         "isActive": false,
         "premiumsPaid": false,
         "hasLapseAlert": true
       }
     }
     ```

---

## 🧪 Scenario 9: Beneficiary Verification Mismatches & Sanctions (MINOR / SANCTION)
Tests human verification flows when a beneficiary is identified as a minor or hits a sanctions registry warning.

### 📥 Startup Payload
```json
{
  "caseId": "CASE-DEATH-MINOR-009",
  "policyNumber": "POL-12345",
  "claimType": "DEATH"
}
```

### ⚙️ Mock API Interactions & Behaviors
1. **`POST /api/v1/claims/validate-beneficiary`**
   * **Mock responds:**
     ```json
     {
       "success": true,
       "minorDetected": true,
       "beneficiaryFlags": {
         "identitiesVerified": true,
         "sanctionsChecked": true
       }
     }
     ```

---

## 🧪 Scenario 10: Misstatement Adjustment Flow (MISSTATE)
Tests dynamic payout recalculation when a misstatement of age or gender is detected during calculations.

### 📥 Startup Payload
```json
{
  "caseId": "CASE-DEATH-MISSTATE-010",
  "policyNumber": "POL-12345",
  "claimType": "DEATH"
}
```

### ⚙️ Mock API Interactions & Behaviors
1. **`POST /api/v1/claims/calculate`**
   * **Mock responds:** Sets `outstandingLoans` to `30000.00` and returns `netPayout: 221250.00`.
2. **`POST /api/v1/claims/misstatement-adjust`**
   * **Mock responds:** Applies adjustment reduction of `20000.00` returning `adjustedPayout: 201250.00`.
3. **`POST /api/v1/claims/beneficiary-split`**
   * **Mock responds:** Dynamically returns a single split of `201250.00`.

---

## 🧪 Scenario 11: Backup Withholding Deduction (WITHHOLD)
Tests IRS backup withholding checks where 24% is withheld from the final payout amount.

### 📥 Startup Payload
```json
{
  "caseId": "CASE-DEATH-WITHHOLD-011",
  "policyNumber": "POL-12345",
  "claimType": "DEATH"
}
```

### ⚙️ Mock API Interactions & Behaviors
1. **`POST /api/v1/claims/backup-withholding`**
   * **Mock responds:**
     ```json
     {
       "success": true,
       "withholdingResult": {
         "withholdingDeducted": 60300.00,
         "finalPayout": 190950.00
       },
       "finalPayouts": [
         { "beneficiary": "John Doe", "amount": 190950.00 }
       ]
     }
     ```

---

## 🧪 Scenario 12: Payment Finalization Gate Failure (PAYFAIL)
Tests behavior when the payment dispatch gateway rejects or fails the transaction.

### 📥 Startup Payload
```json
{
  "caseId": "CASE-DEATH-PAYFAIL-012",
  "policyNumber": "POL-12345",
  "claimType": "DEATH"
}
```

### ⚙️ Mock API Interactions & Behaviors
1. **`POST /api/v1/claims/finalize`**
   * **Mock responds:** `{ "success": false, "finalPaymentInstructions": { "paymentGateway": "EFT", "payoutStatus": "FAILED", "bankRefNum": null } }`

---

## 🧪 Scenario 13: NIGO Loop Followup Outstanding (PARTIAL / NIGOFAIL)
Tests loop execution when a document check is updated but still has unresolved outstanding requirements.

### 📥 Startup Payload
```json
{
  "caseId": "CASE-DEATH-PARTIAL-013",
  "policyNumber": "POL-12345",
  "claimType": "DEATH"
}
```

### ⚙️ Mock API Interactions & Behaviors
1. **`POST /api/v1/claims/nigo/update-status`**
   * **Mock responds:** `{ "success": true, "allDocsReceived": false }`
   * *Resumes to NIGO Subprocess loop and escalates to N9: ExaminerPartialReview.*

---

## 🛠️ Route Overrides & Failure Injection (Auto-Retry & Admin Decisions)
You can dynamically force any mock endpoint to fail a specific number of times (to test automated retry logic in `pru-api-error-handler.bpmn`) or persistently (to test manual admin decision and retry/skip paths).

### 📥 1. Configure Auto-Retry Test (Temporary Failures)
Forces an API endpoint to return errors a set number of times, after which it automatically heals and succeeds.
* **HTTP Method:** `POST`
* **URL:** `/api/mock/override`
* **Sample Payload (Fail 2 times with 503, then succeed):**
  ```json
  {
    "path": "/api/v1/claims/validate-policy",
    "status": 503,
    "failCount": 2,
    "response": {
      "success": false,
      "error": "Temporary connection timeout to policy mainframe"
    }
  }
  ```

### 📥 2. Configure Persistent Failure (For Admin Manual Actions)
Forces an API endpoint to fail persistently until manually cleared, allowing you to test human intervention (e.g. administrative retry/skip/terminate decisions).
* **HTTP Method:** `POST`
* **URL:** `/api/mock/override`
* **Sample Payload:**
  ```json
  {
    "path": "/api/v1/claims/validate-policy",
    "status": 500,
    "success": false,
    "response": {
      "success": false,
      "error": "Persistent authorization exception"
    }
  }
  ```

### 📥 3. View All Configured Overrides
* **HTTP Method:** `GET`
* **URL:** `/api/mock/overrides`

### 📥 4. Clear/Reset Overrides
* **HTTP Method:** `DELETE`
* **URL:** `/api/mock/override`
* **Sample Payload (Clear specific path):**
  ```json
  {
    "path": "/api/v1/claims/validate-policy"
  }
  ```
* **Note:** Send an empty payload `{}` or omit the body to clear **all** configured overrides.

---

## ⚡ KIE Server & jBPM REST APIs Integration
This allows developers and testers to execute the entire claims lifecycle interactively inside the **Swagger UI (`http://localhost:3010/api-docs`)** without facing CORS or authentication configuration issues!

> [!TIP]
> **Swagger Authentication:** We have configured a global Basic Authentication requirement (`basicAuth`) in Swagger. Click the **"Authorize"** button at the top-right of the Swagger UI page, enter your jBPM username (e.g., `krisv`) and password (e.g., `krisv`), and all API requests made from the browser will automatically carry your authenticated headers to the mock server and remote jBPM engine.

### 📥 1. Start Process Instance
Create a new claims orchestration run.
* **HTTP Method:** `POST`
* **URL:** `/kie-server/services/rest/server/containers/prudential-claims-bpm_1.0.0-SNAPSHOT/processes/prudential-claims-submission.pru-claim-internal-processing/instances`
* **Headers:**
  * `Content-Type: application/json`
  * `Authorization: Basic a3Jpc3Y6a3Jpc3Y=` (krisv/krisv)
* **Sample Payload:**
  ```json
  {
    "caseId": "CASE-DEATH-BANKFAIL-104",
    "policyNumber": "POL-12345",
    "claimType": "DEATH",
    "applicablePolicies": ["POL-12345"]
  }
  ```
* **Response (201 Created):** Returns the Process Instance ID (e.g. `1059`).

### 📥 2. Query Human Task List
Retrieve active examiner tasks (e.g., when routing escalates to `N16: ExaminerReview`).
* **HTTP Method:** `GET`
* **URL:** `/kie-server/services/rest/server/queries/tasks/instances/pot-owners?status=Ready,Reserved,InProgress`
* **Response (200 OK):**
  ```json
  {
    "task-summary": [
      {
        "task-id": 89,
        "task-name": "N16: ExaminerReview",
        "task-status": "Ready",
        "task-process-instance-id": 1059,
        "task-container-id": "prudential-claims-bpm_1.0.0-SNAPSHOT"
      }
    ]
  }
  ```

### 📥 3. Claim Human Task
Assign the task to yourself before completing it.
* **HTTP Method:** `PUT`
* **URL:** `/kie-server/services/rest/server/containers/prudential-claims-bpm_1.0.0-SNAPSHOT/tasks/89/states/claimed`
* **Response (200 OK):** Empty success body.

### 📥 4. Start Human Task
Move the task status to started.
* **HTTP Method:** `PUT`
* **URL:** `/kie-server/services/rest/server/containers/prudential-claims-bpm_1.0.0-SNAPSHOT/tasks/89/states/started`
* **Response (200 OK):** Empty success body.

### 📥 5. Complete Human Task
Submit the examiner's decision (e.g. approval, overrides) to resume automated execution!
* **HTTP Method:** `PUT`
* **URL:** `/kie-server/services/rest/server/containers/prudential-claims-bpm_1.0.0-SNAPSHOT/tasks/89/states/completed`
* **Sample Payload:**
  ```json
  {
    "isApproved": true,
    "examinerOverrideRemarks": "Banking mismatch overridden; claimant details validated"
  }
  ```
* **Response (200 OK):** Process instance automatically continues executing remaining workflow nodes.

### 📥 6. Signal NIGO Document Upload
Delivers an external signal (e.g., `DocumentUploaded`) to resume execution on NIGO loops.
* **HTTP Method:** `POST`
* **URL:** `/kie-server/services/rest/server/containers/prudential-claims-bpm_1.0.0-SNAPSHOT/processes/instances/1059/signal/DocumentUploaded`
* **Sample Payload (Array of Uploaded URLs):**
  ```json
  [
    "s3://claims/certified_death_certificate.pdf"
  ]
  ```
* **Response (200 OK):** Process instance evaluates documents and completes if checklist is satisfied!

---

## 👤 User Accounts, Roles & Task Visibility

When executing and testing human task flows, the jBPM process engine delegates tasks to specific roles (groups) instead of hardcoding user assignments. Use the following configuration in your KIE Server registry to log in and query task lists:

### 🔑 Configured Testing Users
*   **`krisv`** (Password: `krisv`)
    *   *Roles/Groups:* `ClaimExaminer`, `SystemAdmin`
    *   *Testing Use:* Can access all examiner review tasks and IT admin exception reviews.
*   **`john`** (Password: `john`)
    *   *Roles/Groups:* `ClaimExaminer`
    *   *Testing Use:* Can access examiner review tasks (`ExaminerReview` and `ExaminerPartialReview`).
*   **`mary`** (Password: `mary`)
    *   *Roles/Groups:* `SeniorInvestigator`
    *   *Testing Use:* Can access death verification tasks (`ExaminerDeathVerif`).

### ⚙️ Task Search & Claiming Mechanics
1.  **Group and User Search:** If a task is assigned to a group (e.g. `ClaimExaminer`), any user in that group can query it. The `/queries/tasks/instances/pot-owners` API will return all tasks that the calling user is eligible to claim.
2.  **Claiming a Task:** A group member must claim the task to work on it. Once claimed:
    *   The task `actualOwner` is set to that specific user.
    *   The task status transitions to `Reserved`.
    *   It is hidden from the `pot-owners` ready task queue of other group members.
3.  **Returning All Tasks:** The `/pot-owners` query API **does not** return all tasks in the system globally; it is security-filtered to the caller's identity. To view all tasks globally (e.g., for reporting or general monitoring), you must:
    *   Use the **Administrative Query API**: `/kie-server/services/rest/server/admin/queries/tasks/instances` (requires a user with the `admin` role).
    *   Query the process instance task list: `/kie-server/services/rest/server/queries/tasks/instances/process/{processInstanceId}`.
    *   Directly query the jBPM schema database (`AuditTaskImpl` / `Task` tables).

---

## 📋 Approval & Implementation Plan

> [!IMPORTANT]
> Once you approve this test scenario mapping:
> 1. We will update the **Mock Server `server.js`** file to handle these conditional mock behaviors based on the incoming `caseId` (e.g. returning `pvsMatch: false` if caseId contains `BANKFAIL`).
> 2. This will allow you to run automated or manual end-to-end tests simply by changing the `caseId` in your startup payload!

