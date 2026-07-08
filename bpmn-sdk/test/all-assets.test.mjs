import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseProject } from '../dist/index.mjs';
import { buildAllAssetsProject, ASSET_FILES } from '../examples/05-all-assets-project.mjs';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
const { written } = buildAllAssetsProject(out);

test('every asset type is packaged into the exported kjar', () => {
  for (const rel of Object.keys(ASSET_FILES)) {
    const abs = path.join(out, rel);
    assert.ok(fs.existsSync(abs), `missing asset ${rel}`);
    assert.strictEqual(fs.readFileSync(abs, 'utf8'), ASSET_FILES[rel], `asset content mismatch ${rel}`);
  }
});

test('the process (JS script node + businessRuleTask + form user task) + scaffolding exported', () => {
  assert.ok(written.some((f) => f.endsWith('assets-main.bpmn')), 'bpmn');
  assert.ok(written.some((f) => f.endsWith('pom.xml')), 'pom');
  assert.ok(written.some((f) => f.includes('kie-deployment-descriptor.xml')), 'deployment');
  assert.ok(written.some((f) => f.endsWith('WorkDefinitions.wid')), 'wid');
  const xml = fs.readFileSync(path.join(out, 'src/main/resources/org/jbpm/assets-main.bpmn'), 'utf8');
  assert.ok(xml.includes('scriptFormat="http://www.javascript.com/javascript"'), 'JS script node');
  assert.ok(xml.includes('<bpmn2:businessRuleTask') && xml.includes('drools:ruleFlowGroup="classify"'), 'DRL-linked business rule task');
  assert.ok(xml.includes('<bpmn2:userTask'), 'form user task');
});

test('re-parsing the exported project re-captures all assets (verbatim round-trip)', () => {
  const p = parseProject(out);
  const files = p.descriptor.files || {};
  for (const rel of Object.keys(ASSET_FILES)) {
    assert.ok(files[rel] !== undefined, `asset not re-captured: ${rel}`);
    assert.strictEqual(files[rel], ASSET_FILES[rel], `re-capture mismatch ${rel}`);
  }
});

test('covers the palette breadth (drl, dmn, dsl, enumeration, guided, scorecard, tests, solver, form, java, wid)', () => {
  const exts = new Set(Object.keys(ASSET_FILES).map((f) => path.extname(f)));
  for (const e of ['.java', '.drl', '.dmn', '.dsl', '.enumeration', '.rdrl', '.template', '.gdst', '.scgd', '.scesim', '.scenario', '.frm', '.properties'])
    assert.ok(exts.has(e), `example missing asset ext ${e}`);
  assert.ok(Object.keys(ASSET_FILES).some((f) => f.endsWith('.solver.xml')), 'solver config present');
});

test.after(() => fs.rmSync(out, { recursive: true, force: true }));
