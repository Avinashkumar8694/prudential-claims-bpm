import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ProjectContextService } from './project-context.service';
import { IconComponent } from '../../shared/icon.component';

// Processes tab: a list only, same shape as the Assets tab — no canvas here. The canvas needs real
// width to be usable (a palette + a diagram), so it gets its own routed page (processes/:pid, see
// project-process-canvas-page.component.ts) that the project shell renders full-width, instead of
// permanently reserving a sidebar + toolbar next to a canvas squeezed into whatever's left.
@Component({
  selector: 'app-project-processes',
  standalone: true,
  imports: [IconComponent, FormsModule, RouterLink],
  template: `
    <p class="hint">Processes are the workflows this project runs. Open one to model it on the canvas, then Validate, Build and Deploy from there.</p>

    <div class="toolbar">
      <input class="in" placeholder="New process name" [(ngModel)]="newProc" (keyup.enter)="add()" />
      <button class="btn primary" (click)="add()"><app-icon name="plus" [size]="13" /> Add process</button>
    </div>

    @if (ctx.processes().length === 0) {
      <div class="card empty-state">
        <div class="es-icon"><app-icon name="puzzle" [size]="22" /></div>
        <h3>No processes yet</h3>
        <p>Add one above to start modeling.</p>
      </div>
    } @else {
      <div class="grid">
        @for (p of ctx.processes(); track p.id) {
          <div class="card proc">
            <a class="proc-link" [routerLink]="[p.id]">
              <span class="p-ic"><app-icon name="puzzle" [size]="16" /></span>
              <div class="p-titles">
                <div class="p-name">{{ p.name }}</div>
                <div class="muted sm">{{ p.nodes }} nodes</div>
              </div>
            </a>
            <div class="proc-actions">
              <button class="icon-btn" (click)="ctx.renameProcess(p)" title="Rename" aria-label="Rename process"><app-icon name="edit" [size]="14" /></button>
              <button class="icon-btn danger" (click)="ctx.removeProcess(p)" title="Delete" aria-label="Delete process"><app-icon name="trash" [size]="14" /></button>
            </div>
            <a class="btn sm full" [routerLink]="[p.id]">Open →</a>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .hint { color: var(--muted); font-size: 13px; margin: 0 0 14px; max-width: 760px; line-height: 1.5; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 16px; max-width: 440px; }
    .toolbar .in { flex: 1; min-width: 0; border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 13px; }
    .empty-state { padding: 40px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
    .proc { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .proc-link { display: flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; }
    .p-ic { width: 34px; height: 34px; flex-shrink: 0; display: grid; place-items: center; background: var(--green-bg); border-radius: 9px; }
    .p-titles { min-width: 0; } .p-name { font-weight: 700; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sm { font-size: 12px; }
    .proc-actions { display: flex; gap: 4px; margin-top: -4px; }
    .icon-btn { width: 26px; height: 26px; display: grid; place-items: center; border: none; background: transparent; border-radius: 6px; cursor: pointer; color: var(--muted); }
    .icon-btn:hover { background: var(--surface-2); color: var(--text); }
    .icon-btn.danger:hover { background: var(--red-bg); color: var(--red); }
    .btn.sm.full { width: 100%; justify-content: center; text-align: center; }
  `],
})
export class ProjectProcessesComponent {
  ctx = inject(ProjectContextService);
  newProc = '';

  add() {
    const n = this.newProc.trim(); if (!n) return;
    this.ctx.addProcess(n); this.newProc = '';
  }
}
