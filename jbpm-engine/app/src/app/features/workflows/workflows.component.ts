import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import type { Workflow } from '../../core/models';

@Component({
  selector: 'app-workflows',
  standalone: true,
  imports: [RouterLink, FormsModule],
  template: `
    <div class="page">
      <header class="pagehead">
        <h1>Projects</h1>
        <span class="spacer"></span>
        <div class="row">
          <input class="in" placeholder="New project name" [(ngModel)]="newName" (keyup.enter)="create()" />
          <button class="btn primary" (click)="create()">+ Create Project</button>
        </div>
      </header>

      @if (loading()) { <p class="muted">Loading…</p> }
      @else if (workflows().length === 0) { <p class="muted">No projects yet. Create your first one above.</p> }
      @else {
        <div class="grid">
          @for (w of workflows(); track w.id) {
            <a class="card wf" [routerLink]="['/projects', w.id]">
              <div class="wf-top">
                <span class="ic">⚡</span>
                <div>
                  <div class="wf-name">{{ w.name }}</div>
                  <div class="muted key">{{ w.key }}</div>
                </div>
              </div>
              <div class="wf-actions">
                <span class="btn">Open project →</span>
              </div>
            </a>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px 28px; }
    .pagehead { display: flex; align-items: center; margin-bottom: 20px; }
    h1 { font-size: 20px; margin: 0; }
    .in { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 6px 10px; font-size: 13px; width: 220px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
    .wf { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
    .wf-top { display: flex; gap: 12px; align-items: center; }
    .ic { width: 40px; height: 40px; display: grid; place-items: center; background: #f2f0ff; color: var(--primary); border-radius: 10px; font-size: 18px; }
    .wf-name { font-weight: 600; }
    .key { font-size: 12px; }
    .wf-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  `],
})
export class WorkflowsComponent {
  private api = inject(ApiService);
  workflows = signal<Workflow[]>([]);
  loading = signal(true);
  newName = '';

  constructor() { this.reload(); }

  reload() {
    this.loading.set(true);
    this.api.listWorkflows().subscribe({ next: (ws) => { this.workflows.set(ws); this.loading.set(false); }, error: () => this.loading.set(false) });
  }
  create() {
    const name = this.newName.trim();
    if (!name) return;
    this.api.createWorkflow({ name }).subscribe(() => { this.newName = ''; this.reload(); });
  }
}
