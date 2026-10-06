import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/services/auth.service';

interface NavItem { label: string; path: string; icon: string; }

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <div class="shell" [class.collapsed]="collapsed()">
      <aside class="sidenav">
        <div class="brand">
          <span class="mark">⚡</span>
          @if (!collapsed()) { <span class="name">Workflow</span> }
          <button class="collapse-btn" (click)="collapsed.set(!collapsed())" [attr.aria-label]="collapsed() ? 'Expand navigation' : 'Collapse navigation'">
            {{ collapsed() ? '»' : '«' }}
          </button>
        </div>
        <nav>
          @for (item of primaryNav; track item.path) {
            <a [routerLink]="item.path" routerLinkActive="active" class="nav-item">
              <span class="icon">{{ item.icon }}</span>
              @if (!collapsed()) { <span>{{ item.label }}</span> }
            </a>
          }
        </nav>
        <div class="section-label" [class.hidden]="collapsed()">Governance</div>
        <nav>
          @for (item of govNav; track item.path) {
            <a [routerLink]="item.path" routerLinkActive="active" class="nav-item">
              <span class="icon">{{ item.icon }}</span>
              @if (!collapsed()) { <span>{{ item.label }}</span> }
            </a>
          }
        </nav>
        <div class="spacer"></div>
        <div class="user" (click)="menuOpen.set(!menuOpen())">
          <div class="avatar">{{ initials() }}</div>
          @if (!collapsed()) {
            <div class="who">
              <div class="uname">{{ auth.user()?.username }}</div>
              <div class="urole">{{ (auth.user()?.roles ?? []).join(', ') || 'No role' }}</div>
            </div>
          }
          @if (menuOpen()) {
            <div class="menu" (click)="$event.stopPropagation()">
              <button class="menu-item" (click)="logout()">Sign out</button>
            </div>
          }
        </div>
      </aside>
      <div class="main">
        <router-outlet />
      </div>
    </div>
  `,
  styles: [`
    .shell { display: flex; height: 100vh; }
    .sidenav {
      width: var(--sidenav-w); flex: none; background: var(--bg-surface); border-right: 1px solid var(--border-soft);
      display: flex; flex-direction: column; padding: 14px 10px; transition: width .15s ease; position: relative;
    }
    .collapsed .sidenav { width: var(--sidenav-w-collapsed); }
    .brand { display: flex; align-items: center; gap: 9px; padding: 6px 8px 16px; }
    .mark { width: 28px; height: 28px; border-radius: 8px; background: var(--grad-brand); display: flex; align-items: center; justify-content: center; font-size: 13px; flex: none; }
    .name { font-weight: 700; font-size: 13.5px; flex: 1; }
    .collapse-btn { background: none; border: none; color: var(--text-faint); cursor: pointer; font-size: 12px; padding: 4px; }
    .collapse-btn:hover { color: var(--text-hi); }
    nav { display: flex; flex-direction: column; gap: 2px; }
    .nav-item {
      display: flex; align-items: center; gap: 11px; padding: 9px 10px; border-radius: var(--radius-sm);
      color: var(--text-lo); font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden;
    }
    .nav-item:hover { background: var(--bg-chip); color: var(--text-hi); }
    .nav-item.active { background: var(--bg-chip); color: var(--text-hi); }
    .icon { width: 18px; text-align: center; flex: none; font-size: 14px; }
    .section-label {
      font-size: 10.5px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .06em;
      padding: 16px 10px 6px;
    }
    .section-label.hidden { opacity: 0; height: 8px; padding: 8px 0 0; }
    .spacer { flex: 1; }
    .user { position: relative; display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: var(--radius-sm); cursor: pointer; }
    .user:hover { background: var(--bg-chip); }
    .avatar {
      width: 30px; height: 30px; border-radius: 50%; background: var(--grad-brand); flex: none;
      display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #fff;
    }
    .who { overflow: hidden; }
    .uname { font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .urole { font-size: 11px; color: var(--text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .menu {
      position: absolute; bottom: 100%; left: 0; right: 0; margin-bottom: 6px;
      background: var(--bg-chip); border: 1px solid var(--border-soft); border-radius: var(--radius-sm);
      padding: 4px; box-shadow: var(--shadow-shell);
    }
    .menu-item { width: 100%; text-align: left; background: none; border: none; color: var(--text-hi); font-size: 12.5px; padding: 8px 10px; border-radius: 6px; cursor: pointer; }
    .menu-item:hover { background: var(--bg-surface-2); }
    .main { flex: 1; min-width: 0; overflow: auto; background: var(--bg-page); }
  `],
})
export class ShellComponent {
  auth = inject(AuthService);
  collapsed = signal(false);
  menuOpen = signal(false);

  primaryNav: NavItem[] = [
    { label: 'Home', path: '/home', icon: '⌂' },
    { label: 'Projects', path: '/projects', icon: '▦' },
    { label: 'Instances', path: '/instances', icon: '◎' },
    { label: 'Tasks', path: '/tasks', icon: '☑' },
    { label: 'Deployments', path: '/deployments', icon: '⇪' },
  ];
  govNav: NavItem[] = [
    { label: 'Settings', path: '/settings', icon: '⚙' },
    { label: 'Admin', path: '/admin', icon: '⚿' },
  ];

  initials(): string {
    const u = this.auth.user()?.username || '?';
    return u.slice(0, 2).toUpperCase();
  }

  logout(): void {
    this.menuOpen.set(false);
    this.auth.logout();
  }
}
