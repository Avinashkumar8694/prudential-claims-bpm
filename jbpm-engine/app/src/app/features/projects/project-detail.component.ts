import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { WorkflowsService } from '../../core/services/workflows.service';
import { BranchesService } from '../../core/services/branches.service';
import { VersionsService } from '../../core/services/versions.service';
import { DeploymentsService } from '../../core/services/deployments.service';
import { ToastService } from '../../core/services/toast.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import type { Branch, Deployment, Version, Workflow } from '../../core/models/domain';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [FormsModule, RouterLink, EmptyStateComponent],
  template: `
    @if (workflow(); as wf) {
      <div class="crumb"><a routerLink="/projects">Projects</a> / {{ wf.name }}</div>
      <div class="header">
        <div class="title">
          <span class="mark">⚡</span>
          <div><div class="name">{{ wf.name }}</div><div class="key">{{ wf.key }}</div></div>
        </div>
        <div class="actions">
          <a class="btn" [routerLink]="[]" (click)="showDeployments = !showDeployments">Deployments ({{ deployments().length }})</a>
        </div>
      </div>
      <div class="tabs">
        <button class="tab" [class.active]="tab() === 'processes'" (click)="tab.set('processes')">Processes</button>
        <button class="tab" [class.active]="tab() === 'settings'" (click)="tab.set('settings')">Settings</button>
      </div>

      @if (tab() === 'processes') {
        <p class="hint">Processes are the workflows this project runs. Open one to model it on the canvas, then Validate, Build and Deploy from there.</p>
        <div class="newproc">
          <input placeholder="New process name" [(ngModel)]="newProcName" (keyup.enter)="addProcess()" />
          <button class="btn primary" (click)="addProcess()" [disabled]="!newProcName.trim() || !draft()">+ Add process</button>
        </div>
        @if (!draft()) {
          <app-empty-state icon="⚠" title="No editable draft" body="This branch has no draft version to add processes to." />
        } @else if (!draft()!.engine || draft()!.engine!.processes.length === 0) {
          <app-empty-state icon="◇" title="No processes yet" body="Add one above to start modeling." />
        } @else {
          <div class="grid">
            @for (p of draft()!.engine!.processes; track p.id) {
              <a class="card" (click)="openBuilder(p.id)">
                <div class="cardname">{{ p.name || p.id }}</div>
                <div class="cardmeta">{{ p.nodes.length }} nodes</div>
              </a>
            }
          </div>
        }
      } @else {
        <div class="settingsbox">
          <div class="row"><span>Default branch</span><span>{{ defaultBranch()?.name }}</span></div>
          <div class="row"><span>Draft version</span><span>#{{ draft()?.number }}</span></div>
        </div>
      }
    } @else {
      <p class="hint">Loading…</p>
    }
  `,
  styles: [`
    :host { display: block; padding: 20px 32px 32px; }
    .crumb { font-size: 12px; color: var(--text-faint); margin-bottom: 14px; }
    .crumb a { color: var(--text-lo); }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
    .title { display: flex; align-items: center; gap: 12px; }
    .mark { width: 34px; height: 34px; border-radius: 10px; background: var(--grad-brand); display: flex; align-items: center; justify-content: center; }
    .name { font-weight: 700; font-size: 15px; }
    .key { font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); }
    .tabs { display: flex; gap: 20px; border-bottom: 1px solid var(--border-soft); margin-bottom: 18px; }
    .tab { background: none; border: none; color: var(--text-lo); font-size: 13px; font-weight: 600; padding: 0 0 12px; cursor: pointer; border-bottom: 2px solid transparent; }
    .tab.active { color: var(--text-hi); border-color: var(--violet); }
    .hint { color: var(--text-lo); font-size: 13px; margin-bottom: 16px; max-width: 60ch; }
    .newproc { display: flex; gap: 8px; margin-bottom: 20px; }
    .newproc input { border-radius: var(--radius-sm); border: 1px solid var(--border-soft); background: var(--bg-void); padding: 8px 12px; font-size: 13px; width: 260px; color: var(--text-hi); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
    .card { display: block; background: var(--bg-surface); border: 1px solid var(--border-soft); border-radius: var(--radius); padding: 16px; cursor: pointer; }
    .card:hover { border-color: var(--violet); }
    .cardname { font-weight: 700; font-size: 13.5px; }
    .cardmeta { font-size: 11.5px; color: var(--text-faint); margin-top: 4px; }
    .settingsbox { background: var(--bg-surface); border: 1px solid var(--border-soft); border-radius: var(--radius); padding: 4px 16px; max-width: 480px; }
    .row { display: flex; justify-content: space-between; padding: 12px 0; font-size: 13px; border-bottom: 1px solid var(--border-soft); }
    .row:last-child { border-bottom: none; }
    .row span:first-child { color: var(--text-lo); }
  `],
})
export class ProjectDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private workflowsSvc = inject(WorkflowsService);
  private branchesSvc = inject(BranchesService);
  private versionsSvc = inject(VersionsService);
  private deploymentsSvc = inject(DeploymentsService);
  private toast = inject(ToastService);

  workflow = signal<Workflow | undefined>(undefined);
  defaultBranch = signal<Branch | undefined>(undefined);
  draft = signal<Version | undefined>(undefined);
  deployments = signal<Deployment[]>([]);
  tab = signal<'processes' | 'settings'>('processes');
  newProcName = '';
  showDeployments = false;

  constructor() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.workflowsSvc.get(id).subscribe({
      next: (wf) => {
        this.workflow.set(wf);
        this.deploymentsSvc.list({ workflowId: wf.id }).subscribe((rows) => this.deployments.set(rows));
        this.branchesSvc.get(wf.defaultBranchId).subscribe({
          next: (branch) => {
            this.defaultBranch.set(branch);
            this.versionsSvc.list(branch.id).subscribe((versions) => {
              this.draft.set(versions.find((v) => v.state === 'draft'));
            });
          },
          error: (e) => this.toast.errorFrom(e),
        });
      },
      error: (e) => this.toast.errorFrom(e, 'Could not load project'),
    });
  }

  addProcess(): void {
    const name = this.newProcName.trim();
    const d = this.draft();
    if (!name || !d) return;
    const engine = d.engine ?? { id: 'e1', name: 'Engine', processes: [] };
    const id = `p_${Date.now().toString(36)}`;
    const startId = `${id}_start`;
    engine.processes = [...engine.processes, { id, name, nodes: [{ id: startId, type: 'start', x: 80, y: 200 }], flows: [] }];
    this.versionsSvc.saveDraft(d.id, engine).subscribe({
      next: (updated) => { this.draft.set(updated); this.newProcName = ''; this.openBuilder(id); },
      error: (e) => this.toast.errorFrom(e, 'Could not add process'),
    });
  }

  openBuilder(processId: string): void {
    const wf = this.workflow(), d = this.draft();
    if (!wf || !d) return;
    this.router.navigate(['/projects', wf.id, 'processes', d.id, processId]);
  }
}
