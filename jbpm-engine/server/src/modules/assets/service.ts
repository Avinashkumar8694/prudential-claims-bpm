// Project assets (shared across the project's processes): forms, DRL rules, DMN decisions, decision
// tables/trees, scorecards, enumerations, data types, messages, test scenarios. Stored in the head
// draft version.engine (an EngineProject); the SDK turns them into real jBPM assets on export and the
// runtime evaluators apply them. This module lists + adds minimal asset entries (full editors: Phase 8).
import type { AppContext } from '../../context.js';
import type { EngineProject } from '../../sdk/index.js';
import { WorkflowService } from '../workflows/service.js';
import { VersionService } from '../versions/service.js';
import { notFound, validation } from '../../infra/errors.js';

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export interface AssetKind { key: string; label: string; nameField: string; }
export const ASSET_KINDS: AssetKind[] = [
  { key: 'forms', label: 'Forms', nameField: 'name' },
  { key: 'rulesets', label: 'DRL rules', nameField: 'group' },
  { key: 'decisions', label: 'DMN decisions', nameField: 'name' },
  { key: 'guidedTables', label: 'Decision tables', nameField: 'name' },
  { key: 'decisionTrees', label: 'Decision trees', nameField: 'name' },
  { key: 'scorecards', label: 'Scorecards', nameField: 'name' },
  { key: 'enumerations', label: 'Enumerations', nameField: 'name' },
  { key: 'types', label: 'Data types', nameField: 'name' },
  { key: 'messages', label: 'Messages', nameField: 'name' },
  { key: 'tests', label: 'Test scenarios', nameField: 'name' },
];

const SEED: Record<string, (name: string) => any> = {
  forms: (name) => ({ id: slug(name), name, model: { className: '' }, fields: [] }),
  rulesets: (name) => ({ group: name, rules: [] }),
  decisions: (name) => ({ name, namespace: `https://kie.org/dmn/${slug(name)}`, decisions: [{ name, hitPolicy: 'UNIQUE', inputs: [], outputs: [], rules: [] }] }),
  guidedTables: (name) => ({ name, fact: '', conditions: [], actions: [], rows: [] }),
  decisionTrees: (name) => ({ name, fact: '', root: null }),
  scorecards: (name) => ({ name, fact: '', baseline: 0, target: 'score', characteristics: [] }),
  enumerations: (name) => ({ name, entries: {} }),
  types: (name) => ({ name, fields: [] }),
  messages: (name) => ({ name }),
  tests: (name) => ({ name, target: '', cases: [] }),
};

export class AssetsService {
  private wf: WorkflowService;
  private ver: VersionService;
  constructor(private ctx: AppContext) { this.wf = new WorkflowService(ctx); this.ver = new VersionService(ctx); }

  private async head(projectId: string): Promise<{ branchId: string; engine: EngineProject }> {
    const project = await this.wf.get(projectId);
    const versions = await this.ver.listByBranch(project.defaultBranchId);
    const head = versions.filter((v) => v.state === 'draft').at(-1) || versions.at(-1);
    if (!head) throw notFound('draft version');
    return { branchId: project.defaultBranchId, engine: head.engine };
  }

  async list(projectId: string): Promise<{ kinds: AssetKind[]; assets: Record<string, { name: string }[]> }> {
    const { engine } = await this.head(projectId);
    const assets: Record<string, { name: string }[]> = {};
    for (const k of ASSET_KINDS) {
      const arr = ((engine as any)[k.key] as any[]) || [];
      assets[k.key] = arr.map((a) => ({ name: a[k.nameField] || a.name || a.group || a.id || '(unnamed)' }));
    }
    return { kinds: ASSET_KINDS, assets };
  }

  async add(projectId: string, kind: string, name: string, actor: string): Promise<{ kind: string; name: string }> {
    const nm = (name || '').trim();
    if (!nm) throw validation('asset name is required');
    if (!SEED[kind]) throw validation(`unknown asset kind "${kind}"`);
    const { branchId, engine } = await this.head(projectId);
    const coll = ((engine as any)[kind] ||= []) as any[];
    const nameField = ASSET_KINDS.find((k) => k.key === kind)!.nameField;
    if (coll.some((a) => (a[nameField] || a.name) === nm)) throw validation(`asset "${nm}" already exists`);
    coll.push(SEED[kind](nm));
    await this.ver.saveDraft(branchId, engine, actor);
    await this.ctx.audit({ actor, kind: 'asset.added', workflowId: projectId, data: { kind, name: nm } });
    return { kind, name: nm };
  }
}
