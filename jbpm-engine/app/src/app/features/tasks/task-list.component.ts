import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TasksService } from '../../core/services/tasks.service';
import { ToastService } from '../../core/services/toast.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import type { Task } from '../../core/models/domain';

@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [CommonModule, RouterLink, EmptyStateComponent],
  template: `
    <h1>Tasks</h1>
    <p>Work items waiting on a person.</p>
    <div class="filters">
      <button class="chip" [class.active]="mineOnly()" (click)="setMine(true)">My tasks</button>
      <button class="chip" [class.active]="!mineOnly()" (click)="setMine(false)">All tasks</button>
    </div>
    @if (rows().length === 0) {
      <app-empty-state icon="☑" title="No tasks" body="Nothing is waiting on anyone right now." />
    } @else {
      <table>
        <thead><tr><th>Task</th><th>Status</th><th>Assignee</th><th>Group</th><th>Created</th></tr></thead>
        <tbody>
          @for (t of rows(); track t.id) {
            <tr [routerLink]="['/tasks', t.id]">
              <td>{{ t.name }}</td>
              <td><span class="pill" [class]="t.status">{{ t.status }}</span></td>
              <td>{{ t.assignee || '—' }}</td>
              <td>{{ t.group || '—' }}</td>
              <td>{{ t.createdAt | date:'short' }}</td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
  styles: [`
    :host { display: block; padding: 28px 32px; }
    h1 { font-size: 22px; } p { color: var(--text-lo); font-size: 13.5px; margin: 4px 0 20px; }
    .filters { display: flex; gap: 8px; margin-bottom: 18px; }
    .chip { font-size: 12.5px; font-weight: 600; padding: 6px 13px; border-radius: 99px; border: 1px solid var(--border-soft); background: var(--bg-surface); color: var(--text-lo); cursor: pointer; }
    .chip.active { background: var(--bg-chip); color: var(--text-hi); border-color: var(--violet); }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; color: var(--text-faint); padding: 0 12px 10px; }
    td { padding: 11px 12px; font-size: 13px; border-top: 1px solid var(--border-soft); }
    tr[routerLink] { cursor: pointer; }
    tr[routerLink]:hover td { background: var(--bg-surface); }
    .pill { font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 99px; background: var(--bg-chip); text-transform: capitalize; }
    .pill.completed { color: var(--good); background: var(--good-bg); }
    .pill.reserved, .pill.inprogress { color: var(--info); background: var(--info-bg); }
  `],
})
export class TaskListComponent {
  private svc = inject(TasksService);
  private toast = inject(ToastService);
  rows = signal<Task[]>([]);
  mineOnly = signal(true);

  constructor() { this.reload(); }

  setMine(v: boolean): void { this.mineOnly.set(v); this.reload(); }

  private reload(): void {
    this.svc.list({ mine: this.mineOnly() }).subscribe({
      next: (rows) => this.rows.set(rows),
      error: (e) => this.toast.errorFrom(e, 'Could not load tasks'),
    });
  }
}
