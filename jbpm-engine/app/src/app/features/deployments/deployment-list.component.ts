import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DeploymentsService } from '../../core/services/deployments.service';
import { ToastService } from '../../core/services/toast.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import type { Deployment } from '../../core/models/domain';

@Component({
  selector: 'app-deployment-list',
  standalone: true,
  imports: [CommonModule, EmptyStateComponent],
  template: `
    <h1>Deployments</h1>
    <p>Every published version activated into an environment.</p>
    @if (rows().length === 0) {
      <app-empty-state icon="⇪" title="Nothing deployed yet" body="Publish a version and deploy it from a project to see it here." />
    } @else {
      <table>
        <thead><tr><th>Environment</th><th>Version</th><th>Status</th><th>Deployed</th><th></th></tr></thead>
        <tbody>
          @for (d of rows(); track d.id) {
            <tr>
              <td>{{ d.environment }}</td>
              <td class="mono">v{{ d.versionNumber }}</td>
              <td><span class="pill" [class]="d.status">{{ d.status }}</span></td>
              <td>{{ d.deployedAt | date:'medium' }}</td>
              <td>
                @if (d.status === 'active') { <button class="btn danger" (click)="undeploy(d)">Undeploy</button> }
              </td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
  styles: [`
    :host { display: block; padding: 28px 32px; }
    h1 { font-size: 22px; } p { color: var(--text-lo); font-size: 13.5px; margin: 4px 0 20px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; color: var(--text-faint); padding: 0 12px 10px; }
    td { padding: 11px 12px; font-size: 13px; border-top: 1px solid var(--border-soft); }
    .mono { font-family: var(--font-mono); }
    .pill { font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 99px; text-transform: capitalize; background: var(--bg-chip); }
    .pill.active { color: var(--good); background: var(--good-bg); }
    .pill.inactive { color: var(--text-lo); }
  `],
})
export class DeploymentListComponent {
  private svc = inject(DeploymentsService);
  private toast = inject(ToastService);
  rows = signal<Deployment[]>([]);

  constructor() { this.reload(); }

  private reload(): void {
    this.svc.list().subscribe({ next: (rows) => this.rows.set(rows), error: (e) => this.toast.errorFrom(e) });
  }

  undeploy(d: Deployment): void {
    this.svc.undeploy(d.id).subscribe({
      next: () => { this.toast.success('Undeployed'); this.reload(); },
      error: (e) => this.toast.errorFrom(e),
    });
  }
}
