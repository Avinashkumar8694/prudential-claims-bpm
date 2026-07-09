import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SlicePipe } from '@angular/common';
import { ApiService } from '../../core/api.service';
import type { Deployment } from '../../core/models';

@Component({
  selector: 'app-deployments',
  standalone: true,
  imports: [RouterLink, SlicePipe],
  template: `
    <div class="page">
      <header class="pagehead">
        <a class="btn ghost" [routerLink]="['/projects', wfId]">‹ Project</a>
        <h1>Deployments</h1>
      </header>

      @if (deployments().length === 0) { <p class="muted">No deployments yet. Publish a version and deploy it from the builder.</p> }
      @else {
        <table>
          <thead><tr><th>Environment</th><th>Tags</th><th>Version</th><th>Status</th><th>Deployed</th><th></th></tr></thead>
          <tbody>
            @for (d of deployments(); track d.id) {
              <tr>
                <td><b>{{ d.environment }}</b></td>
                <td>@for (t of d.tags; track t) { <span class="badge">{{ t }}</span> }</td>
                <td class="muted">{{ d.versionId }}</td>
                <td><span class="badge" [class.active]="d.status==='active'" [class.inactive]="d.status==='inactive'" [class.archived]="d.status==='archived'">{{ d.status }}</span></td>
                <td class="muted">{{ d.deployedAt | slice:0:10 }}</td>
                <td class="row">
                  @if (d.status !== 'active') { <button class="btn" (click)="activate(d)">Activate</button> }
                  @if (d.status === 'active') { <button class="btn" (click)="undeploy(d)">Undeploy</button> }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px 28px; }
    .pagehead { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
    h1 { font-size: 20px; margin: 0; }
    .badge + .badge { margin-left: 4px; }
  `],
})
export class DeploymentsComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  wfId = this.route.snapshot.paramMap.get('id')!;
  deployments = signal<Deployment[]>([]);

  constructor() { this.reload(); }
  reload() { this.api.listDeployments(this.wfId).subscribe((d) => this.deployments.set(d)); }
  activate(d: Deployment) { this.api.activate(d.id).subscribe(() => this.reload()); }
  undeploy(d: Deployment) { this.api.undeploy(d.id).subscribe(() => this.reload()); }
}
