import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { WorkflowsService } from '../../core/services/workflows.service';
import { FoldersService } from '../../core/services/folders.service';
import { ToastService } from '../../core/services/toast.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import type { Folder, Workflow } from '../../core/models/domain';

@Component({
  selector: 'app-project-list',
  standalone: true,
  imports: [FormsModule, RouterLink, EmptyStateComponent],
  template: `
    <div class="header">
      <div>
        <h1>Projects</h1>
        <p>Build, version, and deploy your workflow processes.</p>
      </div>
      <div class="actions">
        <input class="btn" style="background:var(--bg-void)" placeholder="New project name" [(ngModel)]="newName" (keyup.enter)="create()" />
        <button class="btn primary" (click)="create()" [disabled]="!newName.trim() || creating()">+ Create project</button>
      </div>
    </div>
    <div class="filters">
      <button class="chip" [class.active]="folderId() === undefined" (click)="selectFolder(undefined)">All projects · {{ workflows().length }}</button>
      @for (f of folders(); track f.id) {
        <button class="chip" [class.active]="folderId() === f.id" (click)="selectFolder(f.id)">{{ f.name }}</button>
      }
    </div>
    @if (visible().length === 0) {
      <app-empty-state icon="▦" title="Start your first project" body="Create a project to begin authoring a process." />
    } @else {
      <div class="grid">
        @for (wf of visible(); track wf.id) {
          <a class="card" [routerLink]="['/projects', wf.id]">
            <div class="cardname">{{ wf.name }}</div>
            <div class="cardkey">{{ wf.key }}</div>
          </a>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; padding: 28px 32px; }
    .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
    h1 { font-size: 22px; } p { color: var(--text-lo); font-size: 13.5px; margin-top: 4px; }
    .actions { display: flex; gap: 8px; }
    .actions input { border-radius: var(--radius-sm); border: 1px solid var(--border-soft); padding: 8px 12px; font-size: 13px; width: 220px; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
    .chip { font-size: 12.5px; font-weight: 600; padding: 6px 13px; border-radius: 99px; border: 1px solid var(--border-soft); background: var(--bg-surface); color: var(--text-lo); cursor: pointer; }
    .chip.active { background: var(--bg-chip); color: var(--text-hi); border-color: var(--violet); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
    .card { display: block; background: var(--bg-surface); border: 1px solid var(--border-soft); border-radius: var(--radius); padding: 18px; }
    .card:hover { border-color: var(--violet); }
    .cardname { font-weight: 700; font-size: 14px; margin-bottom: 4px; }
    .cardkey { font-family: var(--font-mono); font-size: 11.5px; color: var(--text-faint); }
  `],
})
export class ProjectListComponent {
  private workflowsSvc = inject(WorkflowsService);
  private foldersSvc = inject(FoldersService);
  private toast = inject(ToastService);
  private router = inject(Router);

  workflows = signal<Workflow[]>([]);
  folders = signal<Folder[]>([]);
  folderId = signal<string | undefined>(undefined);
  newName = '';
  creating = signal(false);

  visible = signal<Workflow[]>([]);

  constructor() {
    this.foldersSvc.list().subscribe({ next: (rows) => this.folders.set(rows), error: (e) => this.toast.errorFrom(e) });
    this.reload();
  }

  private reload(): void {
    this.workflowsSvc.list().subscribe({
      next: (rows) => { this.workflows.set(rows); this.applyFilter(); },
      error: (e) => this.toast.errorFrom(e, 'Could not load projects'),
    });
  }

  selectFolder(id: string | undefined): void {
    this.folderId.set(id);
    this.applyFilter();
  }

  private applyFilter(): void {
    const fid = this.folderId();
    this.visible.set(fid === undefined ? this.workflows() : this.workflows().filter((w) => w.folderId === fid));
  }

  create(): void {
    const name = this.newName.trim();
    if (!name) return;
    this.creating.set(true);
    this.workflowsSvc.create(name).subscribe({
      next: (wf) => { this.creating.set(false); this.newName = ''; this.toast.success('Project created'); this.router.navigate(['/projects', wf.id]); },
      error: (e) => { this.creating.set(false); this.toast.errorFrom(e, 'Could not create project'); },
    });
  }
}
