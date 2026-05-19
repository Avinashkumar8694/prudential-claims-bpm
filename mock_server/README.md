# Prudential Claims jBPM Mock Integration Server

This directory contains a complete, lightweight Node.js Express server that mocks **all 24 REST API endpoints** invoked by the Prudential Claims jBPM workflows. It logs request payloads in real-time, allowing you to inspect execution and validate variables easily.

---

## 1. 🚀 Quick Start (Local Run)

### Prerequisites
*   Node.js (v16+) installed on your machine.

### Installation
From this directory, run:
```bash
npm install
```

### Start Server
Start the Express server on local port `3010`:
```bash
npm start
```
You will see:
```text
🚀 Prudential Claims Mock Server Running on Port 3010
Waiting for jBPM REST WorkItem invocations...
```

### 📖 Interactive Swagger API Documentation
Once the server is running, you can access the interactive Swagger UI dashboard locally at:
*   [http://localhost:3010/api-docs](http://localhost:3010/api-docs)

This interactive dashboard lists all 24 API endpoints, documents their payload parameters, and allows you to manually trigger mock API calls directly from your browser!

---

## 2. 🌐 Expose Mock Server to KIE Server via `ngrok`

If your KIE Server / Business Central instance runs in an external network or a container, you need to expose your local port `3010` via **`ngrok`**:

### Step 1: Fire up the tunnel
Run the following ngrok command in a new terminal window:
```bash
ngrok http 3010
```

### Step 2: Grab the forwarding URL
Ngrok will generate a secure public forwarding URL, for example:
```text
Forwarding     https://a3c5-203-0-113-195.ngrok-free.app -> http://localhost:3010
```
Copy your forwarding URL (e.g. `https://a3c5-203-0-113-195.ngrok-free.app`).

---

## 3. ⚙️ Configure jBPM to use the Tunnel URL

Now, tell the jBPM process engine to route all REST Task calls through your secure ngrok tunnel:

### Method A: JVM Start Property (Application Server)
Add the ngrok URL to your WildFly / JBoss EAP JVM start arguments:
```bash
-DINTEGRATION_LAYER_URL=https://a3c5-203-0-113-195.ngrok-free.app
```

### Method B: KIE Workbench UI (Per-Project Level)
1. Go to **Menu** &rarr; **Design** &rarr; **Projects** &rarr; **`prudential-claims-bpm`**.
2. Click **Settings** &rarr; **Deployments** &rarr; **Environment Entries**.
3. Edit the value for **`INTEGRATION_LAYER_URL`** to your ngrok URL:
   *   **Value:** `"https://a3c5-203-0-113-195.ngrok-free.app"` *(Ensure it has double quotes around it)*.
4. Save and Re-deploy the project.

---

## 📊 Mock Endpoints List

### Process 1 (Internal Processing) APIs:
1.  `POST /api/v1/claims/validate-data` — Triggers dynamic data validation schema checks.
2.  `POST /api/v1/audit/log-failure` — Logs failures in audit ledger.
3.  `PUT /api/v1/policy/status` — Updates policy status to `PENDING_DEATH_CLAIM`.
4.  `POST /api/v1/claims/check-documents` — Returns if outstanding requirements exist.
5.  `POST /api/v1/claims/validate-policy` — Runs eligibility rules.
6.  `POST /api/v1/claims/validate-beneficiary` — Validates beneficiary lists and minor triggers.
7.  `POST /api/v1/claims/validate-bank` — PVS bank details check.
8.  `POST /api/v1/claims/mrx-check` — Contestability MRX trigger.
9.  `POST /api/v1/claims/tax/multi-fund` — Accelerated benefit fund tax withholding check.
10. `POST /api/v1/claims/tax/single-fund` — Standard claim single fund tax withholding check.
11. `POST /api/v1/claims/tax/apply` — Applies computed IRS rules.
12. `POST /api/v1/claims/calculate` — Performs standard benefit amount arithmetic.
13. `POST /api/v1/claims/misstatement-adjust` — Applies age/sex misstatement rules.
14. `POST /api/v1/claims/beneficiary-split` — Calculates final payout fractions.
15. `POST /api/v1/claims/backup-withholding` — Applies IRS backup withholdings.
16. `POST /api/v1/claims/finalize` — Generates payment instructions.
17. `POST /api/v1/claims/ti-knect-payment` — Dispatches accelerated KNECT payment instruction.

### Process 2 (NIGO Followup) APIs:
18. `POST /api/v1/claims/nigo/send` — Triggers first dynamic NIGO notice.
19. `POST /api/v1/claims/nigo/funding-notice` — Generates funding requirement PDF notice.
20. `POST /api/v1/claims/nigo/standard-notice` — Generates TI requirements PDF notice.
21. `POST /api/v1/claims/nigo/auto-followup` — Dispatches automated followups.
22. `POST /api/v1/claims/nigo/rerun-idp` — Re-triggers optical character document classification.
23. `POST /api/v1/claims/nigo/update-status` — Re-checks missing documents index.
24. `POST /api/v1/claims/nigo/death-verification` — Simulates public records death check.

---

## 👤 5. User Accounts, Roles & Task Routing

To test the User/Human Task nodes, the process engine assigns tasks to roles/groups rather than specific individuals. Ensure your KIE Server User Registry (e.g. `application-users.properties` and `application-roles.properties`) is configured with the following credentials and group memberships:

| Username | Password | Assigned Groups / Roles | Description |
| :--- | :--- | :--- | :--- |
| **`krisv`** | `krisv` | `ClaimExaminer`, `SystemAdmin` | Can view and work on both standard examiner reviews and IT admin exceptions. |
| **`john`** | `john` | `ClaimExaminer` | Standard Claim Examiner. Can view/work on `ExaminerReview` and `ExaminerPartialReview`. |
| **`mary`** | `mary` | `SeniorInvestigator` | Senior Investigator. Can view and work on `ExaminerDeathVerif` (Death Verification). |

### 🔍 How Task Routing & Visibility Works
* **Group Queue:** Tasks assigned to groups (e.g. `ClaimExaminer`) will appear in the tasks list query (`pot-owners`) for any user belonging to that group.
* **Task Claiming:** A user must **claim** a task to assign it to themselves (setting themselves as the `actualOwner`). Once claimed, the task is reserved, and other group members will no longer see it in their queues.
* **Pot Owners Scope:** The `/queries/tasks/instances/pot-owners` API *only* returns tasks that the calling user is eligible to claim. It will **not** return all tasks in the system. To view all tasks globally, you must use administrative APIs (requiring `admin` role) or query the jBPM Audit tables directly.

