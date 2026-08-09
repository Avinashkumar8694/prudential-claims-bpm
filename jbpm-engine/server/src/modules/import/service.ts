// Import a jBPM (kjar) project — a { relativePath -> content } file map (as produced by export) — back
// into an engine project, then create a new project + draft version from it. Uses the SDK reader.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseProject, toEngineProject, dmnToDecisionModel, type EngineProject,
  type Asset, type EngineForm, type FormField, type EngineRuleset, type DrlModel, type EngineDecisionModel,
} from '../../sdk/index.ts';
import type { AppContext } from '../../context.ts';
import { WorkflowService } from '../workflows/service.ts';
import { VersionService } from '../versions/service.ts';
import { DeploymentService } from '../deployments/service.ts';
import { validation } from '../../infra/errors.ts';

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export interface AssetImportReport {
  formsImported: string[];
  rulesetPlaceholders: { group: string; ruleNames: string[] }[];
  decisionsImported: string[];
  skipped: { path: string; kind: string; reason: string }[];
}

// Real jBPM Designer names a task form "<FormName>-taskform.form" and the userTask's own `form`
// field (see toEngine's userTask conversion) already holds exactly that stripped <FormName> — matching
// on the FILENAME this way (not the form XML's own internal <property name="name"> metadata, which is
// unrelated legacy authoring-tool bookkeeping, not what the process actually references) is what makes
// an imported form resolve against the process's existing references with zero manual relinking.
const formNameFromPath = (p: string): string => path.basename(p).replace(/-taskform\.form$|\.form$/i, '');

const FIELD_WIDGET: Record<string, FormField['widget']> = {
  InputText: 'text', InputTextArea: 'textarea', InputInteger: 'integer', InputDecimal: 'decimal',
  InputNumber: 'number', CheckBox: 'checkbox', DropDownList: 'dropdown', RadioGroup: 'radio', InputDate: 'date',
};

/** Real .form XML: a <form> with <field type="InputText" name="..."> children, each carrying its
 *  process-variable binding as a nested <property name="outputBinding"|"inputBinding" value="...">
 *  (see a real sample's exact shape — e.g. jbpm-playground's evaluation-taskform.form). Best-effort:
 *  field TYPE -> widget is a cosmetic mapping (defaults to 'text' for anything unrecognized); the bind
 *  name is what actually matters for the form to work, and that's a direct, lossless extraction. */
function formFieldsFromXml(root: any): FormField[] {
  const fields: FormField[] = [];
  for (const el of root?.children || []) {
    if (el.name !== 'field') continue;
    const props: Record<string, string> = {};
    for (const p of el.children || []) if (p.name === 'property') props[p.attrs?.name] = p.attrs?.value;
    const bind = props.outputBinding || props.inputBinding || el.attrs?.name;
    if (!bind) continue;
    fields.push({
      bind, label: props.label || bind, widget: FIELD_WIDGET[el.attrs?.type] || 'text',
      required: props.fieldRequired === 'true', readOnly: props.readonly === 'true',
      placeholder: props.placeholder || undefined,
    });
  }
  return fields;
}

// A real DRL rule's `when`/`then` can hold arbitrary imperative code (raw Java/MVEL statements,
// System.out.println, direct WorkingMemory calls like update()/insert() with real dialects) that this
// engine's own visual rule builder (EngineRuleDef: fact/where/set/insert only) has no way to represent
// — there is no raw-DRL escape hatch in that schema (see asset-fields.component.ts's rulesets editor).
// Auto-translating anyway would silently fabricate WRONG rule semantics, which is worse than not
// converting at all. So: create the ruleset placeholder (rules: []) so the ruleflowGroup reference
// resolves and validation doesn't dangle, and report exactly which named rules still need manual
// reconstruction — honest partial import beats either silent data loss or a silently wrong rule.
function rulesetGroupsFromDrl(drl: DrlModel, fallbackGroup: string): { group: string; ruleNames: string[] }[] {
  const byGroup = new Map<string, string[]>();
  for (const r of drl.rules || []) {
    const group = r.attrs?.ruleflowGroup || fallbackGroup;
    (byGroup.get(group) || byGroup.set(group, []).get(group)!).push(r.name);
  }
  return [...byGroup.entries()].map(([group, ruleNames]) => ({ group, ruleNames }));
}

/** Best-effort convert every recognized non-process kjar asset (SDK's `engine.assets`, from
 *  toEngineProject's structured parse) into this engine's own first-class forms/rulesets collections
 *  — mutates `engine` in place. Without this, everything but the .bpmn2 process itself (task forms,
 *  DRL rules, work-item definitions, ...) was silently dropped on import: parsed correctly by the SDK,
 *  then never looked at again (see the audit that flagged this against real jbpm-playground examples). */
