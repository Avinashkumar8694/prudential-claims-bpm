const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');
const https = require('https');

// Helper to proxy requests to the actual Business Central server
function proxyToBusinessCentral(req, res, targetPath, method) {
  const targetHost = 'prudential-dev-alpha.neutrinos-apps.com';
  
  const headers = {
    'Content-Type': req.headers['content-type'] || 'application/json',
    'Accept': req.headers['accept'] || 'application/json',
  };
  
  // Always use krisv:krisv credentials for Business Central APIs
  headers['Authorization'] = 'Basic a3Jpc3Y6a3Jpc3Y=';

  if (req.headers['cookie']) {
    headers['Cookie'] = req.headers['cookie'];
  }

  const options = {
    hostname: targetHost,
    port: 443,
    path: targetPath,
    method: method,
    headers: headers
  };

  console.log(`\x1b[36m[BC Proxy]\x1b[0m Forwarding ${method} to https://${targetHost}${targetPath} using krisv credentials`);

  const proxyReq = https.request(options, (proxyRes) => {
    let data = '';
    
    proxyRes.on('data', (chunk) => {
      data += chunk;
    });

    proxyRes.on('end', () => {
      res.status(proxyRes.statusCode);
      
      // Forward standard headers if present
      if (proxyRes.headers['content-type']) {
        res.setHeader('Content-Type', proxyRes.headers['content-type']);
      }
      
      console.log(`\x1b[36m[BC Proxy]\x1b[0m Response from BC received with status: ${proxyRes.statusCode}`);
      res.send(data);
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`\x1b[31m[BC Proxy Error]\x1b[0m ${err.message}`);
    res.status(500).json({
      status: "SERVER_ERROR",
      result: `Proxy failed to connect to Business Central: ${err.message}`
    });
  });

  if (method !== 'GET' && req.body && Object.keys(req.body).length > 0) {
    proxyReq.write(JSON.stringify(req.body));
  }
  proxyReq.end();
}

let cachedToken = null;
let tokenExpiry = 0;

// Helper to retrieve Oauth Bearer Token from Identity Server
function getBpmBearerToken(callback) {
  if (cachedToken && Date.now() < tokenExpiry) {
    return callback(null, cachedToken);
  }

  console.log('[BPM Proxy] Fetching new Bearer token from Identity Server...');
  const url = require('url');
  const tokenUrl = 'https://prudential-dev-ids.neutrinos-apps.com/token';
  const parsedUrl = url.parse(tokenUrl);
  
  const postData = new URLSearchParams({
    client_id: '6ddh_euTKkSA682Yy5HuA',
    client_secret: 'e28WZR6ZKyrYILTSKKClFEwNlYoGR2cvISwFCoIXP4S7DJgsaqhHRSNqpoWgYbcx_DUlrSkoA1zS5uFOzP-J9C',
    grant_type: 'client_credentials'
  }).toString();

  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    },
    rejectUnauthorized: false
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.access_token) {
          cachedToken = json.access_token;
          // Set expiry to 50 minutes (3000 seconds) to be safe (typical expiry is 1 hour)
          tokenExpiry = Date.now() + 3000 * 1000;
          console.log('[BPM Proxy] Bearer token retrieved and cached.');
          callback(null, cachedToken);
        } else {
          callback(new Error(`Identity Server response: ${data}`));
        }
      } catch (e) {
        callback(e);
      }
    });
  });

  req.on('error', (err) => {
    callback(err);
  });

  req.write(postData);
  req.end();
}

