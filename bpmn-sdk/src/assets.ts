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

// ---- DRL ----
// A full model of a Drools rule file. Every construct a jBPM `.drl` can hold is representable either
// structurally (a Node engine can execute the JSON) or as a `raw` escape hatch, and compiles to text.
// `parseDrl` is best-effort: package/unit/imports/globals + structured rules (raw when/then) and
// functions/declares/queries captured as raw blocks — round-trip stable (parse(build(m)) === m).

export type ConstraintOp =
  | '==' | '!=' | '>' | '>=' | '<' | '<='
  | 'contains' | 'not contains' | 'memberOf' | 'not memberOf'
  | 'matches' | 'not matches' | 'soundslike' | 'in' | 'not in';
export type RuleConstraint =
  | { field: string; op: ConstraintOp; value: string | number | boolean | Array<string | number | boolean> } // amount > 100000 ; status in ("A","B")
  | { field: string; op: ConstraintOp; var: string }   // compare to a bound var / expression (unquoted): amount > $threshold
  | { bind: string; field: string }                    // field binding: $a : amount
  | { raw: string };                                   // literal constraint text
export interface RulePattern {
  fact: string;                 // fact type (declared type name / imported class)
  bind?: string;                // $c : Fact(...)
  constraints?: RuleConstraint[];
  from?: string;                // ... from <source> (e.g. "$c.addresses")
  entryPoint?: string;          // ... from entry-point "stream"
}
// Left-hand side (conditions) — patterns combined with conditional elements. All recursive.
export type LhsElement =
  | RulePattern
  | { and: LhsElement[] }
  | { or: LhsElement[] }
  | { not: LhsElement }
  | { exists: LhsElement }
  | { forall: LhsElement[] }
  | { eval: string }
  | { collect: { pattern: RulePattern; source: LhsElement | string } }   // $l : List() from collect( ... )
  | { accumulate: { source: LhsElement | string; bindings: Array<{ bind?: string; fn: string; arg: string }> } }
  | { raw: string };
// Right-hand side (consequences).
export type RhsValue = string | number | boolean | { expr: string };     // {expr} = unquoted Java/JS expression
export type RuleAction =
  | { modify: string; set: Record<string, RhsValue> }      // modify($c){ setX(v), setY(v) }
  | { update: string; set: Record<string, RhsValue> }      // $c.setX(v); update($c);
  | { insert: string }                                     // insert( <expr> );
  | { insertLogical: string }                              // insertLogical( <expr> );
  | { delete: string }                                     // delete( $c );   (Drools 6+)
  | { retract: string }                                    // retract( $c );  (legacy alias)
  | { call: string; args?: Array<string | number | boolean> } // fn( args ); or global.method( args );
  | { raw: string };                                       // literal RHS line(s)
// Rule attributes — structured (compiled to attribute lines) or supply raw `attributes` strings.
export interface RuleAttributes {
  salience?: number; enabled?: boolean; dialect?: 'java' | 'mvel';
  ruleflowGroup?: string; agendaGroup?: string; activationGroup?: string;
  autoFocus?: boolean; lockOnActive?: boolean; noLoop?: boolean;
  dateEffective?: string; dateExpires?: string; duration?: number; timer?: string; calendars?: string[];
}
export interface DrlParam { type: string; name: string; }
export interface DrlFunction { name: string; returnType?: string; params?: DrlParam[]; body: string; }
export interface DrlDeclareField { name: string; type: string; annotations?: string[]; }
export interface DrlDeclare { name: string; extends?: string; annotations?: string[]; fields: DrlDeclareField[]; }
export interface DrlQuery { name: string; params?: DrlParam[]; when: string | LhsElement[]; }
export interface DrlRule {
  name: string;
  extends?: string;             // rule "x" extends "y"
  meta?: string[];              // @metadata annotations
  attributes?: string[];        // raw attribute lines
  attrs?: RuleAttributes;       // structured attributes (compiled to lines)
  when: string | LhsElement[];
  then: string | RuleAction[];
}
export interface DrlModel {
  package?: string;
  unit?: string;                // rule unit (Drools 7+)
  imports: string[];
  staticImports?: string[];     // import static X;
  functionImports?: string[];   // import function X;
  globals: string[];
  functions?: (DrlFunction | string)[];
  declares?: (DrlDeclare | string)[];
  queries?: (DrlQuery | string)[];
  rules: DrlRule[];
}

