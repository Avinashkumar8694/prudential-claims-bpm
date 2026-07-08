// Structured JSON codecs for Business Central asset files.
// - XML-based assets (DMN, guided tables/tree/rule/template, scorecard, test scenarios, solver, XML
//   forms) -> a generic, lossless XML tree (ElementNode) your engine can traverse/generate/edit.
// - Non-XML assets get small typed models: .properties, .enumeration, .dsl, .wid, JSON forms.
// - .drl and .java get best-effort structured models (rules / fields) with the raw text retained.
// Every codec is round-trip-stable (build(parse(x)) re-parses to the same model; build is idempotent).
import { parseXml, stringifyNode } from './xml.js';
import type { ElementNode } from './xml.js';
import { parseWid, widMvel } from './scaffold.js';
import type { WorkItemDefinition } from './types.js';

export type AssetKind =
  | 'drl' | 'dmn' | 'dsl' | 'enumeration'
  | 'guidedDecisionTable' | 'guidedDecisionTree' | 'guidedRule' | 'guidedRuleTemplate'
  | 'scoreCard' | 'testScenario' | 'testScenarioLegacy'
  | 'form' | 'dataObject' | 'workItemDefinition' | 'properties' | 'solver' | 'xml' | 'text';

const EXT_KIND: Record<string, AssetKind> = {
  '.drl': 'drl', '.dmn': 'dmn', '.dsl': 'dsl', '.enumeration': 'enumeration',
  '.gdst': 'guidedDecisionTable', '.gdt': 'guidedDecisionTree', '.rdrl': 'guidedRule', '.rdslr': 'guidedRule',
  '.template': 'guidedRuleTemplate', '.scgd': 'scoreCard', '.scesim': 'testScenario', '.scenario': 'testScenarioLegacy',
  '.frm': 'form', '.form': 'form', '.java': 'dataObject', '.wid': 'workItemDefinition', '.properties': 'properties',
};
const XML_KINDS = new Set<AssetKind>(['dmn', 'guidedDecisionTable', 'guidedDecisionTree', 'guidedRule',
  'guidedRuleTemplate', 'scoreCard', 'testScenario', 'testScenarioLegacy', 'solver', 'xml']);

export function assetKind(pathOrName: string): AssetKind {
  if (pathOrName.endsWith('.solver.xml')) return 'solver';
  const ext = pathOrName.slice(pathOrName.lastIndexOf('.')).toLowerCase();
  return EXT_KIND[ext] || (ext === '.xml' ? 'xml' : 'text');
}

export interface Asset { kind: AssetKind; path?: string; model: any; }

// ---- properties ----
export function parseProperties(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('!')) continue;
    const i = t.search(/[=:]/); if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}
export function writeProperties(props: Record<string, string>): string {
  return Object.entries(props).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
}

// ---- enumeration ----  'Fact.field' : [ 'A', 'B' ]
export function parseEnumeration(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const re = /'([^']+)'\s*:\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out[m[1]] = m[2].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  }
  return out;
}
export function writeEnumeration(enums: Record<string, string[]>): string {
  return Object.entries(enums).map(([k, vs]) => `'${k}' : [ ${vs.map((v) => `'${v}'`).join(', ')} ]`).join('\n') + '\n';
}

// ---- dsl ----  [when]NL=mapping
export interface DslEntry { scope: string; nl: string; mapping: string; }
export function parseDsl(text: string): DslEntry[] {
  const out: DslEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\[(when|then|\*|keyword)\]([^=]*)=(.*)$/.exec(line.trim());
    if (m) out.push({ scope: m[1], nl: m[2], mapping: m[3] });
  }
  return out;
}
export function writeDsl(entries: DslEntry[]): string {
  return entries.map((e) => `[${e.scope}]${e.nl}=${e.mapping}`).join('\n') + '\n';
}

