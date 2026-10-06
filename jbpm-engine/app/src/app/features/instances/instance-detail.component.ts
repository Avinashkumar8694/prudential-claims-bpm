import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { InstancesService } from '../../core/services/instances.service';
import { TasksService } from '../../core/services/tasks.service';
import { ToastService } from '../../core/services/toast.service';
import { StatusPillComponent } from '../../shared/status-pill.component';
import type { Instance, Task } from '../../core/models/domain';

@Component({
  selector: 'app-instance-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, StatusPillComponent],
  template: `
    @if (instance(); as inst) {
      <div class="crumb"><a routerLink="/instances">Instances</a> / #{{ inst.id.slice(-8) }}</div>
      <div class="header">
        <div class="title">
          <h1>Instance #{{ inst.id.slice(-8) }}</h1>
          <app-status-pill [status]="inst.status" />
        </div>
        <div class="actions">
          <a class="btn primary" [routerLink]="['/instances', inst.id, 'diagram']">Open diagram →</a>
          @if (inst.status === 'running' || inst.status === 'waiting') {
            <button class="btn danger" (click)="abort()">Abort</button>
          }
          @if (inst.status === 'failed' && inst.error) {
            <button class="btn" (click)="retry(inst.error.nodeId)">Retry failed node</button>
          }
        </div>
      </div>
      <p class="meta">Started by {{ inst.startedBy }} · {{ inst.startedAt | date:'medium' }}</p>

      <div class="tabs">
        <button class="tab" [class.active]="tab() === 'details'" (click)="tab.set('details')">Details</button>
        <button class="tab" [class.active]="tab() === 'variables'" (click)="tab.set('variables')">Variables</button>
        <button class="tab" [class.active]="tab() === 'tasks'" (click)="tab.set('tasks')">Tasks ({{ tasks().length }})</button>
      </div>

      @if (tab() === 'details') {
        <div class="box">
          <div class="row"><span>Status</span><span><app-status-pill [status]="inst.status" /></span></div>
          <div class="row"><span>Deployment</span><span class="mono">{{ inst.deploymentId.slice(-8) }}</span></div>
          <div class="row"><span>Started</span><span>{{ inst.startedAt | date:'medium' }}</span></div>
          @if (inst.endedAt) { <div class="row"><span>Ended</span><span>{{ inst.endedAt | date:'medium' }}</span></div> }
          @if (inst.correlationKey) { <div class="row"><span>Correlation key</span><span class="mono">{{ inst.correlationKey }}</span></div> }
          @if (inst.error) { <div class="row err"><span>Error</span><span>{{ inst.error.message }} (at {{ inst.error.nodeId }})</span></div> }
        </div>
      } @else if (tab() === 'variables') {
        <pre class="json">{{ inst.variables | json }}</pre>
      } @else {
        @if (tasks().length === 0) {
          <p class="hint">No tasks on this instance.</p>
        } @else {
          <table>
            <thead><tr><th>Task</th><th>Status</th><th>Assignee</th></tr></thead>
            <tbody>
              @for (t of tasks(); track t.id) {
                <tr [routerLink]="['/tasks', t.id]">
                  <td>{{ t.name }}</td><td>{{ t.status }}</td><td>{{ t.assignee || '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      }
    }
  `,
  styles: [`
    :host { display: block; padding: 20px 32px 32px; }
    .crumb { font-size: 12px; color: var(--text-faint); margin-bottom: 14px; }
    .crumb a { color: var(--text-lo); }
    .header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
    .title { display: flex; align-items: center; gap: 10px; }
    h1 { font-size: 20px; }
    .actions { display: flex; gap: 8px; }
    .meta { color: var(--text-lo); font-size: 12.5px; margin: 6px 0 20px; }
    .tabs { display: flex; gap: 20px; border-bottom: 1px solid var(--border-soft); margin-bottom: 18px; }
    .tab { background: none; border: none; color: var(--text-lo); font-size: 13px; font-weight: 600; padding: 0 0 12px; cursor: pointer; border-bottom: 2px solid transparent; }
    .tab.active { color: var(--text-hi); border-color: var(--violet); }
    .box { background: var(--bg-surface); border: 1px solid var(--border-soft); border-radius: var(--radius); padding: 4px 16px; max-width: 640px; }
    .row { display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; font-size: 13px; border-bottom: 1px solid var(--border-soft); }
    .row:last-child { border-bottom: none; }
    .row span:first-child { color: var(--text-lo); flex: none; }
    .row.err span:last-child { color: var(--bad); text-align: right; }
    .mono { font-family: var(--font-mono); font-size: 12px; }
    .json { background: var(--bg-void); border: 1px solid var(--border-soft); border-radius: var(--radius); padding: 16px; font-family: var(--font-mono); font-size: 12px; max-width: 720px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; color: var(--text-faint); padding: 0 12px 10px; }
    td { padding: 10px 12px; font-size: 13px; border-top: 1px solid var(--border-soft); }
    tr[routerLink] { cursor: pointer; }
    tr[routerLink]:hover td { background: var(--bg-surface); }
    .hint { color: var(--text-lo); font-size: 13px; }
  `],
})
export class InstanceDetailComponent {
  private route = inject(ActivatedRoute);
  private svc = inject(InstancesService);
  private tasksSvc = inject(TasksService);
  private toast = inject(ToastService);

  instance = signal<Instance | undefined>(undefined);
  tasks = signal<Task[]>([]);
  tab = signal<'details' | 'variables' | 'tasks'>('details');
  private id = this.route.snapshot.paramMap.get('id')!;

  constructor() { this.load(); }

  private load(): void {
    this.svc.get(this.id).subscribe({
      next: (inst) => this.instance.set(inst),
      error: (e) => this.toast.errorFrom(e, 'Could not load instance'),
    });
    this.tasksSvc.list({ instanceId: this.id }).subscribe((rows) => this.tasks.set(rows));
  }

  abort(): void {
    this.svc.abort(this.id).subscribe({
      next: (inst) => { this.instance.set(inst); this.toast.success('Instance aborted'); },
      error: (e) => this.toast.errorFrom(e),
    });
  }

  retry(nodeId: string): void {
    this.svc.retryNode(this.id, nodeId).subscribe({
      next: (inst) => { this.instance.set(inst); this.toast.success('Retried'); },
      error: (e) => this.toast.errorFrom(e),
    });
  }
}
