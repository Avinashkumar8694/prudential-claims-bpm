import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { parseAsset } from '../dist/index.mjs';
import { buildGeneratedAssetsProject, GENERATED } from '../examples/assets/06-generate-assets.mjs';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-'));
const { written } = buildGeneratedAssetsProject(out);

test('all generated assets are written into the kjar', () => {
  for (const rel of Object.keys(GENERATED)) {
    assert.ok(fs.existsSync(path.join(out, rel)), `missing ${rel}`);
    assert.strictEqual(fs.readFileSync(path.join(out, rel), 'utf8'), GENERATED[rel], `content ${rel}`);
  }
  assert.ok(written.some((f) => f.endsWith('.bpmn')) && written.some((f) => f.endsWith('pom.xml')));
});

test('generated DRL parses back to the same rule model', () => {
  const drlPath = Object.keys(GENERATED).find((f) => f.endsWith('.drl'));
  const a = parseAsset('x.drl', GENERATED[drlPath]);
  assert.strictEqual(a.model.package, 'com.acme.rules');
  assert.strictEqual(a.model.rules[0].name, 'High value claim');
  assert.ok(a.model.rules[0].when.includes('amount > 100000'));
});

test('generated DMN parses back to a structured tree with the right decision', () => {
  const dmnPath = Object.keys(GENERATED).find((f) => f.endsWith('.dmn'));
  const a = parseAsset('x.dmn', GENERATED[dmnPath]);
  assert.strictEqual(a.model.xml.name, 'definitions');
  assert.strictEqual(a.model.xml.attrs.name, 'Eligibility');
  const decision = a.model.xml.children.find((c) => c.name === 'decision');
  assert.strictEqual(decision.attrs.name, 'isEligible');
  const lit = decision.children.find((c) => c.name === 'literalExpression');
  assert.strictEqual(lit.text, 'amount < 500000', 'entity-safe text preserved');
});

test('generated Java data object regenerates getters/setters', () => {
  const j = GENERATED['src/main/java/com/acme/model/Claim.java'];
  assert.ok(j.includes('public class Claim'));
  assert.ok(j.includes('public double getAmount()'));
  assert.ok(j.includes('public void setStatus(String status)'));
});

test('generated XML assets are well-formed (xmllint)', () => {
  for (const rel of Object.keys(GENERATED)) {
    if (rel.endsWith('.dmn') || rel.endsWith('.xml')) {
      const tmp = path.join(out, rel);
      execSync(`xmllint --noout "${tmp}"`, { stdio: 'pipe' });
    }
  }
});

test.after(() => fs.rmSync(out, { recursive: true, force: true }));
