import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TasksService } from '../../core/services/tasks.service';
import { ToastService } from '../../core/services/toast.service';
import type { Task } from '../../core/models/domain';

@Component({
  selector: 'app-task-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    @if (task(); as t) {
      <div class="crumb"><a routerLink="/tasks">Tasks</a> / {{ t.name }}</div>
      <div class="header">
        <h1>{{ t.name }}</h1>
        <span class="pill" [class]="t.status">{{ t.status }}</span>
      </div>
      <p class="meta">
        @if (t.assignee) { Assigned to {{ t.assignee }} · }
        @if (t.group) { Group: {{ t.group }} · }
        Created {{ t.createdAt | date:'medium' }}
      </p>

      <div class="box">
        <h3>Inputs</h3>
        <pre class="json">{{ t.inputs | json }}</pre>
      </div>

      <div class="actions">
        @if (t.status === 'created') { <button class="btn primary" (click)="claim()">Claim</button> }
        @if (t.status === 'reserved') {
          <button class="btn" (click)="start()">Start</button>
          <button class="btn" (click)="release()">Release</button>
        }
        @if (t.status === 'reserved' || t.status === 'inprogress') {
          <button class="btn primary" (click)="complete()">Complete</button>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; padding: 20px 32px 32px; }
    .crumb { font-size: 12px; color: var(--text-faint); margin-bottom: 14px; }
    .crumb a { color: var(--text-lo); }
    .header { display: flex; align-items: center; gap: 10px; }
    h1 { font-size: 20px; }
    .pill { font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 99px; background: var(--bg-chip); text-transform: capitalize; }
    .meta { color: var(--text-lo); font-size: 12.5px; margin: 6px 0 20px; }
    .box { background: var(--bg-surface); border: 1px solid var(--border-soft); border-radius: var(--radius); padding: 16px; max-width: 640px; margin-bottom: 20px; }
    .box h3 { font-size: 12px; text-transform: uppercase; color: var(--text-faint); margin-bottom: 10px; }
    .json { font-family: var(--font-mono); font-size: 12px; margin: 0; }
    .actions { display: flex; gap: 8px; }
  `],
})
export class TaskDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private svc = inject(TasksService);
  private toast = inject(ToastService);

  task = signal<Task | undefined>(undefined);
  private id = this.route.snapshot.paramMap.get('id')!;

  constructor() { this.load(); }

  private load(): void {
    this.svc.get(this.id).subscribe({ next: (t) => this.task.set(t), error: (e) => this.toast.errorFrom(e) });
  }

  claim(): void { this.svc.claim(this.id).subscribe({ next: (t) => { this.task.set(t); this.toast.success('Claimed'); }, error: (e) => this.toast.errorFrom(e) }); }
  start(): void { this.svc.start(this.id).subscribe({ next: (t) => this.task.set(t), error: (e) => this.toast.errorFrom(e) }); }
  release(): void { this.svc.release(this.id).subscribe({ next: (t) => this.task.set(t), error: (e) => this.toast.errorFrom(e) }); }

  complete(): void {
    this.svc.complete(this.id, {}).subscribe({
      next: (inst) => { this.toast.success('Task completed'); this.router.navigate(['/instances', inst.id]); },
      error: (e) => this.toast.errorFrom(e, 'Could not complete task'),
    });
  }
}
