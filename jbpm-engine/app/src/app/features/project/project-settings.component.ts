import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProjectContextService } from './project-context.service';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-project-settings',
  standalone: true,
  imports: [IconComponent, FormsModule],
  template: `
    <h3 class="sec-h">General</h3>
    <div class="setrow"><label>Key</label><input [value]="ctx.wf()?.key" disabled /></div>
    <div class="setrow"><label>Description</label><input [(ngModel)]="ctx.description" (blur)="ctx.saveName()" placeholder="What this project does" /></div>
    <div class="setrow"><label>Integration base URL</label><input [(ngModel)]="ctx.baseUrl" placeholder="http://localhost:3000" /><small>Applied per deployment environment for service tasks.</small></div>
    <p class="hint">Per-process cron/scheduled starts and environment overrides are planned (see docs/13).</p>

    <h3 class="sec-h">Shared variables</h3>
    <p class="hint">Project-shared variables. (Each process also has its own variables, edited in its canvas toolbar.)</p>
    @if (ctx.vars().length === 0) {
      <div class="empty-state">
        <div class="es-icon"><app-icon name="settings" [size]="24" /></div>
        <h3>No shared variables yet</h3>
        <p>Add one below to share it across every process in this project.</p>
      </div>
    } @else {
      @for (v of ctx.vars(); track $index) {
        <div class="vrow">
          <input placeholder="name" [(ngModel)]="v.name" />
          <select [(ngModel)]="v.type"><option>string</option><option>int</option><option>long</option><option>double</option><option>bool</option><option>date</option><option>object</option><option>list</option><option>map</option></select>
          <button class="x" (click)="ctx.rmVar($index)" aria-label="Remove variable"><app-icon name="close" [size]="13" /></button>
        </div>
      }
    }
    <div class="row">
      <button class="add" (click)="ctx.addVar()">+ add variable</button>
      @if (ctx.vars().length) { <button class="btn primary" (click)="ctx.saveVars()">Save variables</button> }
    </div>
  `,
  styles: [`
    .sec-h { font-size: 14px; margin: 0 0 14px; }
    .sec-h:not(:first-child) { margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--border); }
    .setrow { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; max-width: 520px; }
    .setrow label { font-size: 12px; color: var(--muted); font-weight: 600; }
    .setrow input { border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
    .setrow small { color: var(--muted); font-size: 12px; }
    .hint { color: var(--muted); font-size: 13px; margin: 0 0 16px; }
    .vrow { display: flex; gap: 8px; margin-bottom: 8px; max-width: 520px; }
    .vrow input { flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; }
    .vrow select { flex: 0 0 120px; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; }
    .x { width: 32px; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; cursor: pointer; color: var(--muted); }
    .add { border: 1px dashed var(--border); background: var(--surface); border-radius: 8px; padding: 7px 12px; font-size: 13px; cursor: pointer; color: var(--muted); }
    .row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  `],
})
export class ProjectSettingsComponent {
  ctx = inject(ProjectContextService);
}
