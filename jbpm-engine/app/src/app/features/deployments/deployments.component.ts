import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SlicePipe } from '@angular/common';
import { DeploymentApiService } from '../../core/api/deployment-api.service';
import { InstanceApiService } from '../../core/api/instance-api.service';
import { WorkflowApiService } from '../../core/api/workflow-api.service';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ToastService } from '../../shared/toast.service';
import type { Deployment, DeploymentProcessDef, Workflow } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';

// Top-level page (like Tasks) — a deployment is an immutable snapshot of one project's version, but
// browsing/managing deployments is a cross-project concern (jBPM's own Deploy view works the same way:
// one page for every deployment unit, not one nested under each project). Arriving from a project's
// header link with ?workflowId=X pre-filters to that project without being a different page.
@Component({
  selector: 'app-deployments',
  standalone: true,
  imports: [IconComponent, SlicePipe, RouterLink, FormsModule, BreadcrumbComponent],
  template: `
    <div class="page">
      <div class="crumbwrap"><app-breadcrumb [crumbs]="[{ label: 'Deployments' }]" /></div>
      <header class="pagehead">
        <h1>Deployments</h1>
        <span class="spacer"></span>
        <select class="proj-filter" [ngModel]="projectFilter()" (ngModelChange)="setProjectFilter($event)">
          <option value="">All projects</option>
          @for (w of workflows(); track w.id) { <option [value]="w.id">{{ w.name }}</option> }
        </select>
        <button class="btn" (click)="reload()"><app-icon name="refresh" [size]="14" /> Refresh</button>
      </header>

      @if (loading()) {
        <div class="split">
          <div class="card"><div class="skeleton skeleton-line" style="width:60%"></div><div class="skeleton skeleton-line" style="width:80%"></div><div class="skeleton skeleton-line" style="width:40%"></div></div>
          <div class="card"><div class="skeleton skeleton-card"></div></div>
        </div>
      } @else if (deployments().length === 0) {
        <div class="empty-state">
          <div class="es-icon"><app-icon name="deployments" [size]="24" /></div>
          <h3>No deployments yet</h3>
          <p>{{ projectFilter() ? 'This project has no deployments yet.' : "Publish a version and deploy it from a project's builder to see it here." }}</p>
        </div>
      } @else {
        <div class="split">
          <div class="list card">
            @for (grp of grouped(); track grp.env) {
              <div class="env-h">{{ grp.env }} <span class="count">{{ grp.items.length }}</span></div>
              <table>
                <tbody>
                  @for (d of grp.items; track d.id) {
                    <tr (click)="select(d)" [class.sel]="sel()?.id === d.id">
                      <td><span class="badge" [class.active]="d.status==='active'" [class.inactive]="d.status==='inactive'" [class.archived]="d.status==='archived'">{{ d.status }}</span></td>
                      <td><a [routerLink]="['/projects', d.workflowId]" (click)="$event.stopPropagation()">{{ projectName(d.workflowId) }}</a></td>
                      <td class="muted">{{ d.versionLabel || ('v' + (d.versionNumber ?? '?')) }}</td>
                      <td class="muted mono">{{ d.deployedAt | slice:0:10 }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>

          <!-- DETAIL -->
          @if (sel(); as d) {
            <div class="detail card">
              <div class="d-head">
                <div><a [routerLink]="['/projects', d.workflowId]">{{ projectName(d.workflowId) }}</a> · {{ d.environment }} · {{ d.versionLabel || ('v' + (d.versionNumber ?? '?')) }}
                  <span class="badge" [class.active]="d.status==='active'" [class.inactive]="d.status==='inactive'" [class.archived]="d.status==='archived'">{{ d.status }}</span></div>
                <span class="spacer"></span>
                @if (d.status !== 'active') { <button class="btn" (click)="activate(d)">Activate</button> }
                @if (d.status === 'active') { <button class="btn" (click)="undeploy(d)">Undeploy</button> }
                @if (d.status !== 'archived') { <button class="btn danger" (click)="archive(d)">Archive</button> }
              </div>

              <div class="tabbody">
                <table class="kv"><tbody>
                  <tr><td class="k">Deployed</td><td class="mono">{{ d.deployedAt | slice:0:19 }} by {{ d.deployedBy }}</td></tr>
                  <tr><td class="k">Tags</td><td>@for (t of d.tags; track t) { <span class="badge">{{ t }}</span> } @if (!d.tags.length) { <span class="muted">—</span> }</td></tr>
                </tbody></table>

                <h3 class="sec-h">Process definitions in this container</h3>
                @if (defsLoading()) {
                  <div class="skeleton skeleton-line" style="width:100%"></div>
                } @else if (defs().length === 0) {
                  <p class="muted pad">No process definitions found in this deployment.</p>
                } @else {
                  <table>
                    <thead><tr><th>Id</th><th>Name</th><th>Nodes</th><th></th></tr></thead>
                    <tbody>
                      @for (pd of defs(); track pd.id) {
                        <tr>
                          <td class="mono">{{ pd.id }}</td><td>{{ pd.name }}</td><td class="muted">{{ pd.nodes }}</td>
                          <td class="ta-r">
                            <!-- jBPM's "New Process Instance" — the definition list is where operators start
                                 work from, so "Startable: Yes" as dead text was a missing core action. -->
                            @if (pd.startable && d.status === 'active') {
                              <button class="btn sm primary" (click)="startInstance(d, pd)" title="Start a new instance of this process">
                                <app-icon name="play" [size]="12" /> Start
                              </button>
                            } @else {
                              <span class="muted sm">{{ pd.startable ? 'deployment inactive' : 'not startable' }}</span>
                            }
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                }

                <h3 class="sec-h">Rollback</h3>
                @if (rollbackTargets().length === 0) {
                  <p class="muted">No other deployment in "{{ d.environment }}" to roll back to.</p>
                } @else {
                  <div class="row">
                    <select #rb>
                      @for (t of rollbackTargets(); track t.id) { <option [value]="t.id">{{ t.versionLabel || ('v' + (t.versionNumber ?? '?')) }} · {{ t.deployedAt | slice:0:10 }}</option> }
                    </select>
                    <button class="btn" (click)="rollback(d, rb.value)">Rollback to selected</button>
                  </div>
                }
              </div>
            </div>
          } @else {
            <div class="detail card">
              <div class="empty-state">
                <div class="es-icon"><app-icon name="search" [size]="24" /></div>
                <h3>No deployment selected</h3>
                <p>Select a deployment on the left to see its process definitions and lifecycle actions.</p>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .ta-r { text-align: right; }
    .page { padding: 20px 24px; }
    .crumbwrap { margin-bottom: 8px; }
    .pagehead { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
    h1 { font-size: 19px; margin: 0; }
    .proj-filter { max-width: 200px; }
    .split { display: grid; grid-template-columns: minmax(360px, 480px) 1fr; gap: 16px; align-items: start; }
    .env-h { padding: 10px 14px; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); background: var(--surface-2); border-bottom: 1px solid var(--border); }
    .list tr { cursor: pointer; } .list tbody tr:hover { background: var(--surface-2); } .list tr.sel td { background: var(--primary-50); }
    .list td a { color: var(--primary); } .list td a:hover { text-decoration: underline; }
    .badge + .badge { margin-left: 4px; }
    .mono { font-family: var(--font-mono); font-size: 12px; }
    .d-head { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
    .d-head a { color: var(--primary); } .d-head a:hover { text-decoration: underline; }
    .tabbody { padding: 14px 16px; }
    .kv { width: 100%; margin-bottom: 18px; } .kv td { padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 13px; vertical-align: top; } .kv .k { color: var(--muted); width: 30%; }
    .sec-h { font-size: 13px; margin: 0 0 10px; }
    .pad { padding: 4px 0 16px; }
    .row { display: flex; gap: 8px; align-items: center; }
    select { border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; font-size: 13px; }
    .btn.danger { color: var(--red); border-color: var(--border-strong); } .btn.danger:hover { background: var(--red-bg); }
  `],
})
export class DeploymentsComponent {
  private api = inject(DeploymentApiService);
  private wfApi = inject(WorkflowApiService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private instApi = inject(InstanceApiService);
  private router = inject(Router);

  workflows = signal<Workflow[]>([]);
  deployments = signal<Deployment[]>([]);
  loading = signal(true);
  sel = signal<Deployment | null>(null);
  defs = signal<DeploymentProcessDef[]>([]);
  defsLoading = signal(false);
  projectFilter = signal<string>(this.route.snapshot.queryParamMap.get('workflowId') || '');

  private wfNames = computed(() => new Map(this.workflows().map((w) => [w.id, w.name])));
  projectName(id: string) { return this.wfNames().get(id) || id; }

  grouped = computed(() => {
    const byEnv = new Map<string, Deployment[]>();
    for (const d of this.deployments()) { (byEnv.get(d.environment) || byEnv.set(d.environment, []).get(d.environment)!).push(d); }
    return [...byEnv.entries()].map(([env, items]) => ({ env, items }));
  });
  rollbackTargets = computed(() => { const d = this.sel(); if (!d) return []; return this.deployments().filter((x) => x.environment === d.environment && x.workflowId === d.workflowId && x.id !== d.id); });

  constructor() {
    this.wfApi.listWorkflows().subscribe((ws) => this.workflows.set(ws));
    this.reload();
  }
  reload() {
    this.loading.set(true);
    this.api.listDeploymentsGlobal({ workflowId: this.projectFilter() || undefined }).subscribe((d) => { this.deployments.set(d); this.loading.set(false); });
  }
  setProjectFilter(id: string) { this.projectFilter.set(id); this.sel.set(null); this.reload(); }
  select(d: Deployment) { this.sel.set(d); this.defsLoading.set(true); this.api.definitions(d.id).subscribe((defs) => { this.defs.set(defs); this.defsLoading.set(false); }); }
  private refreshAfterAction(id: string) { this.reload(); this.api.getDeployment(id).subscribe((d) => this.select(d)); }
  private onActionError(e: any) { this.toast.error(e?.error?.error?.message || 'That action could not be completed'); }
  activate(d: Deployment) { this.api.activate(d.id).subscribe({ next: () => this.refreshAfterAction(d.id), error: (e) => this.onActionError(e) }); }
  undeploy(d: Deployment) { this.api.undeploy(d.id).subscribe({ next: () => this.refreshAfterAction(d.id), error: (e) => this.onActionError(e) }); }
  archive(d: Deployment) { this.api.archive(d.id).subscribe({ next: () => this.refreshAfterAction(d.id), error: (e) => this.onActionError(e) }); }
  /** jBPM's "New Process Instance": start from a deployed definition, then jump straight to the
   *  new instance's live diagram so the user sees it running rather than a silent toast. */
  startInstance(d: Deployment, pd: DeploymentProcessDef) {
    this.instApi.startInstance({ workflowId: d.workflowId, processId: pd.id, deploymentId: d.id }).subscribe({
      next: (inst) => {
        this.toast.success(`Instance started: \u2026${inst.id.slice(-7)}`);
        this.router.navigate(['/instances'], { queryParams: { id: inst.id } });
      },
      error: (e) => this.onActionError(e),
    });
  }
  rollback(d: Deployment, toDeploymentId: string) { if (!toDeploymentId) return; this.api.rollback(d.id, { environment: d.environment, toDeploymentId }).subscribe({ next: () => this.reload(), error: (e) => this.onActionError(e) }); }
}
