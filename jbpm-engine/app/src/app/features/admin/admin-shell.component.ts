import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';

// Persistent chrome for the Admin area — same shell+router-outlet pattern as ProjectShellComponent,
// so Users/Roles/Groups are real routed pages (deep-linkable, independently code-split) instead of an
// in-memory tab-switch.
@Component({
  selector: 'app-admin-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, BreadcrumbComponent],
  template: `
    <div class="admin">
      <div class="crumbwrap"><app-breadcrumb [crumbs]="[{ label: 'Admin' }]" /></div>
      <header class="ahead"><h1>Admin</h1></header>
      <nav class="tabs">
        <a routerLink="users" routerLinkActive="active">Users</a>
        <a routerLink="roles" routerLinkActive="active">Roles</a>
        <a routerLink="groups" routerLinkActive="active">Groups</a>
      </nav>
      <div class="tabbody"><router-outlet /></div>
    </div>
  `,
  styles: [`
    .admin { padding: 0; }
    .crumbwrap { padding: 12px 22px 0; }
    .ahead { padding: 10px 22px 14px; }
    h1 { font-size: 20px; margin: 0; }
    .tabs { display: flex; gap: 4px; padding: 0 22px; background: var(--surface); border-bottom: 1px solid var(--border); }
    .tabs a { border: none; background: transparent; padding: 12px 14px; font-size: 13px; font-weight: 600; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; }
    .tabs a:hover { color: var(--text); } .tabs a.active { color: var(--primary); border-bottom-color: var(--primary); }
    .tabbody { padding: 22px; }
  `],
})
export class AdminShellComponent {}
