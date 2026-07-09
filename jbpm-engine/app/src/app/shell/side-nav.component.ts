import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

interface NavItem { label: string; icon: string; link: string; }

@Component({
  selector: 'app-side-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="sidenav" [class.collapsed]="collapsed()">
      <div class="brand">
        <span class="logo">⚡</span>
        @if (!collapsed()) { <span class="brand-name">Workflow</span> }
        <button class="collapse" (click)="collapsed.set(!collapsed())" title="Toggle">‹</button>
      </div>
      <ul>
        @for (item of items; track item.link) {
          <li>
            <a [routerLink]="item.link" routerLinkActive="active">
              <span class="ic">{{ item.icon }}</span>
              @if (!collapsed()) { <span>{{ item.label }}</span> }
            </a>
          </li>
        }
      </ul>
    </nav>
  `,
  styles: [`
    .sidenav { width: var(--sidenav-w); background: var(--surface); border-right: 1px solid var(--border); height: 100%; display: flex; flex-direction: column; transition: width .15s; }
    .sidenav.collapsed { width: 64px; }
    .brand { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
    .logo { width: 28px; height: 28px; display: grid; place-items: center; background: var(--primary); color: #fff; border-radius: 8px; }
    .brand-name { font-weight: 700; }
    .collapse { margin-left: auto; border: none; background: transparent; cursor: pointer; color: var(--muted); font-size: 16px; }
    ul { list-style: none; margin: 8px 0; padding: 0; overflow-y: auto; }
    a { display: flex; align-items: center; gap: 12px; padding: 10px 16px; color: var(--text); border-left: 3px solid transparent; }
    a:hover { background: #f6f7fb; }
    a.active { color: var(--primary); border-left-color: var(--primary); background: #f2f0ff; font-weight: 600; }
    .ic { width: 20px; text-align: center; }
  `],
})
export class SideNavComponent {
  collapsed = signal(false);
  items: NavItem[] = [
    { label: 'Projects', icon: '▤', link: '/projects' },
    { label: 'Tasks', icon: '☑', link: '/tasks' },
  ];
}
