import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { SideNavComponent } from './shell/side-nav.component';
import { NotificationsBellComponent } from './shell/notifications-bell.component';
import { ToastComponent } from './shared/toast.component';
import { ModalComponent } from './shared/modal.component';
import { ThemeService } from './core/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, SideNavComponent, NotificationsBellComponent, ToastComponent, ModalComponent],
  template: `
    @if (isAuthPage()) {
      <router-outlet></router-outlet>
    } @else {
      <div class="layout">
        <app-side-nav></app-side-nav>
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
    :host { display: flex; flex-direction: column; height: 100vh; padding: 0; }
    .layout {
      flex: 1; display: flex; min-height: 0;
      margin: 12px; border-radius: var(--radius-shell);
      background: var(--surface); box-shadow: var(--shadow-shell);
      overflow: hidden; border: 1px solid var(--border);
    }
    /* relative so the floating notifications bell can pin to the pane's top-right corner */
    .main { flex: 1; min-width: 0; overflow: auto; background: var(--surface-2); position: relative; }
    @media (min-width: 1600px) { .layout { margin: 20px 24px; } }
    @media (max-width: 900px) { .layout { margin: 0; border-radius: 0; border: none; } }
  `],
})
export class AppComponent {
  private router = inject(Router);
  // injected only to force ThemeService to construct at boot (its effect stamps data-theme on <html>
  // immediately) — otherwise it wouldn't initialize until something else injects it, e.g. side-nav,
  // which doesn't render on the login page.
  private theme = inject(ThemeService);
  // the login page has no app chrome (side-nav/footer) — everything else does
  isAuthPage = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.startsWith('/login')),
    ),
    { initialValue: this.router.url.startsWith('/login') },
  );
}