// Helper to proxy requests to the bpmservice REST API wrapper
function proxyToBpmService(req, res, pathType, extraParams = {}) {
  getBpmBearerToken((tokenErr, token) => {
    if (tokenErr) {
      console.error(`\x1b[31m[BPM Proxy Token Error]\x1b[0m Failed to get Bearer token: ${tokenErr.message}`);
      res.status(500).json({
        status: "SERVER_ERROR",
        result: `Failed to authenticate with Identity Server: ${tokenErr.message}`
      });
      return;
    }

    const targetHost = 'prudential-dev-alpha.neutrinos-apps.com';
    
    // 1. Decode Authorization header to get user/password
    let username = 'krisv';
    let password = 'krisv';
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Basic ')) {
      try {
        const creds = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
        username = creds[0];
        password = creds[1];
      } catch (e) {
        console.error('[BPM Proxy] Failed to decode Basic Auth header', e);
      }
    }

    // 2. Determine target path, method, and request body mapping
    let targetPath = '';
    let method = 'POST';
    let requestBody = null;

    if (pathType === 'startProcess') {
      targetPath = '/bpmservice/process/instance/start';
      requestBody = {
        processDefinitionId: extraParams.processId,
        variables: req.body || {},
        metadata: {
          containerId: extraParams.containerId
        }
      };
    } else if (pathType === 'signalProcess') {
      targetPath = '/bpmservice/process/instance/signal/send';
      requestBody = {
        processInstanceId: Number(extraParams.processInstanceId),
        signalName: extraParams.signalName,
        variables: req.body || {},
        metadata: {
          containerId: extraParams.containerId
        }
      };
    } else if (pathType === 'queryTasks') {
      targetPath = '/bpmservice/task/instance/fetch-all';
      const statusQuery = req.query.status || 'Ready,Reserved,InProgress';
      const statusList = statusQuery.split(',').map(s => s.trim().toUpperCase());
      requestBody = {
        options: {
          userNames: [username],
          status: statusList,
          page: Number(req.query.page || 0),
          pageSize: Number(req.query.pageSize || 10)
        }
      };
    } else if (pathType === 'claimTask') {
      targetPath = '/bpmservice/task/instance/check-out';
      requestBody = {
        taskId: Number(extraParams.taskId),
        metadata: {
          containerId: extraParams.containerId
        }
      };
    } else if (pathType === 'startTask') {
      targetPath = '/bpmservice/task/instance/check-in';
      requestBody = {
        taskId: Number(extraParams.taskId),
        metadata: {
          containerId: extraParams.containerId
        }
      };
    } else if (pathType === 'completeTask') {
      targetPath = '/bpmservice/task/instance/complete';
      requestBody = {
        taskId: Number(extraParams.taskId),
        variables: req.body || {},
        metadata: {
          containerId: extraParams.containerId
        }
      };
    }

    // 3. Build headers for bpmservice NestJS service
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'user': username,
      'password': password,
      'Authorization': 'Bearer ' + token
    };

    if (req.headers['cookie']) {
      headers['Cookie'] = req.headers['cookie'];
    }

    const options = {
      hostname: targetHost,
      port: 443,
      path: targetPath,
      method: method,
      headers: headers
    };

    console.log(`\x1b[36m[BPM Proxy]\x1b[0m Forwarding ${req.method} ${req.url} to https://${targetHost}${targetPath} with user: ${username}`);

    const proxyReq = https.request(options, (proxyRes) => {
      let data = '';
      
      proxyRes.on('data', (chunk) => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log(`\x1b[36m[BPM Proxy]\x1b[0m Response from BPM received with status: ${proxyRes.statusCode}`);
        
        if (proxyRes.statusCode >= 400) {
          res.status(proxyRes.statusCode);
          res.send(data);
          return;
        }

        try {
          const jsonResponse = JSON.parse(data);
          
          if (pathType === 'startProcess') {
            if (jsonResponse.processInstanceId) {
              res.status(201).json(Number(jsonResponse.processInstanceId));
            } else {
              res.status(201).send(data);
            }
          } else if (pathType === 'queryTasks') {
            const tasks = Array.isArray(jsonResponse) ? jsonResponse.map(t => ({
              "task-id": t.taskId,
              "task-name": t.taskName,
              "task-subject": "",
              "task-description": "",
              "task-status": t.taskStatus,
              "task-priority": 0,
              "task-is-skipable": false,
              "task-actual-owner": username,
              "task-created-by": "",
              "task-created-on": t.createdOn || Date.now(),
              "task-activation-time": t.createdOn || Date.now(),
              "task-expiration-time": null,
              "task-process-instance-id": t.currentProcessInstanceId,
              "task-process-id": t.taskProcessDefinitionId,
              "task-container-id": t.metadata?.containerId || extraParams.containerId || "prudential-claims-bpm",
              "task-parent-id": t.parentProcessInstanceId || -1
            })) : [];
            
            res.setHeader('Content-Type', 'application/json');
            res.status(200).json({ "task-summary": tasks });
          } else {
            res.status(proxyRes.statusCode).json(jsonResponse);
          }
        } catch (e) {
          res.status(proxyRes.statusCode);
          res.send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error(`\x1b[31m[BPM Proxy Error]\x1b[0m ${err.message}`);
      res.status(500).json({
        status: "SERVER_ERROR",
        result: `Proxy failed to connect to BPM service: ${err.message}`
      });
    });

    if (requestBody) {
      proxyReq.write(JSON.stringify(requestBody));
    }
    proxyReq.end();
  });
}

