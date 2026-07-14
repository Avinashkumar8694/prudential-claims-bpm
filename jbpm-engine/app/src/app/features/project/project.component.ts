import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import type { Workflow } from '../../core/models';

type Tab = 'processes' | 'variables' | 'assets' | 'rules' | 'settings';

// Project workspace: a project groups many processes + shared variables + assets. Tabs configure each;
// opening a process launches the builder. Header deploys the whole project.
@Component({
  selector: 'app-project',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="proj">
      <header class="phead">
        <a class="icon-btn" routerLink="/projects" title="Projects">‹</a>
        <span class="pic">⚡</span>
        <div class="titles">
          <input class="pname" [(ngModel)]="name" (blur)="saveName()" />
          <span class="key">{{ wf()?.key }}</span>
        </div>
        <span class="spacer"></span>
        <a class="btn" [routerLink]="['/projects', id, 'instances']">Instances</a>
        <a class="btn" [routerLink]="['/projects', id, 'deployments']">Deployments</a>
        <button class="btn" (click)="exportKjar()" title="Export as a jBPM kjar (JSON file map)">↧ Export jBPM</button>
        <button class="btn primary" (click)="deploy()">Deploy project</button>
      </header>

      <nav class="tabs">
        @for (t of tabs; track t.key) {
          <button [class.active]="tab() === t.key" (click)="tab.set(t.key)">{{ t.label }}</button>
        }
      </nav>

      <div class="tabbody">
        @switch (tab()) {
          @case ('processes') {
            <div class="toolbar">
              <input class="in" placeholder="New process name" [(ngModel)]="newProc" (keyup.enter)="addProcess()" />
              <button class="btn primary" (click)="addProcess()">+ Add process</button>
            </div>
            @if (processes().length === 0) { <p class="muted">No processes. Add one to start modeling.</p> }
            <div class="grid">
              @for (p of processes(); track p.id) {
                <div class="card pcard">
                  <div class="pc-top"><span class="pc-ic">🧩</span>
                    <div><div class="pc-name">{{ p.name }}</div><div class="muted sm">{{ p.id }} · {{ p.nodes }} nodes</div></div>
                  </div>
                  <div class="pc-actions">
                    <a class="btn primary" [routerLink]="['/projects', id, 'process', p.id, 'builder']">Open builder</a>
                    <button class="btn" (click)="runProcess(p.id)">▷ Run</button>
                    <button class="btn" (click)="renameProcess(p)">Rename</button>
                    <button class="btn danger" (click)="removeProcess(p)">Delete</button>
                  </div>
                </div>
              }
            </div>
          }

          @case ('variables') {
            <p class="hint">Project-shared variables. (Each process also has its own variables, edited in the builder.)</p>
            @for (v of vars(); track $index) {
              <div class="vrow">
                <input placeholder="name" [(ngModel)]="v.name" />
                <select [(ngModel)]="v.type"><option>string</option><option>int</option><option>long</option><option>double</option><option>bool</option><option>date</option><option>object</option><option>list</option><option>map</option></select>
                <button class="x" (click)="rmVar($index)">✕</button>
              </div>
            }
            <div class="row">
              <button class="add" (click)="addVar()">+ add variable</button>
              <button class="btn primary" (click)="saveVars()">Save variables</button>
            </div>
          }

          @case ('assets') {
            <p class="hint">Assets are shared across the project's processes and become real jBPM assets on export. Nodes link to them by name.</p>
            @for (k of assetKinds(); track k.key) {
              <div class="akind">
                <div class="ak-h">{{ k.label }} <span class="count">{{ (assets()[k.key] || []).length }}</span></div>
                <div class="ak-body">
                  @for (a of assets()[k.key] || []; track a.name) { <span class="chip">{{ a.name }}</span> }
                  <div class="ak-add">
                    <input placeholder="new {{ k.label.toLowerCase() }} name" [(ngModel)]="addName[k.key]" (keyup.enter)="addAsset(k.key)" />
                    <button class="btn" (click)="addAsset(k.key)">+ Add</button>
                  </div>
                </div>
              </div>
            }
          }

          @case ('rules') {
            <p class="hint">Business rules (DRL) and decisions (DMN) used by Business Rule tasks.</p>
            <div class="akind"><div class="ak-h">DRL rules <span class="count">{{ (assets()['rulesets'] || []).length }}</span></div>
              <div class="ak-body">@for (a of assets()['rulesets'] || []; track a.name) { <span class="chip">{{ a.name }}</span> }
                <div class="ak-add"><input placeholder="ruleflow group" [(ngModel)]="addName['rulesets']" /><button class="btn" (click)="addAsset('rulesets')">+ Add</button></div></div>
            </div>
            <div class="akind"><div class="ak-h">DMN decisions <span class="count">{{ (assets()['decisions'] || []).length }}</span></div>
              <div class="ak-body">@for (a of assets()['decisions'] || []; track a.name) { <span class="chip">{{ a.name }}</span> }
                <div class="ak-add"><input placeholder="decision model name" [(ngModel)]="addName['decisions']" /><button class="btn" (click)="addAsset('decisions')">+ Add</button></div></div>
            </div>
          }

          @case ('settings') {
            <div class="setrow"><label>Key</label><input [value]="wf()?.key" disabled /></div>
            <div class="setrow"><label>Description</label><input [(ngModel)]="description" (blur)="saveName()" placeholder="What this project does" /></div>
            <div class="setrow"><label>Integration base URL</label><input [(ngModel)]="baseUrl" placeholder="http://localhost:3000" /><small>Applied per deployment environment for service tasks.</small></div>
            <p class="hint">Per-process cron/scheduled starts and environment overrides are planned (see docs/13).</p>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .proj { padding: 0; }
    .phead { display: flex; align-items: center; gap: 10px; padding: 14px 22px; background: var(--surface); border-bottom: 1px solid var(--border); }
    .icon-btn { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; border: 1px solid var(--border); background: #fff; color: var(--muted); }
    .pic { width: 34px; height: 34px; display: grid; place-items: center; background: #f2f0ff; color: var(--primary); border-radius: 9px; font-size: 17px; }
    .titles { display: flex; align-items: center; gap: 10px; }
    .pname { border: 1px solid transparent; border-radius: 8px; padding: 6px 8px; font-size: 17px; font-weight: 700; width: 240px; }
    .pname:hover { border-color: var(--border); } .pname:focus { border-color: var(--primary); outline: none; }
    .key { font-size: 11px; color: var(--muted); background: #eef0f6; padding: 3px 8px; border-radius: 999px; }
    .tabs { display: flex; gap: 4px; padding: 0 22px; background: var(--surface); border-bottom: 1px solid var(--border); }
    .tabs button { border: none; background: transparent; padding: 12px 14px; font-size: 13px; font-weight: 600; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; }
    .tabs button:hover { color: var(--text); } .tabs button.active { color: var(--primary); border-bottom-color: var(--primary); }
    .tabbody { padding: 22px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 16px; }
    .in { border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; font-size: 13px; width: 240px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
    .pcard { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
    .pc-top { display: flex; gap: 12px; align-items: center; }
    .pc-ic { width: 38px; height: 38px; display: grid; place-items: center; background: #eef7f0; border-radius: 10px; font-size: 17px; }
    .pc-name { font-weight: 600; } .sm { font-size: 11px; }
    .pc-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .hint { color: var(--muted); font-size: 13px; margin: 0 0 16px; }
    .vrow { display: flex; gap: 8px; margin-bottom: 8px; max-width: 520px; }
    .vrow input { flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; }
    .vrow select { flex: 0 0 120px; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; }
    .x { width: 32px; border: 1px solid var(--border); background: #fff; border-radius: 8px; cursor: pointer; color: var(--muted); }
    .add { border: 1px dashed var(--border); background: #fff; border-radius: 8px; padding: 7px 12px; font-size: 13px; cursor: pointer; color: var(--muted); }
    .akind { margin-bottom: 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); overflow: hidden; max-width: 720px; }
    .ak-h { padding: 10px 14px; font-weight: 600; font-size: 13px; border-bottom: 1px solid var(--border); background: #fafbfd; }
    .count { background: #eef0f6; color: var(--muted); border-radius: 999px; padding: 1px 8px; font-size: 11px; margin-left: 6px; }
    .ak-body { padding: 12px 14px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .chip { background: #f2f0ff; color: var(--primary); border-radius: 999px; padding: 4px 12px; font-size: 12px; }
    .ak-add { display: flex; gap: 6px; margin-left: auto; } .ak-add input { border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; font-size: 12px; }
    .setrow { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; max-width: 520px; }
    .setrow label { font-size: 12px; color: var(--muted); font-weight: 600; }
    .setrow input { border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
    .setrow small { color: var(--muted); font-size: 11px; }
    .row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
    .btn.danger { color: var(--red); border-color: #f3b4b4; } .btn.danger:hover { background: #fdeaea; }
  `],
})
export class ProjectComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  id = this.route.snapshot.paramMap.get('id')!;
  wf = signal<Workflow | null>(null);
  processes = signal<{ id: string; name: string; nodes: number; flows: number }[]>([]);
  assets = signal<Record<string, { name: string }[]>>({});
  assetKinds = signal<{ key: string; label: string }[]>([]);
  vars = signal<{ name: string; type: string }[]>([]);
  tab = signal<Tab>('processes');
  name = ''; description = ''; baseUrl = ''; newProc = '';
  addName: Record<string, string> = {};
  tabs: { key: Tab; label: string }[] = [
    { key: 'processes', label: 'Processes' }, { key: 'variables', label: 'Variables' },
    { key: 'assets', label: 'Assets' }, { key: 'rules', label: 'Rules' }, { key: 'settings', label: 'Settings' },
  ];

  constructor() {
    this.api.getWorkflow(this.id).subscribe((w) => { this.wf.set(w); this.name = w.name; this.description = w.description || ''; this.vars.set([...(w.variables || [])]); });
    this.loadProcesses();
    this.loadAssets();
  }
  loadProcesses() { this.api.listProcesses(this.id).subscribe((p) => this.processes.set(p)); }
  loadAssets() { this.api.getAssets(this.id).subscribe((a) => { this.assets.set(a.assets); this.assetKinds.set(a.kinds); }); }

  saveName() { const w = this.wf(); if (w) this.api.updateWorkflow(w.id, { name: this.name, description: this.description }).subscribe((u) => this.wf.set(u)); }

  addProcess() { const n = this.newProc.trim(); if (!n) return; this.api.addProcess(this.id, n).subscribe(() => { this.newProc = ''; this.loadProcesses(); }); }
  renameProcess(p: { id: string; name: string }) { const n = prompt('Rename process', p.name); if (n && n.trim()) this.api.renameProcess(this.id, p.id, n.trim()).subscribe(() => this.loadProcesses()); }
  removeProcess(p: { id: string; name: string }) { if (confirm(`Delete process "${p.name}"?`)) this.api.removeProcess(this.id, p.id).subscribe(() => this.loadProcesses()); }
  runProcess(pid: string) {
    this.api.startInstance({ workflowId: this.id, processId: pid, environment: 'prod' }).subscribe({
      next: (i) => { if (confirm(`Instance started (${i.status}). View instances?`)) this.router.navigate(['/projects', this.id, 'instances']); },
      error: (e) => alert('Cannot run: ' + (e?.error?.error?.message || 'deploy the project to prod first')),
    });
  }

  addVar() { this.vars.set([...this.vars(), { name: '', type: 'string' }]); }
  rmVar(i: number) { const v = [...this.vars()]; v.splice(i, 1); this.vars.set(v); }
  saveVars() { const w = this.wf(); if (w) this.api.updateWorkflow(w.id, { variables: this.vars().filter((v) => v.name.trim()) as any }).subscribe((u) => this.wf.set(u)); }

  addAsset(kind: string) { const n = (this.addName[kind] || '').trim(); if (!n) return; this.api.addAsset(this.id, kind, n).subscribe({ next: () => { this.addName[kind] = ''; this.loadAssets(); }, error: (e) => alert(e?.error?.error?.message || 'add failed') }); }

  exportKjar() {
    const w = this.wf(); if (!w) return;
    this.api.listVersions(w.defaultBranchId).subscribe((vs) => {
      const head = vs.at(-1); if (!head) return;
      this.api.exportVersion(head.id).subscribe((kjar) => {
        const blob = new Blob([JSON.stringify(kjar, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${w.key}-kjar.json`; a.click(); URL.revokeObjectURL(a.href);
      });
    });
  }
  deploy() {
    const w = this.wf(); if (!w) return;
    this.api.listVersions(w.defaultBranchId).subscribe((vs) => {
      const head = vs.filter((v) => v.state === 'draft').at(-1) || vs.at(-1);
      if (!head) return;
      this.api.publish(head.id, 'ui').subscribe({
        next: (p: any) => this.api.deploy(p.published.id, { environment: 'prod', activate: true }).subscribe(() => alert(`Deployed project v${p.published.number} to prod (active).`)),
        error: (e) => alert('Cannot deploy: ' + (e?.error?.error?.message || 'validation failed') + '\n' + ((e?.error?.error?.details || []).map((d: any) => '• ' + d.message).join('\n'))),
      });
    });
  }
}