export function convertAssets(engine: EngineProject): AssetImportReport {
  const report: AssetImportReport = { formsImported: [], rulesetPlaceholders: [], decisionsImported: [], skipped: [] };
  const assets = (engine as any).assets as Record<string, Asset | string> | undefined;
  if (!assets) return report;
  const forms: EngineForm[] = ((engine as any).forms ||= []);
  const rulesets: EngineRuleset[] = ((engine as any).rulesets ||= []);
  const decisions: EngineDecisionModel[] = ((engine as any).decisions ||= []);
  const existingFormNames = new Set(forms.map((f) => f.name));
  const existingRulesetGroups = new Set(rulesets.map((r) => r.group));
  const existingDecisionNames = new Set(decisions.map((d) => d.name));

  for (const [assetPath, val] of Object.entries(assets)) {
    if (typeof val === 'string') { report.skipped.push({ path: assetPath, kind: 'text', reason: 'unrecognized file type' }); continue; }
    const { kind, model } = val;
    if (kind === 'form') {
      const name = formNameFromPath(assetPath);
      if (existingFormNames.has(name)) { report.skipped.push({ path: assetPath, kind, reason: `form "${name}" already imported` }); continue; }
      forms.push({ id: slug(name), name, model: { className: '' }, fields: formFieldsFromXml((model as any).xml) } as EngineForm);
      existingFormNames.add(name);
      report.formsImported.push(name);
    } else if (kind === 'drl') {
      const fallbackGroup = path.basename(assetPath).replace(/\.(rdrl|rdslr|drl)$/i, '');
      for (const g of rulesetGroupsFromDrl(model as DrlModel, fallbackGroup)) {
        if (existingRulesetGroups.has(g.group)) continue;
        rulesets.push({ group: g.group, package: (model as DrlModel).package, rules: [] } as EngineRuleset);
        existingRulesetGroups.add(g.group);
        report.rulesetPlaceholders.push(g);
      }
    } else if (kind === 'dmn') {
      // Only decisionTable-driven decisions come back (see dmnToDecisionModel's own doc comment) — a
      // DMN file built entirely from literalExpression/businessKnowledgeModel (a real FEEL conditional
      // or a Java-backed function, both common in real-world DMN) has nothing recoverable this way and
      // is reported skipped rather than silently ignored or, worse, guessed at.
      const parsed = dmnToDecisionModel((model as any).xml);
      if (!parsed) { report.skipped.push({ path: assetPath, kind, reason: 'no decisionTable-driven decision found (literalExpression/businessKnowledgeModel-only DMN isn\'t evaluated by this engine)' }); continue; }
      if (existingDecisionNames.has(parsed.name)) { report.skipped.push({ path: assetPath, kind, reason: `decision model "${parsed.name}" already imported` }); continue; }
      decisions.push(parsed);
      existingDecisionNames.add(parsed.name);
      report.decisionsImported.push(parsed.name);
    } else {
      report.skipped.push({
        path: assetPath, kind,
        reason: kind === 'workItemDefinition'
          ? 'custom work-item definitions have no equivalent asset kind yet — recreate the service task manually'
          : 'no automatic conversion for this asset kind',
      });
    }
  }
  return report;
}

/** Reconstruct an EngineProject from a kjar file map (writes to a temp dir, parses, converts). */
export function kjarToEngine(files: Record<string, string>): EngineProject {
  if (!files || !Object.keys(files).length) throw validation('no files to import');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kjar-in-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const p = path.join(dir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    }
    return toEngineProject(parseProject(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export class ImportService {
  constructor(private ctx: AppContext) {}
  /** Import a kjar file map as a new project (workflow) + initial draft. */
  async importKjar(files: Record<string, string>, name: string | undefined, actor: string): Promise<{ workflowId: string; processes: number } & AssetImportReport> {
    const engine = kjarToEngine(files);
    const assetReport = convertAssets(engine);
    const wf = await new WorkflowService(this.ctx).create({ name: name || (engine as any).name || (engine as any).id || 'Imported project' }, actor);
    await new VersionService(this.ctx).saveDraft(wf.defaultBranchId, engine, actor);
    await this.ctx.audit({ actor, kind: 'project.imported', workflowId: wf.id, data: { processes: engine.processes?.length || 0, ...assetReport } });
    return { workflowId: wf.id, processes: engine.processes?.length || 0, ...assetReport };
  }

  /** Import a kjar straight to a running deployment in one step — no manual Publish/Deploy detour
   *  through the project first. Mirrors jBPM's own "deploy this artifact" ops flow: the import still
   *  creates a normal project + draft (so it's editable afterwards like any other), but also publishes
   *  and deploys that exact draft immediately. Deploying edits a NEW version, same as the UI's own
   *  Publish+Deploy buttons — this never mutates an already-active deployment in place, since that
   *  would desync it from whatever instances are already running against it. */
  async importAndDeploy(
    files: Record<string, string>, name: string | undefined, actor: string,
    opts: { environment: string; tags?: string[]; env?: Record<string, string> },
  ): Promise<{ workflowId: string; processes: number; deploymentId: string } & AssetImportReport> {
    const engine = kjarToEngine(files);
    const assetReport = convertAssets(engine);
    const wf = await new WorkflowService(this.ctx).create({ name: name || (engine as any).name || (engine as any).id || 'Imported project' }, actor);
    const ver = new VersionService(this.ctx);
    const draft = await ver.saveDraft(wf.defaultBranchId, engine, actor);
    const { published } = await ver.publish(draft.id, actor, 'v1');
    const dep = await new DeploymentService(this.ctx).deploy(published.id, { environment: opts.environment, tags: opts.tags, env: opts.env, activate: true }, actor);
    await this.ctx.audit({ actor, kind: 'project.imported', workflowId: wf.id, data: { processes: engine.processes?.length || 0, deployed: true, deploymentId: dep.id, ...assetReport } });
    return { workflowId: wf.id, processes: engine.processes?.length || 0, deploymentId: dep.id, ...assetReport };
  }
}
