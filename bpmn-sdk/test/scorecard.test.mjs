// Score card — engine scorecard -> .scgd (ScoreCardModel: characteristics + attribute bins, derived
// types, round-trip, well-formed) + the runtime scorer (baseline + first matching bin per field).
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorecardToScgd, buildAsset, parseAsset, fromEngineProject } from '../dist/index.mjs';
import { evaluateScorecard } from '../examples/functions/scorecard.mjs';
import { SCORECARD } from '../examples/guided/20-scorecard.mjs';

const TYPES = { amount: 'double', region: 'string', riskScore: 'int' };

test('scorecardToScgd — model, characteristics, attribute bins (op/between/eq/catch-all)', () => {
  const scgd = buildAsset({ kind: 'scoreCard', model: scorecardToScgd(SCORECARD, TYPES, (t) => `com.acme.model.${t}`) });
  assert.ok(scgd.includes('<ScoreCardModel><name>Claim risk</name>'));
  assert.ok(scgd.includes('<fieldName>riskScore</fieldName>') && scgd.includes('<initialScore>100</initialScore>'));
  assert.ok(scgd.includes('<factName>com.acme.model.Claim</factName>'), 'fact resolved to FQN');
  assert.ok(scgd.includes('<field>amount</field>') && scgd.includes('<dataType>Double</dataType>'));
  // bins -> attributes: op, between (in), eq (=), catch-all (empty operator)
  assert.ok(scgd.includes('<operator>&lt;</operator><value>1000</value><partialScore>0</partialScore>'));
  assert.ok(scgd.includes('<operator>in</operator><value>1000..100000</value><partialScore>10</partialScore>'));
  assert.ok(scgd.includes('<operator>=</operator><value>US</value><partialScore>5</partialScore>'));
  assert.ok(scgd.includes('<operator/><value/><partialScore>20</partialScore>'), 'catch-all bin');
});

test('scorecardToScgd — round-trip stable + well-formed (xmllint)', () => {
  const scgd = buildAsset({ kind: 'scoreCard', model: scorecardToScgd(SCORECARD, TYPES) });
  assert.strictEqual(buildAsset(parseAsset('s.scgd', scgd)), scgd, 'round-trip stable');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scgd-')); const p = path.join(tmp, 's.scgd'); fs.writeFileSync(p, scgd);
  execSync(`xmllint --noout "${p}"`, { stdio: 'pipe' });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('fromEngineProject — scorecard -> .scgd at defaulted path', () => {
  const proj = fromEngineProject({
    types: [{ name: 'Claim', fields: [{ name: 'amount', type: 'double' }, { name: 'region', type: 'string' }, { name: 'riskScore', type: 'int' }] }],
    scorecards: [SCORECARD],
    processes: [{ id: 'p', package: 'com.acme', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }],
  });
  assert.ok(proj.descriptor.files['src/main/resources/com/acme/rules/Claim_risk.scgd'], 'default path');
});

// ---- runtime scorer (fully verified) ----
test('evaluateScorecard — baseline + first matching bin per characteristic', () => {
  assert.strictEqual(evaluateScorecard(SCORECARD, { amount: 250000, region: 'US' }).score, 135);       // 100+30+5
  assert.strictEqual(evaluateScorecard(SCORECARD, { amount: 5000, region: 'EU' }).score, 130);          // 100+10+20 (catch-all)
  assert.strictEqual(evaluateScorecard(SCORECARD, { amount: 500, region: 'BLOCKED' }).score, 150);       // 100+0+50
  const r = evaluateScorecard(SCORECARD, { amount: 250000, region: 'US' });
  assert.strictEqual(r.fact.riskScore, 135, 'score written to the fact field');
  assert.deepStrictEqual(r.contributions, [{ field: 'amount', points: 30 }, { field: 'region', points: 5 }]);
});
