# Case Service Solution - Consolidated Claim Case Design

This document details the architectural design for consolidating claims-related entities from `data_model.png` into a single, cohesive **Case Object** managed via a dedicated **Case Service**. 

The Case Service exposes CRUD APIs (`create`, `retrieve`, `update`, `delete`, `list`) allowing the Node.js API integration layer and jBPM workflows to access and modify the entire claims context in a single, transactional document format.

---

## 🏗️ Case Object Architecture & JSON Schema

The consolidated Claim Case structure is designed to hold all state and operational parameters of a claim as it moves through its lifecycle. To protect system scalability and audit trails, the following logs/raw data are **excluded** from the nested Case Object and remain in dedicated relational tables:
* `claim_extraction_details` (Raw/structured OCR data output from IDP)
* `claim_nigo_log` (NIGO process attempts and details)
* `claim_audit_log` (Compliance audit events)

*Note: Document metadata, originally stored solely in `claim_document`, is now represented directly inside the root `documents` array of the Case Object for operational access, while the physical S3 assets remain tracked via the database.*

### 1. JSON Schema Definition
Below is the TypeScript/JSON-style representation of the generalized Case Object schema, updated to include the root-level `documents` array (which aggregates `poa_document_file_name` and other `documents_included` files):

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ClaimCase",
  "type": "object",
  "required": [
    "caseId",
    "policyNumber",
    "claimType",
    "caseStatus"
  ],
  "properties": {
    "caseId": { "type": "string", "format": "uuid", "description": "Unique identifier of the consolidated claim case" },
    "policyNumber": { "type": "string", "description": "Primary policy number that initiated the claim" },
    "claimType": { "type": "string", "enum": ["DEATH", "TI"], "description": "Claim type: DEATH or Terminal Illness (TI)" },
    "dateOfDeath": { "type": ["string", "null"], "format": "date", "description": "Extracted Date of Death (null for TI claims)" },
    "causeOfDeath": { "type": ["string", "null"], "description": "Primary cause of death (natural, accidental, etc.)" },
    "placeOfDeath": { "type": ["string", "null"], "description": "Place/City/Hospital of death" },
    "caseStatus": {
      "type": "string",
      "enum": ["DRAFT", "SUBMITTED", "PENDING_DEATH", "PENDING_NIGO", "UNDER_REVIEW", "APPROVED", "PAYMENT_INITIATED", "PAYMENT_FAILED", "COMPLETED", "TERMINATED"],
      "description": "Lifecycle status of the claim case"
    },
    "examinerResolution": { "type": ["string", "null"], "enum": ["APPROVED", "REJECTED"], "description": "Resolution from manual review task" },
    "examinerComment": { "type": ["string", "null"], "description": "Manual justification or override remarks from the examiner" },
    "interestMethodConfirmed": { "type": "boolean", "description": "True if the examiner manually confirmed the DCF interest calculation method" },
    "totalPayoutAmount": { "type": "number", "description": "Aggregated payout amount across all policies" },
    "jbpmProcessInstanceId": { "type": ["integer", "null"], "description": "Process Instance ID (piid) tying this case to the active jBPM instance" },
    "createdAt": { "type": "string", "format": "date-time" },
    "updatedAt": { "type": "string", "format": "date-time" },
    
    "claimant": {
      "type": "object",
      "required": ["first_name", "last_name", "relationship"],
      "properties": {
        "claimantId": { "type": "string", "format": "uuid" },
        "relationship": { "type": "string", "description": "Relationship to the insured (SPOUSE, CHILD, SELF, etc.)" },
        "ssnToken": { "type": ["string", "null"], "description": "Tokenized or encrypted SSN" },
        "bankDetailsToken": { "type": ["string", "null"], "description": "Tokenized/encrypted bank account information" },
        "role": { "type": "string" },
        "poa_documentation_required": { "type": "boolean" },
        "poa_document_file_name": { "type": ["string", "null"] },
        "first_name": { "type": "string" },
        "middle_name": { "type": ["string", "null"] },
        "last_name": { "type": "string" },
        "suffix": { "type": ["string", "null"] },
        "date_of_birth": { "type": "string" },
        "state": { "type": "string" },
        "country": { "type": "string" },
        "social_security_number": { "type": "string" },
        "phone": { "type": "string" },
        "email": { "type": "string" },
        "address_line1": { "type": "string" },
        "city": { "type": "string" },
        "state_of_residence": { "type": "string" },
        "zip_code": { "type": "string" }
      }
    },
    
    "policyDetails": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["policyNumber", "planCode", "pasLockStatus", "faceAmount"],
        "properties": {
          "policyNumber": { "type": "string" },
          "planCode": { "type": "string", "description": "PAS Plan Code (e.g. TERM-80, VUL-1)" },
          "pasLockStatus": { "type": "string", "enum": ["PENDING", "LOCKED", "FAILED"] },
          "faceAmount": { "type": "number" },
          "adjustedFaceAmount": { "type": "number", "description": "Face amount verified against the PAS Mainframe" },
          "interestAmount": { "type": "number", "description": "Calculated interest from Date of Death" },
          "misstatementAdjustment": { "type": "number", "description": "Adjustments due to age/gender misstatement (+/-)" },
          "netBenefitAmount": { "type": "number", "description": "Final net benefit (Base + Interest +/- Adjustments)" },
          "refreshedAt": { "type": "string", "format": "date-time" }
        }
      }
    },
    
    "beneficiaries": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["beneficiaryId", "policyNumber", "first_name", "last_name", "splitPercentage"],
        "properties": {
          "beneficiaryId": { "type": "string", "format": "uuid" },
          "policyNumber": { "type": "string", "description": "The specific policy this payout is attached to" },
          "role": { "type": "string" },
          "poa_documentation_required": { "type": "boolean" },
          "poa_document_file_name": { "type": ["string", "null"] },
          "first_name": { "type": "string" },
          "middle_name": { "type": ["string", "null"] },
          "last_name": { "type": "string" },
          "suffix": { "type": ["string", "null"] },
          "isAdult": { "type": "boolean", "description": "Age verification outcome from PAS" },
          "splitPercentage": { "type": "number", "minimum": 0, "maximum": 100 },
          "benefitAmount": { "type": "number", "description": "Final payout amount for this payee" },
          "paymentMethod": { "type": "string", "enum": ["ACH", "WIRE", "CHECK"] },
          "paymentStatus": { "type": "string", "enum": ["PENDING", "IN_FLIGHT", "SUCCESS", "FAILED"] },
          "paymentRefNo": { "type": ["string", "null"], "description": "Transaction reference number from the payment gateway" }
        }
      }
    },
    
    "taxWithholdings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["taxId", "beneficiaryId", "policyNumber", "taxWithholdingAmount"],
        "properties": {
          "taxId": { "type": "string", "format": "uuid" },
          "beneficiaryId": { "type": "string", "format": "uuid", "description": "Associated beneficiary receiving the payout" },
          "policyNumber": { "type": "string" },
          "taxWithholdingAmount": { "type": "number", "description": "Withholding tax amount to deduct" },
          "requiresManualReview": { "type": "boolean" },
          "triggeredAt": { "type": "string", "format": "date-time" },
          "taxpayer_status": { "type": "string" },
          "tax_form_type": { "type": "string" },
          "social_security_number": { "type": "string" },
          "federal_tax_classification": { "type": "string" },
          "federal_withholding_elected": { "type": "boolean" },
          "certification_agreed": { "type": "boolean" }
        }
      }
    },
    
    "documents": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["document_name", "required", "document_type", "type"],
        "properties": {
          "document_name": { "type": "string" },
          "required": { "type": "boolean" },
          "document_type": { "type": "string" },
          "type": { "type": "string" }
        }
      }
    },
    
    "quote_package": {
      "type": ["object", "null"],
      "required": ["quote_reference_number", "requested_on", "quote_validity_days", "administrative_fee"],
      "properties": {
        "quote_reference_number": { "type": "string" },
        "requested_on": { "type": "string" },
        "quote_validity_days": { "type": "integer" },
        "administrative_fee": { "type": "number" },
        "package_downloaded": { "type": "boolean" },
        "documents_included": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["document_name", "required", "document_type", "type"],
            "properties": {
              "document_name": { "type": "string" },
              "required": { "type": "boolean" },
              "document_type": { "type": "string" },
              "type": { "type": "string" }
            }
          }
        }
      }
    },
    
    "flags": {
      "type": "object",
      "properties": {
        "caseLevel": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["flagId", "flagType", "triggeredAt"],
            "properties": {
              "flagId": { "type": "string", "format": "uuid" },
              "flagType": { "type": "string", "enum": ["FOREIGN_DEATH", "SUICIDE", "AIDS"] },
              "triggeredAt": { "type": "string", "format": "date-time" }
            }
          }
        },
        "policyLevel": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["flagId", "flagType", "triggeredAt"],
            "properties": {
              "flagId": { "type": "string", "format": "uuid" },
              "policyNumber": { "type": "string" },
              "flagType": { "type": "string", "enum": ["CSLN_ALERT", "LAPSE_ALERT", "REINSTATEMENT"] },
              "triggeredAt": { "type": "string", "format": "date-time" }
            }
          }
        },
        "beneficiaryLevel": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["flagId", "beneficiaryId", "flagType", "triggeredAt"],
            "properties": {
              "flagId": { "type": "string", "format": "uuid" },
              "beneficiaryId": { "type": "string", "format": "uuid" },
              "flagType": { "type": "string", "enum": ["MINOR_DETECTED", "SANCTIONS_WARNING", "INCORRECT_PAYMENT_INFO"] },
              "triggeredAt": { "type": "string", "format": "date-time" }
            }
          }
        }
      }
    }
  }
}
```

---

## 🗄️ Database Table Mapping

To provide transparency on how this JSON Case Object maps to the relational backend schema in `data_model.png` (integrated with the new claimant, beneficiary, tax, and documents structures), the following table details the schema matching:

| JSON Key path | Database Table | Database Column | Data Type | Key Constraints |
| :--- | :--- | :--- | :--- | :--- |
| `caseId` | `claim_case` | `case_id` | UUID | PK |
| `policyNumber` | `claim_case` | `policy_number` | VARCHAR | |
| `claimType` | `claim_case` | `claim_type` | VARCHAR | |
| `dateOfDeath` | `claim_case` | `date_of_death` | DATE | Nullable for TI |
| `causeOfDeath` | `claim_case` | `cause_of_death` | VARCHAR | |
| `placeOfDeath` | `claim_case` | `place_of_death` | VARCHAR | |
| `caseStatus` | `claim_case` | `case_status` | VARCHAR | |
| `examinerResolution` | `claim_case` | `examiner_resolution` | VARCHAR | |
| `examinerComment` | `claim_case` | `examiner_comment` | TEXT | |
| `interestMethodConfirmed`| `claim_case` | `interest_method_confirmed`| BOOLEAN | |
| `totalPayoutAmount` | `claim_case` | `total_payout_amount` | DECIMAL | |
| `jbpmProcessInstanceId` | `claim_case` | `jbpm_process_instance_id`| BIGINT | FK / Reference |
| `createdAt` | `claim_case` | `created_at` | TIMESTAMP | |
| `updatedAt` | `claim_case` | `updated_at` | TIMESTAMP | |
| `claimant.claimantId` | `claim_claimant` | `claimant_id` | UUID | PK |
| `claimant.relationship` | `claim_claimant` | `relationship` | VARCHAR | |
| `claimant.ssnToken` | `claim_claimant` | `ssn_token` | VARCHAR | PII Encrypted |
| `claimant.bankDetailsToken`| `claim_claimant` | `bank_details_token`| VARCHAR | PII Encrypted |
| `claimant.role` | `claim_claimant` | `role` | VARCHAR | |
| `claimant.poa_documentation_required`| `claim_claimant`| `poa_documentation_required`| BOOLEAN| |
| `claimant.poa_document_file_name`| `claim_claimant` | `poa_document_file_name`| VARCHAR | |
| `claimant.first_name` | `claim_claimant` | `first_name` | VARCHAR | |
| `claimant.middle_name` | `claim_claimant` | `middle_name` | VARCHAR | |
| `claimant.last_name` | `claim_claimant` | `last_name` | VARCHAR | |
| `claimant.suffix` | `claim_claimant` | `suffix` | VARCHAR | |
| `claimant.date_of_birth` | `claim_claimant` | `date_of_birth` | DATE | |
| `claimant.state` | `claim_claimant` | `state` | VARCHAR | |
| `claimant.country` | `claim_claimant` | `country` | VARCHAR | |
| `claimant.social_security_number`| `claim_claimant` | `social_security_number`| VARCHAR| |
| `claimant.phone` | `claim_claimant` | `phone` | VARCHAR | |
| `claimant.email` | `claim_claimant` | `email` | VARCHAR | |
| `claimant.address_line1` | `claim_claimant` | `address_line1` | VARCHAR | |
| `claimant.city` | `claim_claimant` | `city` | VARCHAR | |
| `claimant.state_of_residence`| `claim_claimant` | `state_of_residence`| VARCHAR | |
| `claimant.zip_code` | `claim_claimant` | `zip_code` | VARCHAR | |
| `policyDetails[].policyNumber` | `claim_policy_details`| `policy_number` | VARCHAR | |
| `policyDetails[].planCode` | `claim_policy_details`| `plan_code` | VARCHAR | |
| `policyDetails[].pasLockStatus`| `claim_policy_details`| `pas_lock_status` | VARCHAR | |
| `policyDetails[].faceAmount` | `claim_policy_details`| `face_amount` | DECIMAL | |
| `policyDetails[].adjustedFaceAmount`| `claim_policy_details`| `adjusted_face_amount`| DECIMAL | |
| `policyDetails[].interestAmount`| `claim_policy_details`| `interest_amount` | DECIMAL | |
| `policyDetails[].misstatementAdjustment`| `claim_policy_details`| `misstatement_adjustment`| DECIMAL | |
| `policyDetails[].netBenefitAmount`| `claim_policy_details`| `net_benefit_amount`| DECIMAL | |
| `policyDetails[].refreshedAt` | `claim_policy_details`| `refreshed_at` | TIMESTAMP | |
| `beneficiaries[].beneficiaryId`| `claim_beneficiary`| `beneficiary_id` | UUID | PK |
| `beneficiaries[].policyNumber`| `claim_beneficiary`| `policy_number` | VARCHAR | |
| `beneficiaries[].role` | `claim_beneficiary`| `role` | VARCHAR | |
| `beneficiaries[].poa_documentation_required`| `claim_beneficiary`| `poa_documentation_required`| BOOLEAN| |
| `beneficiaries[].poa_document_file_name`| `claim_beneficiary`| `poa_document_file_name`| VARCHAR| |
| `beneficiaries[].first_name` | `claim_beneficiary`| `first_name` | VARCHAR | |
| `beneficiaries[].middle_name` | `claim_beneficiary`| `middle_name` | VARCHAR | |
| `beneficiaries[].last_name` | `claim_beneficiary`| `last_name` | VARCHAR | |
| `beneficiaries[].suffix` | `claim_beneficiary`| `suffix` | VARCHAR | |
| `beneficiaries[].isAdult` | `claim_beneficiary`| `is_adult` | BOOLEAN | |
| `beneficiaries[].splitPercentage`| `claim_beneficiary`| `split_percentage` | DECIMAL | |
| `beneficiaries[].benefitAmount`| `claim_beneficiary`| `benefit_amount` | DECIMAL | |
| `beneficiaries[].paymentMethod`| `claim_beneficiary`| `payment_method` | VARCHAR | |
| `beneficiaries[].paymentStatus`| `claim_beneficiary`| `payment_status` | VARCHAR | |
| `beneficiaries[].paymentRefNo` | `claim_beneficiary`| `payment_ref_no` | VARCHAR | |
| `taxWithholdings[].taxId` | `claim_tax_withholding`| `tax_id` | UUID | PK |
| `taxWithholdings[].beneficiaryId`| `claim_tax_withholding`| `beneficiary_id` | UUID | FK -> `claim_beneficiary` |
| `taxWithholdings[].policyNumber`| `claim_tax_withholding`| `policy_number` | VARCHAR | |
| `taxWithholdings[].taxWithholdingAmount`| `claim_tax_withholding`| `tax_withholding_amount`| DECIMAL | |
| `taxWithholdings[].requiresManualReview`| `claim_tax_withholding`| `requires_manual_review`| BOOLEAN | |
| `taxWithholdings[].triggeredAt`| `claim_tax_withholding`| `triggered_at` | TIMESTAMP | |
| `taxWithholdings[].taxpayer_status`| `claim_tax_withholding`| `taxpayer_status`| VARCHAR | |
| `taxWithholdings[].tax_form_type`| `claim_tax_withholding`| `tax_form_type` | VARCHAR | |
| `taxWithholdings[].social_security_number`| `claim_tax_withholding`| `social_security_number`| VARCHAR| |
| `taxWithholdings[].federal_tax_classification`| `claim_tax_withholding`| `federal_tax_classification`| VARCHAR| |
| `taxWithholdings[].federal_withholding_elected`| `claim_tax_withholding`| `federal_withholding_elected`| BOOLEAN| |
| `taxWithholdings[].certification_agreed`| `claim_tax_withholding`| `certification_agreed`| BOOLEAN| |
| `documents[].document_name`| `claim_document` | `document_name` | VARCHAR | |
| `documents[].required` | `claim_document` | `required` | BOOLEAN | |
| `documents[].document_type`| `claim_document` | `document_type` | VARCHAR | |
| `documents[].type` | `claim_document` | `type` | VARCHAR | |
| `quote_package.quote_reference_number`| `claim_quote_package`| `quote_reference_number`| VARCHAR | |
| `quote_package.requested_on` | `claim_quote_package`| `requested_on` | DATE | |
| `quote_package.quote_validity_days`| `claim_quote_package`| `quote_validity_days`| INTEGER | |
| `quote_package.administrative_fee`| `claim_quote_package`| `administrative_fee`| DECIMAL | |
| `quote_package.package_downloaded`| `claim_quote_package`| `package_downloaded`| BOOLEAN | |
| `flags.caseLevel[].flagId` | `claim_case_flag` | `flag_id` | UUID | PK |
| `flags.caseLevel[].flagType`| `claim_case_flag` | `flag_type` | VARCHAR | |
| `flags.caseLevel[].triggeredAt`| `claim_case_flag` | `triggered_at` | TIMESTAMP | |
| `flags.policyLevel[].flagId`| `claim_policy_flag` | `flag_id` | UUID | PK |
| `flags.policyLevel[].policyNumber`| `claim_policy_flag` | `policy_number` | VARCHAR | |
| `flags.policyLevel[].flagType`| `claim_policy_flag` | `flag_type` | VARCHAR | |
| `flags.policyLevel[].triggeredAt`| `claim_policy_flag` | `triggered_at` | TIMESTAMP | |
| `flags.beneficiaryLevel[].flagId`| `claim_beneficiary_flag`| `flag_id` | UUID | PK |
| `flags.beneficiaryLevel[].beneficiaryId`| `claim_beneficiary_flag`| `beneficiary_id` | UUID | FK -> `claim_beneficiary` |
| `flags.beneficiaryLevel[].flagType`| `claim_beneficiary_flag`| `flag_type` | VARCHAR | |
| `flags.beneficiaryLevel[].triggeredAt`| `claim_beneficiary_flag`| `triggered_at` | TIMESTAMP | |

---

## 🔌 Case Service REST API Specification

The Case Service manages these structured JSON payloads via transactional operations. The Integration Layer acts as the proxy orchestrator between the user frontend, jBPM nodes, and the Case Service APIs.

### 1. Create Case Object
* **Method & Path**: `POST /caseservice/case`
* **Description**: Initializes a new claim case in `DRAFT` status and returns the generated internal case ID.
* **Request Payload**:
```json
{
  "policyNumber": "POL-11111",
  "claimType": "DEATH",
  "claimant": {
    "firstName": "Robert",
    "lastName": "Williams",
    "relationship": "SPOUSE",
    "ssnToken": "TOKEN-SSN-991A",
    "bankDetailsToken": "TOKEN-BANK-XYZ88",
    "role": "Policy Owner",
    "poa_documentation_required": false,
    "poa_document_file_name": null,
    "first_name": "Robert",
    "middle_name": "A",
    "last_name": "Williams",
    "suffix": "",
    "date_of_birth": "1975-06-15",
    "state": "California",
    "country": "USA",
    "social_security_number": "XXX-XX-6789",
    "phone": "555-019-2834",
    "email": "robert.w@example.com",
    "address_line1": "123 Main St",
    "city": "Anytown",
    "state_of_residence": "CA",
    "zip_code": "90210"
  },
  "policyDetails": [
    {
      "policyNumber": "POL-11111",
      "planCode": "TERM-80",
      "pasLockStatus": "PENDING",
      "faceAmount": 500000.00
    }
  ],
  "beneficiaries": [
    {
      "beneficiaryId": "c4d7e21a-e9b4-4b5c-a5b6-7efef29ba098",
      "policyNumber": "POL-11111",
      "splitPercentage": 100.00,
      "paymentMethod": "ACH",
      "role": "Policy Owner",
      "poa_documentation_required": false,
      "poa_document_file_name": null,
      "first_name": "Robert",
      "middle_name": "A",
      "last_name": "Williams",
      "suffix": ""
    }
  ],
  "documents": []
}
```
* **Response Payload** (`201 Created`):
```json
{
  "caseId": "5f3a0937-bdcd-4d8e-be89-7cfc1f3c3a03",
  "policyNumber": "POL-11111",
  "claimType": "DEATH",
  "caseStatus": "DRAFT",
  "createdAt": "2026-05-26T16:53:00.000Z",
  "updatedAt": "2026-05-26T16:53:00.000Z"
}
```

### 2. Retrieve Case Object
* **Method & Path**: `GET /caseservice/case/{caseId}`
* **Description**: Retrieves the complete nested Case Object including policies, beneficiaries, withholdings, documents, and evaluation flags.
* **Response Payload** (`200 OK`):
```json
{
  "caseId": "5f3a0937-bdcd-4d8e-be89-7cfc1f3c3a03",
  "policyNumber": "POL-11111",
  "claimType": "DEATH",
  "dateOfDeath": "2025-04-01",
  "causeOfDeath": "NATURAL",
  "placeOfDeath": "New York City Hospital",
  "caseStatus": "PENDING_DEATH",
  "examinerResolution": null,
  "examinerComment": null,
  "interestMethodConfirmed": false,
  "totalPayoutAmount": 0.00,
  "jbpmProcessInstanceId": 99812,
  "createdAt": "2026-05-26T16:53:00.000Z",
  "updatedAt": "2026-05-26T16:54:12.000Z",
  "claimant": {
    "claimantId": "91a27e3d-6b3a-4418-8f3e-436f561f2212",
    "relationship": "SPOUSE",
    "ssnToken": "TOKEN-SSN-991A",
    "bankDetailsToken": "TOKEN-BANK-XYZ88",
    "role": "Policy Owner",
    "poa_documentation_required": false,
    "poa_document_file_name": null,
    "first_name": "Robert",
    "middle_name": "A",
    "last_name": "Williams",
    "suffix": "",
    "date_of_birth": "1975-06-15",
    "state": "California",
    "country": "USA",
    "social_security_number": "XXX-XX-6789",
    "phone": "555-019-2834",
    "email": "robert.w@example.com",
    "address_line1": "123 Main St",
    "city": "Anytown",
    "state_of_residence": "CA",
    "zip_code": "90210"
  },
  "policyDetails": [
    {
      "policyNumber": "POL-11111",
      "planCode": "TERM-80",
      "pasLockStatus": "LOCKED",
      "faceAmount": 500000.00,
      "adjustedFaceAmount": 500000.00,
      "interestAmount": 0.00,
      "misstatementAdjustment": 0.00,
      "netBenefitAmount": 0.00,
      "refreshedAt": "2026-05-26T16:54:10.000Z"
    }
  ],
  "beneficiaries": [
    {
      "beneficiaryId": "c4d7e21a-e9b4-4b5c-a5b6-7efef29ba098",
      "policyNumber": "POL-11111",
      "isAdult": true,
      "splitPercentage": 100.00,
      "benefitAmount": 0.00,
      "paymentMethod": "ACH",
      "paymentStatus": "PENDING",
      "paymentRefNo": null,
      "role": "Policy Owner",
      "poa_documentation_required": false,
      "poa_document_file_name": null,
      "first_name": "Robert",
      "middle_name": "A",
      "last_name": "Williams",
      "suffix": ""
    }
  ],
  "taxWithholdings": [],
  "documents": [],
  "quote_package": null,
  "flags": {
    "caseLevel": [],
    "policyLevel": [],
    "beneficiaryLevel": []
  }
}
```

### 3. Update Case Object
* **Method & Path**: `PUT /caseservice/case/{caseId}`
* **Description**: Performs a partial update (patching) or replacement of specified attributes on the Case Object.
* **Request Payload**:
```json
{
  "caseStatus": "UNDER_REVIEW",
  "examinerResolution": "APPROVED",
  "examinerComment": "Manual review passed; suicide exclusion window was checked."
}
```
* **Response Payload** (`200 OK`):
```json
{
  "caseId": "5f3a0937-bdcd-4d8e-be89-7cfc1f3c3a03",
  "caseStatus": "UNDER_REVIEW",
  "updatedAt": "2026-05-26T16:56:00.000Z"
}
```

### 4. Delete Case Object
* **Method & Path**: `DELETE /caseservice/case/{caseId}`
* **Description**: Archive or soft-delete the claim case.
* **Response Payload** (`204 No Content`)

### 5. List Case Objects
* **Method & Path**: `GET /caseservice/list`
* **Query Parameters**: `caseStatus`, `claimType`, `policyNumber`
* **Response Payload** (`200 OK`): Returns an array of Case Objects matching the search filters.

---

## 🔄 jBPM Lifecycle Transitions

The Case Object is updated incrementally as the claim moves through the jBPM orchestration engine. The timeline below illustrates when and how specific fields are updated:

### Stage 1: The Frontend Journey (Draft & Submission)
1. **Search & Quote**: User initiates claim. Node.js backend calls `POST /caseservice/case` creating the case with `caseStatus: "DRAFT"`, initial `quote_package` details, root `documents` (populating the `documents_included` files), and populated `policyDetails`.
2. **IDP Extraction (S3 Upload)**: Death Certificate is uploaded. The extraction process extracts the date of death and updates the Case Object:
   * `PUT /caseservice/case/{caseId}` with:
```json
{
  "dateOfDeath": "2025-04-01",
  "causeOfDeath": "NATURAL",
  "placeOfDeath": "New York City Hospital"
}
```
   * *Note: The document file location is logged separately in `claim_document`.*
3. **Submission**: User reviews the details, inputs payment instructions (including uploading POA documentation), and hits Submit. The backend updates the Case Object status to `SUBMITTED`, encrypts SSN and banking details, appends the POA document (`poa_document_file_name`) to the root-level `documents` array, triggers the jBPM process instance, receives the `piid`, and binds it:
   * `PUT /caseservice/case/{caseId}` with:
```json
{
  "caseStatus": "SUBMITTED",
  "jbpmProcessInstanceId": 99812,
  "documents": [
    {
      "document_name": "guardianship_trustee_letter.pdf",
      "required": true,
      "document_type": "POA",
      "type": "USER_UPLOADED"
    }
  ]
}
```

### Stage 2: Main jBPM Adjudication (Active Process)
1. **Node 4: Set Policy Status Pend Death**: jBPM locks the policy records in the Mainframe. Upon confirmation, the integration layer updates:
   * `caseStatus` &rarr; `"PENDING_DEATH"`
   * `policyDetails[].pasLockStatus` &rarr; `"LOCKED"`
2. **Node 9 & 9a: PAS Validation**: Mainframe validation checks are run:
   * **Adjusted Face Amount**: Face amount is verified and mapped to `policyDetails[].adjustedFaceAmount`.
   * **Evaluations & Warnings**: If validation checks fail (e.g. Minor Detected or Contestability window), warning objects are appended to `flags.policyLevel` or `flags.beneficiaryLevel`.
3. **Node 14: Tax Withholding**: Withholding amounts are calculated:
   * New taxpayer credentials and withholding details are appended to `taxWithholdings` array.
   * If manual tax review is required, the integration layer patches:
     * `caseStatus` &rarr; `"UNDER_REVIEW"`
4. **Node 16: Examiner Review**: If any flags or tax exclusions halt the automation, a jBPM User Task halts the process. When the underwriter decides:
   * Integration layer updates:
     * `examinerResolution` &rarr; `"APPROVED"` or `"REJECTED"`
     * `examinerComment` &rarr; `"Manual override remarks"`
     * `caseStatus` &rarr; `"UNDER_REVIEW"` (then continues)

### Stage 3: NIGO Sub-Process (Exception Routing)
1. **Node 1: Send NIGO**: If documents are missing, jBPM calls the NIGO subprocess.
   * Integration layer updates:
     * `caseStatus` &rarr; `"PENDING_NIGO"`
   * *Note: The notice detail is logged separately in `claim_nigo_log`.*
2. **Resume**: Once missing documents are uploaded, the case status reverts to the active flow state upon document verification exit.

### Stage 4: Finalization & Math (Payment State)
1. **Node 17 & 18: Calculate Benefit**: jBPM calculates interest and misstatement adjustments.
   * Integration layer updates:
     * `policyDetails[].interestAmount` &rarr; calculated value
     * `policyDetails[].misstatementAdjustment` &rarr; calculated value
     * `policyDetails[].netBenefitAmount` &rarr; `adjustedFaceAmount` + `interestAmount` + `misstatementAdjustment`
     * `totalPayoutAmount` &rarr; Sum of net benefits across all policies.
2. **Node 19: Beneficiary Split**: jBPM calculates payees' final split value:
   * Integration layer updates:
     * `beneficiaries[].benefitAmount` &rarr; `(totalPayoutAmount * splitPercentage) - taxWithholding`
3. **Node 22 & 23: Payout Execution (Finalize/KNECT)**: Payments are dispatched to payment gateway.
   * Integration layer updates:
     * `caseStatus` &rarr; `"PAYMENT_INITIATED"`
     * `beneficiaries[].paymentStatus` &rarr; `"IN_FLIGHT"` or `"SUCCESS"`
     * `beneficiaries[].paymentRefNo` &rarr; Transaction number returned by KNECT or treasury bank
4. **Process Completion**: The workflow terminates.
   * Integration layer updates:
     * `caseStatus` &rarr; `"COMPLETED"`

---

## 🎨 Claim Scenarios Representation in Case Object

The unified Case Object schema natively supports all the complex test scenarios defined in the testing blueprint:

### Scenario 1: Happy Path Death Claim (Fully Automated)
* **Start**: Case Object created with `claimType: "DEATH"`.
* **Execution**: All `pasLockStatus` values update to `LOCKED`. No flags are appended to the `flags` arrays.
* **Payment**: Finalizes payments automatically. `paymentStatus` shifts from `PENDING` to `SUCCESS` for all beneficiaries. `caseStatus` terminates as `COMPLETED`.

### Scenario 2: Happy Path Terminal Illness (TI) Claim
* **Start**: Case Object created with `claimType: "TI"`.
* **Attributes**: `dateOfDeath` is `null`. `causeOfDeath` and `placeOfDeath` are `null`.
* **Structure**: The `beneficiaries` array has exactly one entry representing the living insured as the payee (100% split).
* **Execution**: jBPM bypasses standard fast-track rules and routes to manual underwriting. `examinerResolution` is set to `APPROVED` by the examiner before payment dispatch via KNECT.

### Scenario 3: Death Claim with Missing Documents (NIGO Loop)
* **Evaluation**: Initial `check-documents` call returns `allDocsVerified: false`.
* **Lifecycle**: `caseStatus` changes to `"PENDING_NIGO"`. 
* **State**: jBPM enters a wait state. The separate table `claim_nigo_log` tracks the dispatch counter. Once resolved, `caseStatus` reverts to `"PENDING_DEATH"` and continues.

### Scenario 4: Bank Validation Failure
* **Validation**: Bank account PVS owner check fails.
* **Flag Appended**: A flag of type `INCORRECT_PAYMENT_INFO` is appended to the `flags.beneficiaryLevel` array:
```json
{
  "flagId": "f9a21d1b-3c3e-4b12-b13c-79beea7c92f1",
  "beneficiaryId": "c4d7e21a-e9b4-4b5c-a5b6-7efef29ba098",
  "flagType": "INCORRECT_PAYMENT_INFO",
  "triggeredAt": "2026-05-26T16:54:10.000Z"
}
```
* **Escalation**: jBPM blocks automated execution and assigns the examiner task. The underwriter overrides the flag, setting `examinerResolution` to `APPROVED` with override remarks in `examinerComment`.

### Scenario 5: Contestability Check Failure
* **Validation**: Claim is submitted within the 2-year contestability window.
* **Flag Appended**: A flag of type `SUICIDE` or contestable indicator is added to `flags.caseLevel` and `flags.policyLevel`.
* **Escalation**: jBPM routes to the MRX check service node. If the MRX returns suicide issues, the examiner manual review task is triggered, and `caseStatus` updates to `"UNDER_REVIEW"`.

---

## 📋 Complete Multi-Policy & Multi-Beneficiary Sample Payload

Below is a complete, production-grade JSON sample representing a claim case with **multiple policies** where **each policy has multiple beneficiaries** (along with corresponding per-beneficiary tax withholdings, policy-level flags, beneficiary-level flags, and a consolidated root-level `documents` array):

```json
{
  "caseId": "5f3a0937-bdcd-4d8e-be89-7cfc1f3c3a03",
  "policyNumber": "POL-11111",
  "claimType": "DEATH",
  "dateOfDeath": "2025-04-01",
  "causeOfDeath": "NATURAL",
  "placeOfDeath": "New York City Hospital",
  "caseStatus": "PAYMENT_INITIATED",
  "examinerResolution": "APPROVED",
  "examinerComment": "Manual review completed. Minor beneficiary guardianship verified. Beneficiary sanctions checked.",
  "interestMethodConfirmed": true,
  "totalPayoutAmount": 750000.00,
  "jbpmProcessInstanceId": 99812,
  "createdAt": "2026-05-26T16:53:00.000Z",
  "updatedAt": "2026-05-26T17:00:00.000Z",
  
  "claimant": {
    "claimantId": "91a27e3d-6b3a-4418-8f3e-436f561f2212",
    "relationship": "SPOUSE",
    "ssnToken": "TOKEN-SSN-991A",
    "bankDetailsToken": "TOKEN-BANK-XYZ88",
    "roleType": "BENEFICIARY",
    "poa_documentation_required": false,
    "poa_document_file_name": null,
    "first_name": "Robert",
    "middle_name": "A",
    "last_name": "Williams",
    "suffix": "",
    "date_of_birth": "1975-06-15",
    "state": "California",
    "country": "USA",
    "social_security_number": "XXX-XX-6789",
    "phone": "555-019-2834",
    "email": "robert.w@example.com",
    "address_line1": "123 Main St",
    "city": "Anytown",
    "state_of_residence": "CA",
    "zip_code": "90210",
    "beneMatchStatus": false
  },
  
  "policyDetails": [
    {
      "policyNumber": "POL-11111",
      "planCode": "TERM-80",
      "pasLockStatus": "LOCKED",
      "faceAmount": 500000.00,
      "adjustedFaceAmount": 500000.00,
      "interestAmount": 12500.00,
      "misstatementAdjustment": 0.00,
      "netBenefitAmount": 512500.00,
      "refreshedAt": "2026-05-26T16:54:10.000Z"
    },
    {
      "policyNumber": "POL-22222",
      "planCode": "VUL-1",
      "pasLockStatus": "LOCKED",
      "faceAmount": 250000.00,
      "adjustedFaceAmount": 250000.00,
      "interestAmount": 6250.00,
      "misstatementAdjustment": -18750.00,
      "netBenefitAmount": 237500.00,
      "refreshedAt": "2026-05-26T16:54:10.000Z"
    }
  ],
  
  "beneficiaries": [
    {
      "beneficiaryId": "c4d7e21a-e9b4-4b5c-a5b6-7efef29ba098",
      "policyNumber": "POL-11111",
      "isAdult": true,
      "splitPercentage": 50.00,
      "benefitAmount": 256250.00,
      "paymentMethod": "ACH",
      "paymentStatus": "SUCCESS",
      "paymentRefNo": "TXN-ACH-00102A",
      "role": "Policy Owner",
      "poa_documentation_required": false,
      "poa_document_file_name": null,
      "first_name": "Robert",
      "middle_name": "A",
      "last_name": "Williams",
      "suffix": ""
    },
    {
      "beneficiaryId": "d8e9f2a1-b5c6-4b5e-8e7d-9271feacb101",
      "policyNumber": "POL-11111",
      "isAdult": false,
      "splitPercentage": 50.00,
      "benefitAmount": 256250.00,
      "paymentMethod": "CHECK",
      "paymentStatus": "SUCCESS",
      "paymentRefNo": "TXN-CHK-881920",
      "role": "Primary Beneficiary",
      "poa_documentation_required": true,
      "poa_document_file_name": "guardianship_trustee_letter.pdf",
      "first_name": "Tommy",
      "middle_name": "J",
      "last_name": "Doe",
      "suffix": "Jr"
    },
    {
      "beneficiaryId": "e1f2a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b",
      "policyNumber": "POL-22222",
      "isAdult": true,
      "splitPercentage": 40.00,
      "benefitAmount": 95000.00,
      "paymentMethod": "ACH",
      "paymentStatus": "SUCCESS",
      "paymentRefNo": "TXN-ACH-00102B",
      "role": "Policy Owner",
      "poa_documentation_required": false,
      "poa_document_file_name": null,
      "first_name": "Robert",
      "middle_name": "A",
      "last_name": "Williams",
      "suffix": ""
    },
    {
      "beneficiaryId": "f2a3b4c5-6d7e-8f9a-0b1c-2d3e4f5a6b7c",
      "policyNumber": "POL-22222",
      "isAdult": true,
      "splitPercentage": 60.00,
      "benefitAmount": 142500.00,
      "paymentMethod": "WIRE",
      "paymentStatus": "SUCCESS",
      "paymentRefNo": "TXN-WRE-551239",
      "role": "Contingent Beneficiary",
      "poa_documentation_required": false,
      "poa_document_file_name": null,
      "first_name": "Sarah",
      "middle_name": "K",
      "last_name": "Smith",
      "suffix": ""
    }
  ],
  
  "taxWithholdings": [
    {
      "taxId": "t1a2b3c4-5d6e-7f8a-9b0c-1d2e3f4a5b6c",
      "beneficiaryId": "c4d7e21a-e9b4-4b5c-a5b6-7efef29ba098",
      "policyNumber": "POL-11111",
      "taxWithholdingAmount": 25625.00,
      "requiresManualReview": false,
      "triggeredAt": "2026-05-26T16:55:00.000Z",
      "taxpayer_status": "U.S. Citizen or U.S. Resident",
      "tax_form_type": "W-9",
      "social_security_number": "***-**-6789",
      "federal_tax_classification": "Individual / Sole Proprietor",
      "federal_withholding_elected": false,
      "certification_agreed": true
    },
    {
      "taxId": "t2b3c4d5-6e7f-8a9b-0c1d-2e3f4a5b6c7d",
      "beneficiaryId": "d8e9f2a1-b5c6-4b5e-8e7d-9271feacb101",
      "policyNumber": "POL-11111",
      "taxWithholdingAmount": 0.00,
      "requiresManualReview": false,
      "triggeredAt": "2026-05-26T16:55:00.000Z",
      "taxpayer_status": "U.S. Citizen or U.S. Resident",
      "tax_form_type": "W-9",
      "social_security_number": "***-**-4321",
      "federal_tax_classification": "Individual / Sole Proprietor",
      "federal_withholding_elected": false,
      "certification_agreed": true
    },
    {
      "taxId": "t3c4d5e6-7f8a-9b0c-1d2e-3f4a5b6c7d8e",
      "beneficiaryId": "e1f2a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b",
      "policyNumber": "POL-22222",
      "taxWithholdingAmount": 9500.00,
      "requiresManualReview": false,
      "triggeredAt": "2026-05-26T16:55:00.000Z",
      "taxpayer_status": "U.S. Citizen or U.S. Resident",
      "tax_form_type": "W-9",
      "social_security_number": "***-**-6789",
      "federal_tax_classification": "Individual / Sole Proprietor",
      "federal_withholding_elected": false,
      "certification_agreed": true
    },
    {
      "taxId": "t4d5e6f7-8a9b-0c1d-2e3f-4a5b6c7d8e9f",
      "beneficiaryId": "f2a3b4c5-6d7e-8f9a-0b1c-2d3e4f5a6b7c",
      "policyNumber": "POL-22222",
      "taxWithholdingAmount": 0.00,
      "requiresManualReview": false,
      "triggeredAt": "2026-05-26T16:55:00.000Z",
      "taxpayer_status": "U.S. Citizen or U.S. Resident",
      "tax_form_type": "W-9",
      "social_security_number": "***-**-9876",
      "federal_tax_classification": "Individual / Sole Proprietor",
      "federal_withholding_elected": false,
      "certification_agreed": true
    }
  ],
  
  "documents": [
    {
      "document_name": "guardianship_trustee_letter.pdf",
      "required": true,
      "document_type": "POA",
      "type": "USER_UPLOADED"
    },
    {
      "document_name": "accelerated_benefit_disclosure.pdf",
      "required": true,
      "document_type": "DISCLOSURE",
      "type": "SYSTEM_GENERATED"
    },
    {
      "document_name": "quote_summary_sheet.pdf",
      "required": true,
      "document_type": "SUMMARY",
      "type": "SYSTEM_GENERATED"
    }
  ],
  
  "quote_package": {
    "quote_reference_number": "TIQ-20260421-00042",
    "requested_on": "04/21/2026",
    "quote_validity_days": 60,
    "administrative_fee": 100,
    "package_downloaded": true,
    "documents_included": [
      {
        "document_name": "accelerated_benefit_disclosure.pdf",
        "required": true,
        "document_type": "DISCLOSURE",
        "type": "SYSTEM_GENERATED"
      },
      {
        "document_name": "quote_summary_sheet.pdf",
        "required": true,
        "document_type": "SUMMARY",
        "type": "SYSTEM_GENERATED"
      }
    ]
  },
  
  "flags": {
    "caseLevel": [],
    "policyLevel": [
      {
        "flagId": "p1a2b3c4-5d6e-7f8a-9b0c-1d2e3f4a5b6c",
        "policyNumber": "POL-22222",
        "flagType": "LAPSE_ALERT",
        "triggeredAt": "2026-05-26T16:54:10.000Z"
      }
    ],
    "beneficiaryLevel": [
      {
        "flagId": "b1a2b3c4-5d6e-7f8a-9b0c-1d2e3f4a5b6c",
        "beneficiaryId": "d8e9f2a1-b5c6-4b5e-8e7d-9271feacb101",
        "flagType": "MINOR_DETECTED",
        "triggeredAt": "2026-05-26T16:54:10.000Z"
      }
    ]
  }
}
```