// ---- Java data object (best-effort: package, class, fields) ----
export interface JavaField { name: string; type: string; }
export interface DataObjectModel { package?: string; className: string; fields: JavaField[]; raw?: string; }
export function parseDataObject(text: string): DataObjectModel {
  const pkg = /package\s+([\w.]+)\s*;/.exec(text);
  const cls = /class\s+(\w+)/.exec(text);
  const fields: JavaField[] = [];
  const re = /(?:private|protected|public)\s+([\w.<>\[\]]+)\s+(\w+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) fields.push({ type: m[1], name: m[2] });
  return { package: pkg ? pkg[1] : undefined, className: cls ? cls[1] : 'Data', fields };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export function writeDataObject(m: DataObjectModel): string {
  const fields = m.fields.map((f) => `    private ${f.type} ${f.name};`).join('\n');
  const acc = m.fields.map((f) =>
    `    public ${f.type} get${cap(f.name)}() { return ${f.name}; }\n` +
    `    public void set${cap(f.name)}(${f.type} ${f.name}) { this.${f.name} = ${f.name}; }`).join('\n');
  return `${m.package ? `package ${m.package};\n\n` : ''}public class ${m.className} {\n${fields}${fields ? '\n' : ''}${acc}\n}\n`;
}

// ---- DRL (best-effort: package, imports, globals, rules{name, attributes, when, then}) ----
export interface DrlRule { name: string; attributes: string[]; when: string; then: string; }
export interface DrlModel { package?: string; imports: string[]; globals: string[]; rules: DrlRule[]; raw?: string; }
export function parseDrl(text: string): DrlModel {
  const pkg = /^\s*package\s+([\w.]+)\s*;?/m.exec(text);
  const imports = [...text.matchAll(/^\s*import\s+([\w.*]+)\s*;?/mg)].map((m) => m[1]);
  const globals = [...text.matchAll(/^\s*global\s+(.+?)\s*;?\s*$/mg)].map((m) => m[1]);
  const rules: DrlRule[] = [];
  const re = /rule\s+"([^"]+)"([\s\S]*?)\bwhen\b([\s\S]*?)\bthen\b([\s\S]*?)\bend\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const attrs = m[2].split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    rules.push({ name: m[1], attributes: attrs, when: m[3].trim(), then: m[4].trim() });
  }
  return { package: pkg ? pkg[1] : undefined, imports, globals, rules };
}
export function writeDrl(m: DrlModel): string {
  const parts: string[] = [];
  if (m.package) parts.push(`package ${m.package};`);
  (m.imports || []).forEach((i) => parts.push(`import ${i};`));
  (m.globals || []).forEach((g) => parts.push(`global ${g};`));
  if (parts.length) parts.push('');
  for (const r of m.rules) {
    parts.push(`rule "${r.name}"`);
    (r.attributes || []).forEach((a) => parts.push(`    ${a}`));
    parts.push('    when');
    parts.push(`        ${r.when}`);
    parts.push('    then');
    parts.push(`        ${r.then}`);
    parts.push('end');
    parts.push('');
  }
  return parts.join('\n').replace(/\n+$/, '\n');
}

// ---- form: JSON (.frm) or XML (.form) ----
export function parseForm(text: string): any {
  const t = text.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) return { json: JSON.parse(text) };
  return { xml: parseXml(text) };
}
export function writeForm(model: any): string {
  if (model.json !== undefined) return JSON.stringify(model.json, null, 2) + '\n';
  return stringifyNode(model.xml);
}

// ---- dispatcher ----
export function parseAsset(path: string, content: string): Asset {
  const kind = assetKind(path);
  if (XML_KINDS.has(kind)) return { kind, path, model: { xml: parseXml(content) } };
  switch (kind) {
    case 'properties': return { kind, path, model: { props: parseProperties(content) } };
    case 'enumeration': return { kind, path, model: { enums: parseEnumeration(content) } };
    case 'dsl': return { kind, path, model: { entries: parseDsl(content) } };
    case 'workItemDefinition': return { kind, path, model: { definitions: parseWid(content) } };
    case 'dataObject': return { kind, path, model: parseDataObject(content) };
    case 'drl': return { kind, path, model: parseDrl(content) };
    case 'form': return { kind, path, model: parseForm(content) };
    default: return { kind, path, model: { text: content } };
  }
}
export function buildAsset(asset: Asset): string {
  const { kind, model } = asset;
  if (XML_KINDS.has(kind)) return '<?xml version="1.0" encoding="UTF-8"?>\n' + stringifyNode(model.xml as ElementNode);
  switch (kind) {
    case 'properties': return writeProperties(model.props);
    case 'enumeration': return writeEnumeration(model.enums);
    case 'dsl': return writeDsl(model.entries);
    case 'workItemDefinition': return widMvel(model.definitions as WorkItemDefinition[]);
    case 'dataObject': return writeDataObject(model as DataObjectModel);
    case 'drl': return writeDrl(model as DrlModel);
    case 'form': return writeForm(model);
    default: return (model && model.text) || '';
  }
}