const app = express();
const PORT = process.env.PORT || 3010;

app.use(cors());
app.use(express.json());

// Serve interactive Swagger UI documentation at /api-docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Request logger middleware to inspect BPM engine execution
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n\x1b[36m[${timestamp}] ${req.method} ${req.url}\x1b[0m`);
  console.log('\x1b[33mRequest Payload:\x1b[0m', JSON.stringify(req.body, null, 2));
  next();
});

// In-memory route override configurations
const routeOverrides = {};

// Middleware to apply dynamic overrides (failures, auto-retry, status overrides)
app.use((req, res, next) => {
  const path = req.path;
  if (routeOverrides[path]) {
    const override = routeOverrides[path];
    
    // Check if we should fail only a limited number of times (for auto-retry testing)
    if (override.failCount !== undefined) {
      if (override.failCount > 0) {
        override.failCount--;
        console.log(`\x1b[33m[Route Override]\x1b[0m Simulating failure for ${path}. Remaining failures before success: ${override.failCount}`);
        return res.status(override.status || 500).json(override.response || { success: false, error: "Simulated route failure" });
      } else {
        // failCount is 0, clear override and fall through to default mock behavior (success)
        delete routeOverrides[path];
        console.log(`\x1b[32m[Route Override Expired]\x1b[0m failCount reached 0, clearing override for ${path}`);
      }
    } else if (override.success === false) {
      // Check if we should persistently fail
      console.log(`\x1b[33m[Route Override]\x1b[0m Simulating persistent failure for ${path}`);
      return res.status(override.status || 500).json(override.response || { success: false, error: "Simulated route failure" });
    }
  }
  next();
});

// Configure a route override
app.post('/api/mock/override', (req, res) => {
  const { path, status, response, failCount, success } = req.body;
  if (!path) {
    return res.status(400).json({ error: "Missing required parameter: path" });
  }
  routeOverrides[path] = {
    status: status !== undefined ? Number(status) : 500,
    response: response || null,
    failCount: failCount !== undefined ? Number(failCount) : undefined,
    success: success !== undefined ? !!success : false
  };
  console.log(`\x1b[32m[Route Override Configured]\x1b[0m ${path} -> success: ${success}, failCount: ${failCount}`);
  res.json({ success: true, overrides: routeOverrides });
});

// List all configured overrides
app.get('/api/mock/overrides', (req, res) => {
  res.json(routeOverrides);
});

// Clear route overrides
app.delete('/api/mock/override', (req, res) => {
  const { path } = req.body;
  if (path) {
    delete routeOverrides[path];
    console.log(`\x1b[33m[Route Override Cleared]\x1b[0m ${path}`);
  } else {
    // Clear all
    for (const key in routeOverrides) {
      delete routeOverrides[key];
    }
    console.log(`\x1b[33m[Route Overrides Cleared]\x1b[0m All overrides reset.`);
  }
  res.json({ success: true, overrides: routeOverrides });
});

// --- PROCESS 1: MAIN CLAIMS INTERNAL PROCESSING ENDPOINTS ---

// 1. Validate Data
app.post('/api/v1/claims/validate-data', (req, res) => {
  const { piid, caseId } = req.body;
  const isFail = caseId && caseId.includes('VALFAIL');
  const isContest = caseId && caseId.includes('CONTEST');
  const isSuicide = caseId && caseId.includes('SUICIDE');
  const isForeign = caseId && caseId.includes('FOREIGN');
  const isAids = caseId && caseId.includes('AIDS');
  res.json({
    success: true,
    validationPassed: !isFail,
    policyFlags: {
      isSuicide: !!isSuicide,
      isContestable: !!isContest,
      isForeignDeath: !!isForeign,
      isAIDS: !!isAids
    },
    validationErrors: isFail ? [
      { field: "claimType", error: "Claim type selection is missing or invalid" },
      { field: "primaryPolicyNumber", error: "Target policy status is inactive" }
    ] : []
  });
});

// 2. Log Failure / Audit
app.post('/api/v1/audit/log-failure', (req, res) => {
  const { caseId, errors } = req.body;
  res.json({
    success: true,
    auditLogId: `AUD-${Math.floor(100000 + Math.random() * 900000)}`
  });
});

// 3. Update Policy Status
app.put('/api/v1/policy/status', (req, res) => {
  const { caseId, applicablePolicies, status } = req.body;
  const updatedPolicies = (applicablePolicies || ['POL12345']).map(policy => ({
    policyNumber: policy,
    status: status || 'PENDING_DEATH_CLAIM',
    updatedAt: new Date().toISOString()
  }));
  res.json({
    success: true,
    updatedPolicies
  });
});

// 4. Check Documents
app.post('/api/v1/claims/check-documents', (req, res) => {
  const { caseId } = req.body;
  const isNigo = caseId && caseId.includes('NIGO');
  res.json({
    success: true,
    allDocsVerified: !isNigo,
    missingDocs: isNigo ? ['CERTIFIED_DEATH_CERTIFICATE'] : []
  });
});

// 5. Policy Validation (Mainframe)
app.post('/api/v1/claims/validate-policy', (req, res) => {
  const { caseId } = req.body;
  const isLapse = caseId && (caseId.includes('LAPSE') || caseId.includes('POLICYFAIL'));
  res.json({
    success: true,
    validationPassed: !isLapse,
    policyFlags: {
      isActive: !isLapse,
      premiumsPaid: !isLapse,
      hasLapseAlert: isLapse
    }
  });
});

// 6. Beneficiary Validation
app.post('/api/v1/claims/validate-beneficiary', (req, res) => {
  const { caseId } = req.body;
  const isMinor = caseId && caseId.includes('MINOR');
  const isSanction = caseId && caseId.includes('SANCTION');
  res.json({
    success: true,
    minorDetected: isMinor,
    beneficiaryFlags: {
      identitiesVerified: !isSanction,
      sanctionsChecked: !isSanction
    }
  });
});

// 7. Bank Account Validation (PVS)
app.post('/api/v1/claims/validate-bank', (req, res) => {
  const { caseId } = req.body;
  const isFail = caseId && caseId.includes('BANKFAIL');
  res.json({
    success: true,
    pvsMatch: !isFail,
    bankValidationResult: isFail ? {
      accountActive: true,
      ownerMatch: false,
      routingValid: true,
      error: 'OWNER_MISMATCH'
    } : {
      accountActive: true,
      ownerMatch: true,
      routingValid: true
    }
  });
});

// 8. Contestability check (MRX)
app.post('/api/v1/claims/mrx-check', (req, res) => {
  const { caseId } = req.body;
  const isContest = caseId && caseId.includes('CONTEST');
  res.json({
    success: true,
    alerts: isContest ? ['SUICIDE_CONTESTABLE_WINDOW'] : [],
    mrxCheckResult: isContest ? {
      medicalRecordsMatch: true,
      preExistingExclusionsChecked: true,
      isSuicide: true,
      isContestable: true
    } : {
      medicalRecordsMatch: true,
      preExistingExclusionsChecked: true
    }
  });
});

// 9. Multi Fund Tax Check
app.post('/api/v1/claims/tax/multi-fund', (req, res) => {
  res.json({
    success: true,
    fundTaxResult: {
      taxWithholdingRate: 0.10,
      stateTaxRate: 0.03,
      fundType: "MULTI"
    }
  });
});

// 10. Single Fund Tax Check
app.post('/api/v1/claims/tax/single-fund', (req, res) => {
  res.json({
    success: true,
    fundTaxResult: {
      taxWithholdingRate: 0.05,
      stateTaxRate: 0.02,
      fundType: "SINGLE"
    }
  });
});

// 10b. Check Fast-Track Rules
app.post('/api/v1/claims/check-fast-track-rule', (req, res) => {
  const { caseId } = req.body;
  const hasFailure = caseId && (
    caseId.includes('FASTTRACKFAIL') ||
    caseId.includes('BANKFAIL') ||
    caseId.includes('CONTEST') ||
    caseId.includes('MINOR') ||
    caseId.includes('SANCTION') ||
    caseId.includes('LAPSE') ||
    caseId.includes('POLICYFAIL')
  );
  res.json({
    success: true,
    fundTaxResult: {
      taxWithholdingRate: 0.1,
      stateTaxRate: 0.03,
      fundType: "MULTI"
    },
    isFastTrackRuleClear: !hasFailure
  });
});

// 11. Apply Tax Rules
app.post('/api/v1/claims/tax/apply', (req, res) => {
  const { caseId } = req.body;
  const isTaxExcept = caseId && caseId.includes('TAXEXCEPT');
  res.json({
    success: true,
    taxExceptions: !!isTaxExcept,
    taxCheckResult: {
      withholdingApplied: true,
      irsReportingGenerated: true
    }
  });
});

// 12. Calculate Benefit
app.post('/api/v1/claims/calculate', (req, res) => {
  const { caseId } = req.body;
  const isMisstate = caseId && caseId.includes('MISSTATE');
  const outstandingLoans = isMisstate ? 30000.00 : 0.00;
  res.json({
    success: true,
    payoutAmount: 250000.00,
    benefitCalculation: {
      baseFaceAmount: 250000.00,
      accruedInterest: 1250.00,
      outstandingLoans: outstandingLoans,
      netPayout: 251250.00 - outstandingLoans
    }
  });
});

// 13. Misstatement Adjustments
app.post('/api/v1/claims/misstatement-adjust', (req, res) => {
  const { caseId, benefitCalculation } = req.body;
  const isMisstate = caseId && caseId.includes('MISSTATE');
  const basePayout = benefitCalculation ? benefitCalculation.netPayout : 251250.00;
  const adjustedPayout = isMisstate ? basePayout - 20000.00 : basePayout;
  res.json({
    success: true,
    adjustedBenefitCalculation: {
      ...(benefitCalculation || {
        baseFaceAmount: 250000.00,
        accruedInterest: 1250.00,
        outstandingLoans: isMisstate ? 30000.00 : 0.00,
        netPayout: basePayout
      }),
      misstatementExclusionApplied: !isMisstate,
      adjustedPayout: adjustedPayout
    }
  });
});

// 14. Beneficiary Split Execution
app.post('/api/v1/claims/beneficiary-split', (req, res) => {
  const { caseId, adjustedBenefitCalculation } = req.body;
  const payout = adjustedBenefitCalculation ? adjustedBenefitCalculation.adjustedPayout : 251250.00;
  res.json({
    success: true,
    beneficiarySplit: {
      primaryBeneficiaryRatio: 1.0,
      splits: [
        { name: "John Doe", amount: payout, role: "Primary" }
      ]
    }
  });
});

// 15. Backup Withholding Checks
app.post('/api/v1/claims/backup-withholding', (req, res) => {
  const { caseId, beneficiarySplit } = req.body;
  const payout = (beneficiarySplit && beneficiarySplit.splits && beneficiarySplit.splits[0]) ? beneficiarySplit.splits[0].amount : 251250.00;
  const isWithhold = caseId && caseId.includes('WITHHOLD');
  const taxDeducted = isWithhold ? payout * 0.24 : 0.00; // 24% IRS Backup Withholding
  res.json({
    success: true,
    withholdingResult: {
      withholdingDeducted: taxDeducted,
      finalPayout: payout - taxDeducted
    },
    finalPayouts: [
      { beneficiary: "John Doe", amount: payout - taxDeducted }
    ]
  });
});

// 16. Finalize Payment
app.post('/api/v1/claims/finalize', (req, res) => {
  const { caseId } = req.body;
  const isPayFail = caseId && caseId.includes('PAYFAIL');
  res.json({
    success: !isPayFail,
    finalPaymentInstructions: {
      paymentGateway: "EFT",
      payoutStatus: isPayFail ? "FAILED" : "SUCCESS",
      bankRefNum: isPayFail ? null : `EFT-${Math.floor(1000000 + Math.random() * 9000000)}`
    }
  });
});

// 17. TI KNECT Payment (Accelerated Benefits Path)
app.post('/api/v1/claims/ti-knect-payment', (req, res) => {
  const { caseId } = req.body;
  const isKnectFail = caseId && caseId.includes('KNECTFAIL');
  res.json({
    success: !isKnectFail,
    knectTransactionId: isKnectFail ? null : `TXN-${Math.floor(10000000 + Math.random() * 90000000)}`,
    error: isKnectFail ? "KNECT_GATEWAY_TIMEOUT" : null
  });
});


// --- PROCESS 2: NIGO FOLLOWUP ENDPOINTS ---

// 18. Send NIGO Notice
app.post('/api/v1/claims/nigo/send', (req, res) => {
  res.json({
    success: true,
    noticeSentAt: new Date().toISOString()
  });
});

// 19. Set Claim Status to Pending Requirements
app.post('/api/v1/claims/status', (req, res) => {
  // Generic case/claim status update. Echoes the requested status (used by the
  // verification flow for FOR_VERIFICATION / ON_HOLD); defaults to PENDING_REQUIREMENTS
  // for the NIGO pending-requirements caller that sends no explicit status.
  const { status } = req.body;
  res.json({
    success: true,
    status: status || "PENDING_REQUIREMENTS"
  });
});

// 21. Dispatch Periodic Reminder
app.post('/api/v1/claims/nigo/auto-followup', (req, res) => {
  const { followupCount } = req.body;
  res.json({
    success: true,
    followupCount: (followupCount || 0) + 1
  });
});

// 22. Rerun IDP Extraction
app.post('/api/v1/claims/nigo/rerun-idp', (req, res) => {
  res.json({
    success: true,
    extractionResult: {
      ocrConfidence: 0.98,
      documentClassClassified: "DEATH_CERTIFICATE",
      extractedData: {
        decedentName: "Jane Doe",
        dateOfDeath: "2026-05-01"
      }
    }
  });
});

// 23. Update Claim Status (Check Outstanding Documents)
app.post('/api/v1/claims/nigo/update-status', (req, res) => {
  const { caseId } = req.body;
  const isPartial = caseId && (caseId.includes('PARTIAL') || caseId.includes('NIGOFAIL'));
  res.json({
    success: true,
    allDocsReceived: !isPartial
  });
});

// 24. Death Verification Status
app.post('/api/v1/claims/nigo/death-verification', (req, res) => {
  const { caseId } = req.body;
  const isVerifyFail = caseId && caseId.includes('VERIFYFAIL');
  res.json({
    success: !isVerifyFail,
    verificationStatus: isVerifyFail ? "FAILED" : "VERIFIED"
  });
});

// --- PROCESS 3: CLAIM VERIFICATION (Track B) ENDPOINTS ---
// Consumed by pru-claim-verification.bpmn. The verifier reviews an inbound
// notification in the workbench and decides Promote / Hold / Close.

// V1. (no dedicated endpoint) The "Update Case Status to For Verification" step reuses
// the shared POST /api/v1/claims/status (used by NIGO too) with status=FOR_VERIFICATION.
// V2. (no dedicated endpoint) No explicit "Assign to Verifier" step — the Claims Verifier
// human task is group-assigned and auto-lands on the worklist (Alpha pull/auto-push).
// Hold: handled internally — the gateway's Hold branch loops straight back to the task.

// V3. Promote: set Notification Status = Verified_Promoted, generate the Case ID.
// NOTE: no claim id here — a case has multiple claims; the claim ids are generated
// per-case downstream by the main process (POST /api/v1/claims/get-claim-ids).
app.post('/api/v1/claims/verification/promote', (req, res) => {
  const { notificationId, claimType } = req.body;
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const seq = Math.floor(10000 + Math.random() * 90000);
  res.json({
    success: true,
    notificationId: notificationId || null,
    notificationStatus: 'VERIFIED_PROMOTED',
    caseId: `CASE-${ymd}-${seq}`,
    claimType: claimType || 'DEATH',
    caseStatus: 'CLAIM_SUBMITTED'
  });
});

// V4. Send email confirmation to Claimant/Bene + claim form to known benes
app.post('/api/v1/claims/verification/send-confirmation', (req, res) => {
  const { caseId, claimId, applicablePolicies } = req.body;
  res.json({
    success: true,
    caseId: caseId || null,
    claimId: claimId || null,
    confirmationSentAt: new Date().toISOString(),
    claimFormsSent: (applicablePolicies || ['POL12345']).length
  });
});

// V5. (no endpoint) Hold is handled internally — the gateway's Hold branch loops
// straight back to the Claims Verifier task; there is no Hold node or endpoint.

// V6. Close: set Notification Status = Not_Verified_Closed
app.post('/api/v1/claims/verification/close', (req, res) => {
  const { notificationId } = req.body;
  res.json({
    success: true,
    notificationId: notificationId || null,
    notificationStatus: 'NOT_VERIFIED_CLOSED',
    closedAt: new Date().toISOString()
  });
});

// V7. Generate and send Closure Notification
app.post('/api/v1/claims/verification/closure-notice', (req, res) => {
  const { notificationId } = req.body;
  res.json({
    success: true,
    notificationId: notificationId || null,
    noticeSentAt: new Date().toISOString()
  });
});


// --- PROCESS 4: PER-CLAIM EVALUATION (fan-out) ENDPOINTS ---
// Consumed by pru-claim-processing (Get Claim IDs) and the pru-claim-run-evaluation
// / pru-claim-per-claim-eval sub-processes (parallel one-claim-at-a-time evaluation).

// E1. Get Claim IDs — returns the array of claim ids for the case (one per claim).
app.post('/api/v1/claims/get-claim-ids', (req, res) => {
  const { caseId, applicablePolicies } = req.body;
  const policies = (applicablePolicies && applicablePolicies.length) ? applicablePolicies : ['POL12345'];
  const yr = new Date().getFullYear();
  // one claim id per applicable policy; caseId containing MULTI forces a 3-claim fan-out
  const list = (caseId && caseId.includes('MULTI'))
    ? ['POLA', 'POLB', 'POLC']
    : policies;
  const claimIds = list.map((p, i) => `CLM-${yr}-${String(1000 + i)}-${String(p).replace(/[^A-Za-z0-9]/g, '')}`);
  console.log(`\x1b[36m[GetClaimIds]\x1b[0m case=${caseId} -> ${claimIds.length} claim(s): ${claimIds.join(', ')}`);
  res.json({ success: true, caseId: caseId || null, claimIds });
});

// E2. Evaluate Claim — per-claim evaluation (one claim at a time). Returns the
// per-claim STP eligibility + flags that the parent aggregates into Case_STP_Eligible.
app.post('/api/v1/claims/evaluate-claim', (req, res) => {
  const { caseId, claimId, claimType } = req.body;
  const key = `${caseId || ''} ${claimId || ''}`;
  const hasFailure = /FASTTRACKFAIL|BANKFAIL|CONTEST|MINOR|SANCTION|LAPSE|POLICYFAIL/.test(key);
  const needsExaminer = /CONTEST|SANCTION|EXAMINER/.test(key);
  const pendingReq = /NIGO|PARTIAL/.test(key);
  const claimStpEligible = !hasFailure && !needsExaminer && !pendingReq;
  console.log(`\x1b[36m[EvaluateClaim]\x1b[0m claim=${claimId} -> stpEligible=${claimStpEligible}`);
  res.json({
    success: true,
    claimId: claimId || null,
    claimType: claimType || 'DEATH',
    claimStpEligible,
    requiresExaminer: needsExaminer,
    pendingRequirements: pendingReq,
    claimFlags: {
      contestable: /CONTEST/.test(key),
      minorBene: /MINOR/.test(key),
      sanctionsHit: /SANCTION/.test(key),
      policyNotInForce: /LAPSE|POLICYFAIL/.test(key)
    }
  });
});


// 25. Business Central Git Clone - Live Proxy
app.post('/business-central/rest/spaces/:spaceName/git/clone', (req, res) => {
  const targetPath = `/business-central/rest/spaces/${req.params.spaceName}/git/clone`;
  proxyToBusinessCentral(req, res, targetPath, 'POST');
});

// 26. Business Central Job Status - Live Proxy
app.get('/business-central/rest/jobs/:jobId', (req, res) => {
  const targetPath = `/business-central/rest/jobs/${req.params.jobId}`;
  proxyToBusinessCentral(req, res, targetPath, 'GET');
});

// 27. Business Central Delete Project - Live Proxy
app.delete('/business-central/rest/spaces/:spaceName/projects/:projectName', (req, res) => {
  const targetPath = `/business-central/rest/spaces/${req.params.spaceName}/projects/${req.params.projectName}`;
  proxyToBusinessCentral(req, res, targetPath, 'DELETE');
});

// 28. KIE Server Start Process Instance - Live Proxy
app.post('/kie-server/services/rest/server/containers/:containerId/processes/:processId/instances', (req, res) => {
  proxyToBpmService(req, res, 'startProcess', {
    containerId: req.params.containerId,
    processId: req.params.processId
  });
});

// 29. KIE Server Signal Process Instance - Live Proxy
app.post('/kie-server/services/rest/server/containers/:containerId/processes/instances/:processInstanceId/signal/:signalName', (req, res) => {
  proxyToBpmService(req, res, 'signalProcess', {
    containerId: req.params.containerId,
    processInstanceId: req.params.processInstanceId,
    signalName: req.params.signalName
  });
});

// 30. KIE Server Query Pot-Owners Tasks - Live Proxy
app.get('/kie-server/services/rest/server/queries/tasks/instances/pot-owners', (req, res) => {
  proxyToBpmService(req, res, 'queryTasks');
});

// 31. KIE Server Claim Task - Live Proxy
app.put('/kie-server/services/rest/server/containers/:containerId/tasks/:taskId/states/claimed', (req, res) => {
  proxyToBpmService(req, res, 'claimTask', {
    containerId: req.params.containerId,
    taskId: req.params.taskId
  });
});

// 32. KIE Server Start Task - Live Proxy
app.put('/kie-server/services/rest/server/containers/:containerId/tasks/:taskId/states/started', (req, res) => {
  proxyToBpmService(req, res, 'startTask', {
    containerId: req.params.containerId,
    taskId: req.params.taskId
  });
});

// 33. KIE Server Complete Task - Live Proxy
app.put('/kie-server/services/rest/server/containers/:containerId/tasks/:taskId/states/completed', (req, res) => {
  proxyToBpmService(req, res, 'completeTask', {
    containerId: req.params.containerId,
    taskId: req.params.taskId
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`\x1b[32m==================================================\x1b[0m`);
  console.log(`\x1b[32m🚀 Prudential Claims Mock Server Running on Port ${PORT}\x1b[0m`);
  console.log(`\x1b[32m==================================================\x1b[0m`);
  console.log(`\x1b[35mWaiting for jBPM REST WorkItem invocations...\x1b[0m`);
});
