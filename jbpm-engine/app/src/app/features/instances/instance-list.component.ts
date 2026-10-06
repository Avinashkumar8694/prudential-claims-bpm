import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { InstancesService } from '../../core/services/instances.service';
import { ToastService } from '../../core/services/toast.service';
import { StatusPillComponent } from '../../shared/status-pill.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import type { Instance, InstanceStatus } from '../../core/models/domain';

const STATUSES: InstanceStatus[] = ['running', 'waiting', 'suspended', 'completed', 'aborted', 'failed'];

@Component({
  selector: 'app-instance-list',
  standalone: true,
  imports: [CommonModule, RouterLink, StatusPillComponent, EmptyStateComponent],
  template: `
    <h1>Instances</h1>
    <p>Every process run across every deployment.</p>
    <div class="filters">
      <button class="chip" [class.active]="!filter()" (click)="setFilter(undefined)">All · {{ all().length }}</button>
      @for (s of statuses; track s) {
        <button class="chip" [class.active]="filter() === s" (click)="setFilter(s)">{{ s }}</button>
      }
    </div>
    @if (rows().length === 0) {
      <app-empty-state icon="◎" title="No instances yet" body="Start a deployment from a project to see it here." />
    } @else {
      <table>
        <thead><tr><th>Instance</th><th>Status</th><th>Started</th><th>Started by</th></tr></thead>
        <tbody>
          @for (i of rows(); track i.id) {
            <tr [routerLink]="['/instances', i.id]">
              <td class="mono">#{{ i.id.slice(-8) }}</td>
              <td><app-status-pill [status]="i.status" /></td>
              <td>{{ i.startedAt | date:'medium' }}</td>
              <td>{{ i.startedBy }}</td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
  styles: [`
    :host { display: block; padding: 28px 32px; }
    h1 { font-size: 22px; } p { color: var(--text-lo); font-size: 13.5px; margin: 4px 0 20px; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
    .chip { font-size: 12.5px; font-weight: 600; padding: 6px 13px; border-radius: 99px; border: 1px solid var(--border-soft); background: var(--bg-surface); color: var(--text-lo); cursor: pointer; text-transform: capitalize; }
    .chip.active { background: var(--bg-chip); color: var(--text-hi); border-color: var(--violet); }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-faint); padding: 0 12px 10px; }
    td { padding: 12px; font-size: 13px; border-top: 1px solid var(--border-soft); }
    tr[routerLink] { cursor: pointer; }
    tr[routerLink]:hover td { background: var(--bg-surface); }
    .mono { font-family: var(--font-mono); }
  `],
})
export class InstanceListComponent {
  private svc = inject(InstancesService);
  private toast = inject(ToastService);
  statuses = STATUSES;
  all = signal<Instance[]>([]);
  rows = signal<Instance[]>([]);
  filter = signal<InstanceStatus | undefined>(undefined);

  constructor() {
    this.svc.list().subscribe({
      next: (rows) => { this.all.set(rows); this.rows.set(rows); },
      error: (e) => this.toast.errorFrom(e, 'Could not load instances'),
    });
  }

  setFilter(s: InstanceStatus | undefined): void {
    this.filter.set(s);
    this.rows.set(s ? this.all().filter((i) => i.status === s) : this.all());
  }
}