const drlLit = (v: string | number | boolean) => typeof v === 'string' ? JSON.stringify(v) : String(v);
const drlVal = (v: RhsValue) => (v && typeof v === 'object' && 'expr' in v) ? v.expr : drlLit(v);
export function compileConstraint(c: RuleConstraint): string {
  if ('raw' in c) return c.raw;
  if ('bind' in c) return `${c.bind} : ${c.field}`;
  if ('var' in c) return `${c.field} ${c.op} ${c.var}`;
  if (c.op === 'in' || c.op === 'not in') {
    const arr = Array.isArray(c.value) ? c.value : [c.value];
    return `${c.field} ${c.op} ( ${arr.map(drlLit).join(', ')} )`;
  }
  return `${c.field} ${c.op} ${drlLit(c.value as string | number | boolean)}`;
}
export function compilePattern(p: RulePattern): string {
  const cs = (p.constraints || []).map(compileConstraint).join(', ');
  let s = `${p.bind ? p.bind + ' : ' : ''}${p.fact}( ${cs} )`;
  if (p.from) s += ` from ${p.from}`;
  if (p.entryPoint) s += ` from entry-point ${JSON.stringify(p.entryPoint)}`;
  return s;
}
export function compileLhs(el: LhsElement): string {
  if ('raw' in el) return el.raw;
  if ('and' in el) return `( ${el.and.map(compileLhs).join(' and ')} )`;
  if ('or' in el) return `( ${el.or.map(compileLhs).join(' or ')} )`;
  if ('not' in el) return `not ${compileLhs(el.not)}`;
  if ('exists' in el) return `exists ${compileLhs(el.exists)}`;
  if ('forall' in el) return `forall ( ${el.forall.map(compileLhs).join(' ')} )`;
  if ('eval' in el) return `eval( ${el.eval} )`;
  if ('collect' in el) {
    const src = typeof el.collect.source === 'string' ? el.collect.source : compileLhs(el.collect.source);
    return `${compilePattern(el.collect.pattern)} from collect( ${src} )`;
  }
  if ('accumulate' in el) {
    const src = typeof el.accumulate.source === 'string' ? el.accumulate.source : compileLhs(el.accumulate.source);
    const binds = el.accumulate.bindings.map((b) => `${b.bind ? b.bind + ' : ' : ''}${b.fn}( ${b.arg} )`).join(', ');
    return `accumulate( ${src}; ${binds} )`;
  }
  return compilePattern(el as RulePattern);
}
export function compileAction(a: RuleAction): string {
  if ('modify' in a) return `modify( ${a.modify} ) { ${Object.entries(a.set).map(([f, v]) => `set${cap(f)}( ${drlVal(v)} )`).join(', ')} }`;
  if ('update' in a) return Object.entries(a.set).map(([f, v]) => `${a.update}.set${cap(f)}( ${drlVal(v)} );`).join(' ') + ` update( ${a.update} );`;
  if ('insertLogical' in a) return `insertLogical( ${a.insertLogical} );`;
  if ('insert' in a) return `insert( ${a.insert} );`;
  if ('delete' in a) return `delete( ${a.delete} );`;
  if ('retract' in a) return `retract( ${a.retract} );`;
  if ('call' in a) return `${a.call}(${(a.args || []).map(drlLit).join(', ')});`;
  return (a as { raw: string }).raw;
}
const whenText = (w: string | LhsElement[]) => typeof w === 'string' ? w : w.map(compileLhs).join('\n        ');
const thenText = (t: string | RuleAction[]) => typeof t === 'string' ? t : t.map(compileAction).join('\n        ');
function compileAttrs(r: DrlRule): string[] {
  const out: string[] = [];
  const a = r.attrs;
  if (a) {
    if (a.salience != null) out.push(`salience ${a.salience}`);
    if (a.enabled != null) out.push(`enabled ${a.enabled}`);
    if (a.dialect) out.push(`dialect "${a.dialect}"`);
    if (a.ruleflowGroup) out.push(`ruleflow-group "${a.ruleflowGroup}"`);
    if (a.agendaGroup) out.push(`agenda-group "${a.agendaGroup}"`);
    if (a.activationGroup) out.push(`activation-group "${a.activationGroup}"`);
    if (a.autoFocus != null) out.push(`auto-focus ${a.autoFocus}`);
    if (a.lockOnActive != null) out.push(`lock-on-active ${a.lockOnActive}`);
    if (a.noLoop != null) out.push(`no-loop ${a.noLoop}`);
    if (a.dateEffective) out.push(`date-effective "${a.dateEffective}"`);
    if (a.dateExpires) out.push(`date-expires "${a.dateExpires}"`);
    if (a.duration != null) out.push(`duration ${a.duration}`);
    if (a.timer) out.push(`timer (${a.timer})`);
    (a.calendars || []).forEach((c) => out.push(`calendars "${c}"`));
  }
  (r.attributes || []).forEach((x) => out.push(x));
  return out;
}
export function compileFunction(f: DrlFunction | string): string {
  if (typeof f === 'string') return f;
  const params = (f.params || []).map((p) => `${p.type} ${p.name}`).join(', ');
  return `function ${f.returnType || 'void'} ${f.name}(${params}) {\n    ${f.body}\n}`;
}
export function compileDeclare(d: DrlDeclare | string): string {
  if (typeof d === 'string') return d;
  const lines = [`declare ${d.name}${d.extends ? ` extends ${d.extends}` : ''}`];
  (d.annotations || []).forEach((a) => lines.push(`    ${a}`));
  d.fields.forEach((f) => lines.push(`    ${f.name} : ${f.type}${(f.annotations || []).map((a) => ` ${a}`).join('')}`));
  lines.push('end');
  return lines.join('\n');
}
export function compileQuery(q: DrlQuery | string): string {
  if (typeof q === 'string') return q;
  const params = (q.params || []).map((p) => `${p.type} ${p.name}`).join(', ');
  const head = params ? `query "${q.name}"(${params})` : `query "${q.name}"`;
  return `${head}\n        ${whenText(q.when)}\nend`;
}
// brace-balanced extraction of top-level function blocks (function bodies may contain nested braces)
function extractFunctions(text: string): { functions: string[]; rest: string } {
  const functions: string[] = [];
  const re = /\bfunction\s+[\w.$<>\[\],\s]+?\([^)]*\)\s*\{/g;
  const removals: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let depth = 0; let j = m.index + m[0].length - 1;
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    functions.push(text.slice(m.index, j).trim());
    removals.push([m.index, j]);
    re.lastIndex = j;
  }
  let rest = ''; let idx = 0;
  for (const [s, e] of removals) { rest += text.slice(idx, s); idx = e; }
  rest += text.slice(idx);
  return { functions, rest };
}
export function parseDrl(text: string): DrlModel {
  const pkg = /^\s*package\s+([\w.]+)\s*;?/m.exec(text);
  const unit = /^\s*unit\s+([\w.]+)\s*;?/m.exec(text);
  const staticImports = [...text.matchAll(/^\s*import\s+static\s+([\w.*]+)\s*;?/mg)].map((m) => m[1]);
  const functionImports = [...text.matchAll(/^\s*import\s+function\s+([\w.*]+)\s*;?/mg)].map((m) => m[1]);
  const imports = [...text.matchAll(/^\s*import\s+(?!static\b)(?!function\b)([\w.*]+)\s*;?/mg)].map((m) => m[1]);
  const globals = [...text.matchAll(/^\s*global\s+(.+?)\s*;?\s*$/mg)].map((m) => m[1]);
  const rules: DrlRule[] = [];
  let work = text;
  work = work.replace(/rule\s+"([^"]+)"([\s\S]*?)\bwhen\b([\s\S]*?)\bthen\b([\s\S]*?)\bend\b/g,
    (_full, name: string, attrsRaw: string, when: string, then: string) => {
      const ext = /\bextends\s+"([^"]+)"/.exec(attrsRaw);
      const attributes = attrsRaw.replace(/\bextends\s+"[^"]+"/, '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      rules.push({ name, ...(ext ? { extends: ext[1] } : {}), attributes, when: when.trim(), then: then.trim() });
      return '';
    });
  const fx = extractFunctions(work); work = fx.rest;
  const declares: string[] = [];
  work = work.replace(/\bdeclare\b[\s\S]*?\bend\b/g, (mm) => { declares.push(mm.trim()); return ''; });
  const queries: string[] = [];
  work = work.replace(/\bquery\b[\s\S]*?\bend\b/g, (mm) => { queries.push(mm.trim()); return ''; });
  const model: DrlModel = { imports, globals, rules };
  if (pkg) model.package = pkg[1];
  if (unit) model.unit = unit[1];
  if (staticImports.length) model.staticImports = staticImports;
  if (functionImports.length) model.functionImports = functionImports;
  if (fx.functions.length) model.functions = fx.functions;
  if (declares.length) model.declares = declares;
  if (queries.length) model.queries = queries;
  return model;
}
export function writeDrl(m: DrlModel): string {
  const parts: string[] = [];
  if (m.package) parts.push(`package ${m.package};`);
  if (m.unit) parts.push(`unit ${m.unit};`);
  (m.imports || []).forEach((i) => parts.push(`import ${i};`));
  (m.staticImports || []).forEach((i) => parts.push(`import static ${i};`));
  (m.functionImports || []).forEach((i) => parts.push(`import function ${i};`));
  (m.globals || []).forEach((g) => parts.push(`global ${g};`));
  if (parts.length) parts.push('');
  (m.functions || []).forEach((f) => { parts.push(compileFunction(f)); parts.push(''); });
  (m.declares || []).forEach((d) => { parts.push(compileDeclare(d)); parts.push(''); });
  (m.queries || []).forEach((q) => { parts.push(compileQuery(q)); parts.push(''); });
  for (const r of m.rules) {
    parts.push(`rule "${r.name}"${r.extends ? ` extends "${r.extends}"` : ''}`);
    (r.meta || []).forEach((mm) => parts.push(`    ${mm}`));
    compileAttrs(r).forEach((a) => parts.push(`    ${a}`));
    parts.push('    when');
    parts.push(`        ${whenText(r.when)}`);
    parts.push('    then');
    parts.push(`        ${thenText(r.then)}`);
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
