import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { InstancesService } from '../../core/services/instances.service';
import { TasksService } from '../../core/services/tasks.service';
import { WorkflowsService } from '../../core/services/workflows.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  template: `
    <h1>{{ greeting() }}, {{ auth.user()?.username }}</h1>
    <p>Here's what's happening across your projects.</p>
    <div class="grid">
      <a routerLink="/projects" class="tile accent-violet">
        <div class="num">{{ workflowCount() }}</div>
        <div class="label">Active workflows</div>
      </a>
      <a routerLink="/instances" class="tile accent-info">
        <div class="num">{{ runningCount() }}</div>
        <div class="label">Running instances</div>
      </a>
      <a routerLink="/tasks" class="tile accent-warn">
        <div class="num">{{ myTaskCount() }}</div>
        <div class="label">My open tasks</div>
      </a>
      <a routerLink="/instances" class="tile" [class.accent-bad]="failedCount() > 0" [class.accent-muted]="failedCount() === 0">
        <div class="num">{{ failedCount() }}</div>
        <div class="label">Failed instances</div>
      </a>
    </div>
  `,
  styles: [`
    :host { display: block; padding: 28px 32px; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    p { color: var(--text-lo); font-size: 13.5px; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
    .tile {
      position: relative; overflow: hidden;
      background: var(--bg-surface);
      border: 1px solid var(--border-soft); border-radius: var(--radius); padding: 20px;
      display: block; box-shadow: var(--shadow-card); transition: box-shadow .15s, border-color .15s;
    }
    .tile::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; }
    .tile.accent-violet::before { background: var(--grad-brand); }
    .tile.accent-info::before { background: var(--info); }
    .tile.accent-warn::before { background: var(--warn); }
    .tile.accent-bad::before { background: var(--bad); }
    .tile.accent-muted::before { background: var(--border-strong); }
    .tile:hover { border-color: var(--border-strong); box-shadow: var(--shadow-pop); }
    .num { font-size: 30px; font-weight: 800; font-family: var(--font-mono); }
    .label { color: var(--text-lo); font-size: 12.5px; margin-top: 4px; }
  `],
})
export class HomeComponent {
  auth = inject(AuthService);
  private instances = inject(InstancesService);
  private tasks = inject(TasksService);
  private workflows = inject(WorkflowsService);

  workflowCount = signal(0);
  runningCount = signal(0);
  failedCount = signal(0);
  myTaskCount = signal(0);

  constructor() {
    this.workflows.list().subscribe((rows) => this.workflowCount.set(rows.length));
    this.instances.list({ status: 'running' }).subscribe((rows) => this.runningCount.set(rows.length));
    this.instances.list({ status: 'failed' }).subscribe((rows) => this.failedCount.set(rows.length));
    this.tasks.list({ mine: true }).subscribe((rows) => this.myTaskCount.set(rows.filter((t) => t.status !== 'completed').length));
  }

  greeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }
}
