import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { AuthService } from './core/auth/auth.service';
import { SideNavComponent } from './shell/side-nav.component';
import { NotificationsBellComponent } from './shell/notifications-bell.component';
import { ToastComponent } from './shared/toast.component';
import { ModalComponent } from './shared/modal.component';
import { ThemeService } from './core/theme.service';
import { IconComponent } from './shared/icon.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, SideNavComponent, NotificationsBellComponent, ToastComponent, ModalComponent, IconComponent],
  template: `
    @if (isAuthPage() || !auth.isAuthenticated()) {
      <router-outlet></router-outlet>
    } @else {
      <div class="layout">
        <header class="mobile-topbar" aria-label="Mobile navigation header">
          <button class="menu-btn" (click)="sideNav.toggleMobile()" [attr.aria-expanded]="sideNav.mobileOpen()" aria-label="Toggle navigation drawer">
            <app-icon name="menu" [size]="18" />
          </button>
          <div class="mobile-brand">
            <span class="mobile-logo"><app-icon name="zap" [size]="15" /></span>
            <span class="mobile-title">Workflow</span>
          </div>
          <span class="mobile-spacer"></span>
          <button class="theme-btn" (click)="theme.toggle()" [title]="theme.theme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'" aria-label="Toggle color theme">
            <app-icon [name]="theme.theme() === 'dark' ? 'sun' : 'moon'" [size]="16" />
          </button>
        </header>
        <app-side-nav #sideNav></app-side-nav>
        <div class="main">
          <app-notifications-bell />
          <router-outlet></router-outlet>
        </div>
      </div>
    }
    <app-toast></app-toast>
    <app-modal></app-modal>
  `,
  styles: [`
    /* The app is a floating rounded surface on the page's mesh gradient, not a full-bleed grey
       chrome. The inset is deliberately small on narrow viewports so no horizontal space is
       wasted, and grows on wide screens where the gradient backdrop can breathe. */
    :host { display: flex; flex-direction: column; height: 100vh; height: 100dvh; padding: 0; }
    .layout {
      flex: 1; display: flex; min-height: 0;
      margin: 12px; border-radius: var(--radius-shell);
      background: var(--surface); box-shadow: var(--shadow-shell);
      overflow: hidden; border: 1px solid var(--border);
    }
    /* relative so the floating notifications bell can pin to the pane's top-right corner */
    .main { flex: 1; min-width: 0; overflow: auto; background: var(--surface-2); position: relative; }
    .mobile-topbar { display: none; }

    @media (min-width: 1600px) { .layout { margin: 20px 24px; } }
    @media (max-width: 900px) {
      .layout {
        margin: 0; border-radius: 0; border: none;
        flex-direction: column;
        height: 100vh; height: 100dvh;
      }
      .mobile-topbar {
        display: flex; align-items: center; gap: 10px;
        height: 50px; padding: 0 14px;
        background: var(--surface); border-bottom: 1px solid var(--border);
        flex-shrink: 0; z-index: 30;
      }
      .menu-btn, .theme-btn {
        border: none; background: transparent; cursor: pointer; color: var(--text-secondary);
        width: 36px; height: 36px; display: grid; place-items: center; border-radius: var(--radius-sm);
      }
      .menu-btn:hover, .theme-btn:hover { background: var(--surface-3); color: var(--text); }
      .mobile-brand { display: flex; align-items: center; gap: 8px; }
      .mobile-logo {
        width: 28px; height: 28px; display: grid; place-items: center;
        background: var(--grad-brand); color: #fff; border-radius: 8px; font-weight: 800;
        box-shadow: 0 4px 10px -3px rgba(139, 92, 246, .8);
      }
      .mobile-title { font-weight: 700; font-size: 15px; letter-spacing: -.02em; }
      .mobile-spacer { flex: 1; }
    }
  `],
})
export class AppComponent {
  auth = inject(AuthService);
  theme = inject(ThemeService);
  private router = inject(Router);
  // the login page has no app chrome (side-nav/footer) — everything else does
  isAuthPage = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.startsWith('/login')),
    ),
    { initialValue: this.router.url.startsWith('/login') },
  );
}
