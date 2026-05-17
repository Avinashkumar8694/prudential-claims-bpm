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
  
  if (req.headers['authorization']) {
    headers['Authorization'] = req.headers['authorization'];
  } else {
    // Fallback default: Basic Auth credentials for krisv:krisv
    headers['Authorization'] = 'Basic a3Jpc3Y6a3Jpc3Y=';
  }
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

  console.log(`\x1b[36m[BC Proxy]\x1b[0m Forwarding ${method} to https://${targetHost}${targetPath}`);

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

const app = express();
const PORT = process.env.PORT || 3010;

app.use(cors());
app.use(express.json());

// Serve interactive Swagger UI documentation at /api-docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Global rewrite middleware to support both prefix-less conceptual routes (from spec diagrams) and versioned production routes
app.use((req, res, next) => {
  if (!req.url.startsWith('/api/v1') && !req.url.startsWith('/business-central') && !req.url.startsWith('/api-docs')) {
    if (req.url === '/claims/tax/fund-check') {
      req.url = '/api/v1/claims/tax/single-fund';
    } else {
      req.url = '/api/v1' + req.url;
    }
    console.log(`\x1b[35m[Route Alias]\x1b[0m Rewrote conceptual route to: ${req.url}`);
  }
  next();
});

// Request logger middleware to inspect BPM engine execution
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n\x1b[36m[${timestamp}] ${req.method} ${req.url}\x1b[0m`);
  console.log('\x1b[33mRequest Payload:\x1b[0m', JSON.stringify(req.body, null, 2));
  next();
});


// --- PROCESS 1: MAIN CLAIMS INTERNAL PROCESSING ENDPOINTS ---

// 1. Validate Data
app.post('/api/v1/claims/validate-data', (req, res) => {
  const { piid, caseId } = req.body;
  res.json({
    success: true,
    validationPassed: true,
    policyFlags: {
      isSuicide: false,
      isContestable: false,
      isForeignDeath: false,
      isAIDS: false
    }
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
  const { caseId, applicablePolicies } = req.body;
  const updatedPolicies = (applicablePolicies || ['POL12345']).map(policy => ({
    policyNumber: policy,
    status: 'PENDING_DEATH_CLAIM',
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
  // Simulating all documents verified successfully by default
  res.json({
    success: true,
    allDocsVerified: true,
    missingDocs: []
  });
});

// 5. Policy Validation (Mainframe)
app.post('/api/v1/claims/validate-policy', (req, res) => {
  res.json({
    success: true,
    validationPassed: true,
    policyFlags: {
      isActive: true,
      premiumsPaid: true,
      hasLapseAlert: false
    }
  });
});

// 6. Beneficiary Validation
app.post('/api/v1/claims/validate-beneficiary', (req, res) => {
  res.json({
    success: true,
    minorDetected: false,
    beneficiaryFlags: {
      identitiesVerified: true,
      sanctionsChecked: true
    }
  });
});

// 7. Bank Account Validation (PVS)
app.post('/api/v1/claims/validate-bank', (req, res) => {
  res.json({
    success: true,
    pvsMatch: true,
    bankValidationResult: {
      accountActive: true,
      ownerMatch: true,
      routingValid: true
    }
  });
});

// 8. Contestability check (MRX)
app.post('/api/v1/claims/mrx-check', (req, res) => {
  res.json({
    success: true,
    alerts: [],
    mrxCheckResult: {
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

// 11. Apply Tax Rules
app.post('/api/v1/claims/tax/apply', (req, res) => {
  res.json({
    success: true,
    taxExceptions: false,
    taxCheckResult: {
      withholdingApplied: true,
      irsReportingGenerated: true
    }
  });
});

// 12. Calculate Benefit
app.post('/api/v1/claims/calculate', (req, res) => {
  res.json({
    success: true,
    payoutAmount: 250000.00,
    benefitCalculation: {
      baseFaceAmount: 250000.00,
      accruedInterest: 1250.00,
      outstandingLoans: 0.00,
      netPayout: 251250.00
    }
  });
});

// 13. Misstatement Adjustments
app.post('/api/v1/claims/misstatement-adjust', (req, res) => {
  const { benefitCalculation } = req.body;
  res.json({
    success: true,
    adjustedBenefitCalculation: {
      ...benefitCalculation,
      misstatementExclusionApplied: true,
      adjustedPayout: benefitCalculation ? benefitCalculation.netPayout : 251250.00
    }
  });
});

// 14. Beneficiary Split Execution
app.post('/api/v1/claims/beneficiary-split', (req, res) => {
  res.json({
    success: true,
    beneficiarySplit: {
      primaryBeneficiaryRatio: 1.0,
      splits: [
        { name: "John Doe", amount: 251250.00, role: "Primary" }
      ]
    }
  });
});

// 15. Backup Withholding Checks
app.post('/api/v1/claims/backup-withholding', (req, res) => {
  res.json({
    success: true,
    withholdingResult: {
      withholdingDeducted: 0.00,
      finalPayout: 251250.00
    },
    finalPayouts: [
      { beneficiary: "John Doe", amount: 251250.00 }
    ]
  });
});

// 16. Finalize Payment
app.post('/api/v1/claims/finalize', (req, res) => {
  res.json({
    success: true,
    finalPaymentInstructions: {
      paymentGateway: "EFT",
      payoutStatus: "SUCCESS",
      bankRefNum: `EFT-${Math.floor(1000000 + Math.random() * 9000000)}`
    }
  });
});

// 17. TI KNECT Payment (Accelerated Benefits Path)
app.post('/api/v1/claims/ti-knect-payment', (req, res) => {
  res.json({
    success: true,
    knectTransactionId: `TXN-${Math.floor(10000000 + Math.random() * 90000000)}`
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

// 19. Generate Death Funding Requirements Notice
app.post('/api/v1/claims/nigo/funding-notice', (req, res) => {
  res.json({
    success: true,
    documentS3Key: `s3://claims-vault/notices/funding-${Math.floor(1000 + Math.random() * 9000)}.pdf`
  });
});

// 20. Generate TI Standard Notice
app.post('/api/v1/claims/nigo/standard-notice', (req, res) => {
  res.json({
    success: true,
    documentS3Key: `s3://claims-vault/notices/standard-ti-${Math.floor(1000 + Math.random() * 9000)}.pdf`
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
      documentClassified: "DEATH_CERTIFICATE",
      extractedData: {
        decedentName: "Jane Doe",
        dateOfDeath: "2026-05-01"
      }
    }
  });
});

// 23. Update Claim Status (Check Outstanding Documents)
app.post('/api/v1/claims/nigo/update-status', (req, res) => {
  res.json({
    success: true,
    allDocsReceived: true
  });
});

// 24. Death Verification Status
app.post('/api/v1/claims/nigo/death-verification', (req, res) => {
  res.json({
    success: true,
    verificationStatus: "VERIFIED"
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

// Start the server
app.listen(PORT, () => {
  console.log(`\x1b[32m==================================================\x1b[0m`);
  console.log(`\x1b[32m🚀 Prudential Claims Mock Server Running on Port ${PORT}\x1b[0m`);
  console.log(`\x1b[32m==================================================\x1b[0m`);
  console.log(`\x1b[35mWaiting for jBPM REST WorkItem invocations...\x1b[0m`);
});
