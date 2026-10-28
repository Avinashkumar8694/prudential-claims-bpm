import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SlicePipe } from '@angular/common';
import { DeploymentApiService } from '../../core/api/deployment-api.service';
import { WorkflowApiService } from '../../core/api/workflow-api.service';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ToastService } from '../../shared/toast.service';
import type { Deployment, Workflow } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-deployments',
  standalone: true,
  imports: [IconComponent, SlicePipe, RouterLink, FormsModule, BreadcrumbComponent],
  template: `
    <div class="page">
      <div class="crumbwrap"><app-breadcrumb [crumbs]="[{ label: 'Deployments' }]" /></div>
      <header class="pagehead">
        <div>
          <h1>Deployments</h1>
          <p class="muted">Active runtime containers across environments. Click any deployment to view its frozen diagram snapshot, process definitions, and configuration.</p>
        </div>
        <span class="spacer"></span>
        <div class="header-actions">
          <select class="proj-filter" [ngModel]="projectFilter()" (ngModelChange)="setProjectFilter($event)">
            <option value="">All projects</option>
            @for (w of workflows(); track w.id) { <option [value]="w.id">{{ w.name }}</option> }
          </select>
          <button class="btn" (click)="openImportModal()"><app-icon name="upload" [size]="14" /> Import Deployment</button>
          <button class="btn" (click)="reload()"><app-icon name="refresh" [size]="14" /> Refresh</button>
        </div>
      </header>

      @if (loading()) {
        <div class="card pad">
          <div class="skeleton skeleton-line" style="width:40%"></div>
          <div class="skeleton skeleton-line" style="width:70%"></div>
          <div class="skeleton skeleton-card" style="height:200px; margin-top:16px;"></div>
        </div>
      } @else if (deployments().length === 0) {
        <div class="card empty-state">
          <div class="es-icon"><app-icon name="deployments" [size]="24" /></div>
          <h3>No deployments yet</h3>
          <p>{{ projectFilter() ? 'This project has no deployments yet.' : "Publish a version and deploy it from a project's builder to see it here." }}</p>
        </div>
      } @else {
        <!-- FULL-WIDTH DEPLOYMENTS LIST GROUPED BY ENVIRONMENT -->
        <div class="env-groups">
          @for (grp of grouped(); track grp.env) {
            <div class="card env-card">
              <div class="env-header">
                <div class="env-title">
                  <span class="env-tag">{{ grp.env }}</span>
                  <span class="env-count">{{ grp.items.length }} {{ grp.items.length === 1 ? 'container' : 'containers' }}</span>
                </div>
              </div>

              <div class="table-wrap">
                <table class="dep-table">
                  <thead>
                    <tr>
                      <th style="width:110px;">Status</th>
                      <th>Project</th>
                      <th style="width:130px;">Version</th>
                      <th style="width:170px;">Deployment ID</th>
                      <th style="width:110px;">Processes</th>
                      <th style="width:170px;">Deployed At</th>
                      <th style="width:140px;">Deployed By</th>
                      <th class="ta-r" style="width:180px;">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (d of grp.items; track d.id) {
                      <tr class="dep-row" (click)="openDeployment(d)">
                        <td>
                          <span class="badge" [class.active]="d.status==='active'" [class.inactive]="d.status==='inactive'" [class.archived]="d.status==='archived'">
                            {{ d.status }}
                          </span>
                        </td>
                        <td>
                          <div class="proj-name-wrap">
                            <span class="p-title">{{ projectName(d.workflowId) }}</span>
                            @if (d.snapshot?.frozen) {
                              <span class="freeze-tag" title="Frozen snapshot"><app-icon name="lock" [size]="10" /> Frozen</span>
                            }
                          </div>
                        </td>
                        <td>
                          <span class="ver-pill">{{ d.versionLabel || ('v' + (d.versionNumber ?? '?')) }}</span>
                        </td>
                        <td class="mono muted">
                          <code class="dep-id">{{ d.id }}</code>
                        </td>
                        <td>
                          <span class="proc-count-badge">
                            {{ (d.engine?.processes || []).length }}
                          </span>
                        </td>
                        <td class="muted">{{ d.deployedAt | slice:0:16 }}</td>
                        <td class="muted">{{ d.deployedBy }}</td>
                        <td class="ta-r actions-cell" (click)="$event.stopPropagation()">
                          <button class="btn sm" (click)="downloadSnapshot(d)" title="Download Snapshot JSON">
                            <app-icon name="download" [size]="12" />
                          </button>
                          <button class="btn sm primary" (click)="openDeployment(d)" title="Open Deployment Details">
                            <span>View</span>
                            <app-icon name="arrowRight" [size]="12" />
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          }
        </div>
      }

      <!-- MODAL: IMPORT DEPLOYMENT SNAPSHOT -->
      @if (showImportModal()) {
        <div class="modal-backdrop" (click)="closeImportModal()">
          <div class="modal-card" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h3><app-icon name="upload" [size]="16" /> Import Deployment Snapshot</h3>
              <button class="modal-close" (click)="closeImportModal()">×</button>
            </div>
            <div class="modal-body">
              <p class="modal-hint">Import a previously exported deployment snapshot package (.json). This will create an immutable deployment unit in the target environment.</p>

              <div class="form-group">
                <label>Target Environment</label>
                <select [(ngModel)]="importEnvironment">
                  <option value="dev">dev</option>
                  <option value="stage">stage</option>
                  <option value="prod">prod</option>
                  <option value="production">production</option>
                </select>
              </div>

              <div class="form-group">
                <label class="row" style="gap:8px; cursor:pointer;">
                  <input type="checkbox" [(ngModel)]="importActivate" />
                  <span>Activate immediately upon import</span>
                </label>
              </div>

              <div class="form-group">
                <label>Snapshot File (.json)</label>
                <input type="file" accept=".json,application/json" (change)="onFileSelected($event)" />
                @if (importFile(); as f) {
                  <div class="file-info mono sm">Selected: {{ f.name }} ({{ (f.size / 1024).toFixed(1) }} KB)</div>
                }
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn" (click)="closeImportModal()" [disabled]="importing()">Cancel</button>
              <button class="btn primary" (click)="submitImport()" [disabled]="!importFile() || importing()">
                {{ importing() ? 'Importing…' : 'Import Deployment' }}
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px; max-width: 1600px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
    .pagehead {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .pagehead h1 { margin: 0 0 4px 0; font-size: 24px; font-weight: 700; }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .proj-filter { min-width: 180px; }

    /* ENVIRONMENT GROUPS */
    .env-groups {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .env-card {
      padding: 0;
      overflow: hidden;
    }
    .env-header {
      padding: 14px 20px;
      background: var(--surface-soft, rgba(0,0,0,0.015));
      border-bottom: 1px solid var(--border);
    }
    .env-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .env-tag {
      font-size: 11.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .08em;
      padding: 3px 10px;
      border-radius: 999px;
      background: rgba(91, 61, 245, 0.12);
      color: var(--primary);
    }
    .env-count {
      font-size: 12.5px;
      color: var(--muted);
      font-weight: 500;
    }

    /* TABLE */
    .table-wrap { overflow-x: auto; }
    .dep-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .dep-table th {
      padding: 11px 16px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .05em;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
      text-align: left;
    }
    .dep-table td {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }
    .dep-row {
      cursor: pointer;
      transition: background .12s;
    }
    .dep-row:hover {
      background: var(--surface-hover);
    }
    .proj-name-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .p-title {
      font-size: 13.5px;
      font-weight: 600;
      color: var(--text);
    }
    .freeze-tag {
      font-size: 10.5px;
      font-weight: 600;
      color: #2563eb;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 999px;
      padding: 1px 7px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .ver-pill {
      font-size: 11.5px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 6px;
      background: var(--border);
      color: var(--text-secondary);
    }
    .dep-id {
      font-size: 12px;
      padding: 2px 6px;
      background: var(--surface-soft);
      border-radius: 4px;
    }
    .proc-count-badge {
      font-size: 11.5px;
      font-weight: 600;
      background: var(--border);
      color: var(--text-secondary);
      padding: 2px 8px;
      border-radius: 999px;
    }
    .actions-cell {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
    }
    .ta-r { text-align: right; }

    /* MODAL */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(4px);
      z-index: 1000;
      display: grid;
      place-items: center;
      padding: 20px;
    }
    .modal-card {
      width: 480px;
      max-width: 100%;
      background: var(--surface);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-pop);
      display: flex;
      flex-direction: column;
      border: 1px solid var(--border);
    }
    .modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .modal-header h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .modal-close {
      background: transparent;
      border: none;
      font-size: 20px;
      line-height: 1;
      color: var(--muted);
      cursor: pointer;
    }
    .modal-body {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .modal-hint {
      margin: 0;
      font-size: 13px;
      color: var(--muted);
      line-height: 1.45;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-group label {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--text-secondary);
    }
    .file-info {
      color: var(--primary);
      margin-top: 4px;
    }
    .modal-footer {
      padding: 14px 20px;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
  `],
})
export class DeploymentsComponent {
  private api = inject(DeploymentApiService);
  private wfApi = inject(WorkflowApiService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  workflows = signal<Workflow[]>([]);
  deployments = signal<Deployment[]>([]);
  loading = signal(true);
  projectFilter = signal<string>(this.route.snapshot.queryParamMap.get('workflowId') || '');

  // Import Modal State
  showImportModal = signal(false);
  importEnvironment = 'dev';
  importActivate = false;
  importFile = signal<File | null>(null);
  importing = signal(false);

  private wfNames = computed(() => new Map(this.workflows().map((w) => [w.id, w.name])));
  projectName(id: string) { return this.wfNames().get(id) || id; }

  grouped = computed(() => {
    const byEnv = new Map<string, Deployment[]>();
    for (const d of this.deployments()) {
      (byEnv.get(d.environment) || byEnv.set(d.environment, []).get(d.environment)!).push(d);
    }
    return [...byEnv.entries()].map(([env, items]) => ({ env, items }));
  });

  constructor() {
    this.wfApi.listWorkflows().subscribe((ws) => this.workflows.set(ws));
    const queryId = this.route.snapshot.queryParamMap.get('id');
    if (queryId) {
      this.router.navigate(['/deployments', queryId]);
      return;
    }
    this.reload();
  }

  reload() {
    this.loading.set(true);
    this.api.listDeploymentsGlobal({ workflowId: this.projectFilter() || undefined }).subscribe({
      next: (d) => {
        this.deployments.set(d);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Failed to load deployments');
      },
    });
  }

  setProjectFilter(id: string) {
    this.projectFilter.set(id);
    this.reload();
  }

  openDeployment(d: Deployment) {
    this.router.navigate(['/deployments', d.id]);
  }

  downloadSnapshot(d: Deployment) {
    this.api.exportSnapshot(d.id).subscribe({
      next: (pkg) => {
        const json = JSON.stringify(pkg, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const env = d.environment.toLowerCase();
        const ver = d.versionLabel || ('v' + (d.versionNumber ?? '1'));
        a.href = url;
        a.download = `deployment-snapshot-${d.id}-${env}-${ver}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.toast.success(`Deployment snapshot exported (${(blob.size / 1024).toFixed(1)} KB)`);
      },
      error: (e) => this.toast.error('Failed to export snapshot: ' + (e?.error?.message || e.message)),
    });
  }

  // --- Modal Import ---
  openImportModal() {
    this.importEnvironment = 'dev';
    this.importActivate = false;
    this.importFile.set(null);
    this.showImportModal.set(true);
  }

  closeImportModal() {
    if (!this.importing()) this.showImportModal.set(false);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.importFile.set(input.files[0]);
    }
  }

  submitImport() {
    const file = this.importFile();
    if (!file) return;

    this.importing.set(true);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const pkg = JSON.parse(reader.result as string);
        this.api.importSnapshot({
          snapshot: pkg.snapshot,
          engine: pkg.engine,
          environment: this.importEnvironment,
          activate: this.importActivate,
        }).subscribe({
          next: (dep) => {
            this.importing.set(false);
            this.showImportModal.set(false);
            this.toast.success(`Deployment imported into "${this.importEnvironment}"!`);
            this.openDeployment(dep);
          },
          error: (err) => {
            this.importing.set(false);
            this.toast.error('Import failed: ' + (err?.error?.message || err.message));
          },
        });
      } catch (err: any) {
        this.importing.set(false);
        this.toast.error('Invalid JSON file: ' + err.message);
      }
    };
    reader.onerror = () => {
      this.importing.set(false);
      this.toast.error('Could not read file');
    };
    reader.readAsText(file);
  }
}
