// jBPM <-> JSON must never FAIL on a project that contains files the SDK doesn't specifically model.
// Unrecognized .xml -> `xml` (generic tree); any other unknown extension -> `text` (raw). Both survive
// parse -> build and toEngineProject -> fromEngineProject byte-for-byte.
import { test } from 'node:test';
import assert from 'node:assert';
import { assetKind, parseAsset, buildAsset, toEngineProject, fromEngineProject, parseProject, writeProject } from '../dist/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('assetKind — unknown files fall back (xml / text)', () => {
  assert.strictEqual(assetKind('custom/beans.xml'), 'xml');
  assert.strictEqual(assetKind('notes.md'), 'text');
  assert.strictEqual(assetKind('app.cfg'), 'text');
  assert.strictEqual(assetKind('LICENSE'), 'text');
});

test('parseAsset/buildAsset — arbitrary XML + arbitrary text round-trip', () => {
  const xml = '<beans xmlns="x"><bean id="a"><prop>v</prop></bean></beans>';
  assert.strictEqual(parseAsset('beans.xml', xml).kind, 'xml');
  const rebuiltXml = buildAsset(parseAsset('beans.xml', xml));
  assert.ok(rebuiltXml.includes('<bean id="a">') && rebuiltXml.includes('<prop>v</prop>'), 'xml structure preserved');
  const txt = 'line one\nline two\n# a comment\n';
  assert.strictEqual(parseAsset('README.md', txt).kind, 'text');
  assert.strictEqual(buildAsset(parseAsset('README.md', txt)), txt, 'text verbatim');
});

test('toEngineProject -> fromEngineProject — unmodeled files are carried, not dropped', () => {
  const xml = '<config><flag>on</flag></config>';
  const md = '# Notes\nsome text\n';
  const project = { root: '.', descriptor: { files: {
    'src/main/resources/custom/config.xml': xml,
    'src/main/resources/notes.md': md,
    'src/main/resources/app.properties': 'a=1\nb=2\n',
  } }, processes: [] };
  const engine = toEngineProject(project);
  assert.strictEqual(engine.assets['src/main/resources/custom/config.xml'].kind, 'xml');
  assert.strictEqual(engine.assets['src/main/resources/notes.md'].kind, 'text');
  const back = fromEngineProject(engine);
  assert.ok(back.descriptor.files['src/main/resources/custom/config.xml'].includes('<flag>on</flag>'), 'xml preserved');
  assert.strictEqual(back.descriptor.files['src/main/resources/notes.md'], md, 'text preserved');
});

test('parseProject/writeProject — a kjar with odd files round-trips on disk (nothing lost)', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'kjar-src-'));
  // a minimal kjar-ish tree with unmodeled files alongside a bpmn
  fs.mkdirSync(path.join(src, 'src/main/resources/custom'), { recursive: true });
  fs.writeFileSync(path.join(src, 'src/main/resources/custom/beans.xml'), '<beans><bean id="x"/></beans>\n');
  fs.writeFileSync(path.join(src, 'README.md'), '# hello\n');
  fs.writeFileSync(path.join(src, 'src/main/resources/p.bpmn'), '<?xml version="1.0"?>\n<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="p"/></definitions>\n');
  const project = parseProject(src);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kjar-out-'));
  writeProject(project, out);
  // the unmodeled files are written back verbatim
  assert.ok(fs.readFileSync(path.join(out, 'src/main/resources/custom/beans.xml'), 'utf8').includes('<bean id="x"/>'));
  assert.ok(fs.existsSync(path.join(out, 'README.md')), 'README carried');
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
});

test('parseProject/writeProject — BINARY files round-trip byte-for-byte (base64)', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'kjar-bin-src-'));
  fs.mkdirSync(path.join(src, 'src/main/resources/img'), { recursive: true });
  // a real binary blob (non-UTF-8 bytes) — e.g. an image or an .xls scorecard
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x10, 0x80]);
  fs.writeFileSync(path.join(src, 'src/main/resources/img/logo.png'), bytes);
  fs.writeFileSync(path.join(src, 'src/main/resources/p.bpmn'), '<?xml version="1.0"?>\n<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="p"/></definitions>\n');
  const project = parseProject(src);
  assert.ok(project.descriptor.binaryFiles && project.descriptor.binaryFiles['src/main/resources/img/logo.png'], 'binary captured as base64');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kjar-bin-out-'));
  writeProject(project, out);
  const rewritten = fs.readFileSync(path.join(out, 'src/main/resources/img/logo.png'));
  assert.ok(rewritten.equals(bytes), 'binary bytes identical after round-trip');
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
});
