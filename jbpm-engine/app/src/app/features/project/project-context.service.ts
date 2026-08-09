import { Injectable, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { WorkflowApiService } from '../../core/api/workflow-api.service';
import { DeploymentApiService } from '../../core/api/deployment-api.service';
import { ToastService } from '../../shared/toast.service';
import { ModalService } from '../../shared/modal.service';
import type { Workflow } from '../../core/models';

// Route-scoped (provided by ProjectShellComponent, one instance per project) — shared by every section
// page rendered in the shell's <router-outlet>, so switching sections doesn't re-fetch the project or
// lose in-progress edits. Lifted from the former single-page ProjectComponent; behavior unchanged.
@Injectable()
export class ProjectContextService {
  private api = inject(WorkflowApiService);
  private deploymentApi = inject(DeploymentApiService);
  private toast = inject(ToastService);
  private modal = inject(ModalService);
  private route = inject(ActivatedRoute);

  id = this.route.snapshot.paramMap.get('id')!;
  wf = signal<Workflow | null>(null);
  processes = signal<{ id: string; name: string; nodes: number; flows: number }[]>([]);
  assets = signal<Record<string, { name: string; usedBy: number }[]>>({});
  assetKinds = signal<{ key: string; label: string; nameField: string }[]>([]);
  vars = signal<{ name: string; type: string }[]>([]);
  name = ''; description = ''; baseUrl = '';

  constructor() {
    this.api.getWorkflow(this.id).subscribe((w) => {
      this.wf.set(w); this.name = w.name; this.description = w.description || '';
      this.vars.set([...(w.variables || [])]);
    });
    this.loadProcesses();
    this.loadAssets();
  }
  loadProcesses() { this.api.listProcesses(this.id).subscribe((p) => this.processes.set(p)); }
  loadAssets() { this.api.getAssets(this.id).subscribe((a) => { this.assets.set(a.assets); this.assetKinds.set(a.kinds); }); }

  saveName() { const w = this.wf(); if (w) this.api.updateWorkflow(w.id, { name: this.name, description: this.description }).subscribe((u) => this.wf.set(u)); }

  addProcess(name: string) { const n = name.trim(); if (!n) return; this.api.addProcess(this.id, n).subscribe(() => this.loadProcesses()); }
  async renameProcess(p: { id: string; name: string }) {
    const n = await this.modal.prompt({ title: 'Rename process', initialValue: p.name });
    if (n && n.trim()) this.api.renameProcess(this.id, p.id, n.trim()).subscribe(() => this.loadProcesses());
  }
  async removeProcess(p: { id: string; name: string }) {
    if (await this.modal.confirm({ title: 'Delete process', message: `Delete process "${p.name}"? This can't be undone.`, confirmLabel: 'Delete', danger: true })) {
      this.api.removeProcess(this.id, p.id).subscribe(() => this.loadProcesses());
    }
  }
  addVar() { this.vars.set([...this.vars(), { name: '', type: 'string' }]); }
  rmVar(i: number) { const v = [...this.vars()]; v.splice(i, 1); this.vars.set(v); }
  saveVars() { const w = this.wf(); if (w) this.api.updateWorkflow(w.id, { variables: this.vars().filter((v) => v.name.trim()) as any }).subscribe((u) => this.wf.set(u)); }

  addAsset(kind: string, name: string, fields?: Record<string, unknown>) {
    const n = name.trim(); if (!n) return;
    this.api.addAsset(this.id, kind, n, fields).subscribe({ next: () => this.loadAssets(), error: (e) => this.toast.error(e?.error?.error?.message || 'add failed') });
  }
  getAsset(kind: string, name: string) { return this.api.getAsset(this.id, kind, name); }
  updateAsset(kind: string, name: string, patch: Record<string, unknown>) { return this.api.updateAsset(this.id, kind, name, patch); }
  async removeAsset(kind: string, name: string, usedBy: number): Promise<void> {
    if (usedBy > 0) { this.toast.error(`"${name}" is referenced by ${usedBy} process node(s) — remove those references first`); return; }
    if (!(await this.modal.confirm({ title: 'Delete asset', message: `Delete "${name}"? This can't be undone.`, confirmLabel: 'Delete', danger: true }))) return;
    this.api.deleteAsset(this.id, kind, name).subscribe({
      next: () => { this.toast.success(`"${name}" deleted`); this.loadAssets(); },
      error: (e) => this.toast.error(e?.error?.error?.message || 'delete failed'),
    });
  }

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
  /** "Build" alone (jBPM's compile-without-deploy): publishes the head draft into an immutable
   *  version but doesn't push it to a runtime environment. */
  build() {
    const w = this.wf(); if (!w) return;
    this.api.listVersions(w.defaultBranchId).subscribe((vs) => {
      const head = vs.filter((v) => v.state === 'draft').at(-1);
      if (!head) { this.toast.error('Nothing to build — no draft changes since the last version.'); return; }
      this.api.publish(head.id, 'ui').subscribe({
        next: (p: any) => this.toast.success(`Built v${p.published.number}.`),
        error: (e) => this.toast.error('Cannot build: ' + (e?.error?.error?.message || 'validation failed') + '\n' + ((e?.error?.error?.details || []).map((d: any) => '• ' + d.message).join('\n'))),
      });
    });
  }
  deploy() {
    const w = this.wf(); if (!w) return;
    this.api.listVersions(w.defaultBranchId).subscribe((vs) => {
      const head = vs.filter((v) => v.state === 'draft').at(-1) || vs.at(-1);
      if (!head) return;
      this.api.publish(head.id, 'ui').subscribe({
        next: (p: any) => this.deploymentApi.deploy(p.published.id, { environment: 'prod', activate: true }).subscribe(() => this.toast.success(`Deployed project v${p.published.number} to prod (active).`)),
        error: (e) => this.toast.error('Cannot deploy: ' + (e?.error?.error?.message || 'validation failed') + '\n' + ((e?.error?.error?.details || []).map((d: any) => '• ' + d.message).join('\n'))),
      });
    });
  }
}
