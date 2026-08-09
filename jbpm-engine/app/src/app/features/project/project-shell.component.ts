import { Component, inject, computed } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ProjectContextService } from './project-context.service';
import { IconComponent } from '../../shared/icon.component';

// Persistent chrome (header + section nav) for one project. Section pages (Processes/Assets/Settings)
// render in the <router-outlet> below as real routed children — see app.routes.ts — instead of the old
// in-memory tab-switch, so each section is deep-linkable. Angular's default route reuse keeps this
// component (and ProjectContextService, provided here) alive across section navigation, so the header
// never re-fetches or flickers when switching sections.
@Component({
  selector: 'app-project-shell',
  standalone: true,
  imports: [IconComponent, FormsModule, RouterLink, RouterLinkActive, RouterOutlet, BreadcrumbComponent],
  providers: [ProjectContextService],
  template: `
    <div class="proj">
      <div class="crumbwrap"><app-breadcrumb [crumbs]="crumbs()" /></div>
      <header class="phead">
        <a class="icon-btn" routerLink="/projects" title="Projects">‹</a>
        <span class="pic"><app-icon name="zap" [size]="15" /></span>
        <div class="titles">
          <input class="pname" [(ngModel)]="ctx.name" (blur)="ctx.saveName()" />
          <span class="key">{{ ctx.wf()?.key }}</span>
        </div>
        <span class="spacer"></span>
        <a class="btn" routerLink="/instances" [queryParams]="{ workflowId: ctx.id }">Instances</a>
        <a class="btn" routerLink="/deployments" [queryParams]="{ workflowId: ctx.id }">Deployments</a>
        <button class="btn" (click)="ctx.exportKjar()" title="Export as a jBPM kjar (JSON file map)"><app-icon name="download" [size]="14" /> Export jBPM</button>
      </header>

      <nav class="tabs">
        @for (t of tabs; track t.path) {
          <a [routerLink]="t.path" routerLinkActive="active">{{ t.label }}</a>
        }
      </nav>

      <div class="tabbody">
        <router-outlet />
      </div>
    </div>
  `,
  styles: [`
    .proj { padding: 0; height: 100%; display: flex; flex-direction: column; min-height: 0; }
    .crumbwrap { padding: 12px 22px 0; }
    .phead { display: flex; align-items: center; gap: 10px; padding: 14px 22px; background: var(--surface); border-bottom: 1px solid var(--border); }
    .icon-btn { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--muted); }
    .pic { width: 34px; height: 34px; display: grid; place-items: center; background: var(--primary-50); color: var(--primary); border-radius: 9px; font-size: 17px; }
    .titles { display: flex; align-items: center; gap: 10px; }
    .pname { border: 1px solid transparent; border-radius: 8px; padding: 6px 8px; font-size: 17px; font-weight: 700; width: 240px; }
    .pname:hover { border-color: var(--border); } .pname:focus { border-color: var(--primary); outline: none; }
    .key { font-size: 12px; color: var(--muted); background: var(--surface-2); padding: 3px 8px; border-radius: 999px; }
    .tabs { display: flex; gap: 4px; padding: 0 22px; background: var(--surface); border-bottom: 1px solid var(--border); }
    .tabs a { border: none; background: transparent; padding: 12px 14px; font-size: 13px; font-weight: 600; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; }
    .tabs a:hover { color: var(--text); } .tabs a.active { color: var(--primary); border-bottom-color: var(--primary); }
    .tabbody { padding: 22px; flex: 1; min-height: 0; overflow-y: auto; }
  `],
})
export class ProjectShellComponent {
  ctx = inject(ProjectContextService);
  tabs = [
    { path: 'processes', label: 'Processes' }, { path: 'assets', label: 'Assets' }, { path: 'settings', label: 'Settings' },
  ];
  crumbs = computed(() => [
    { label: 'Projects', link: ['/projects'] },
    { label: this.ctx.wf()?.name || '…' },
  ]);
}
