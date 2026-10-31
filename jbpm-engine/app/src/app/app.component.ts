import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { SideNavComponent } from './shell/side-nav.component';
import { HeaderComponent } from './shell/header.component';
import { ToastComponent } from './shared/toast.component';
import { ModalComponent } from './shared/modal.component';
import { ThemeService } from './core/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, SideNavComponent, HeaderComponent, ToastComponent, ModalComponent],
  template: `
    @if (isStandalonePage()) {
      <router-outlet></router-outlet>
    } @else {
      <div class="layout">
        <app-side-nav></app-side-nav>
        <div class="main">
          <app-header></app-header>
          <div class="page-content">
            <router-outlet></router-outlet>
          </div>
        </div>
      </div>
    }
    <app-toast></app-toast>
    <app-modal></app-modal>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100vh; padding: 0; }
    .layout {
      flex: 1; display: flex; min-height: 0;
      margin: 12px; border-radius: var(--radius-shell);
      background: var(--surface); box-shadow: var(--shadow-shell);
      overflow: hidden; border: 1px solid var(--border);
    }
    .main { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--surface-2); position: relative; }
    .page-content { flex: 1; min-height: 0; overflow: auto; position: relative; }
    @media (min-width: 1600px) { .layout { margin: 20px 24px; } }
    @media (max-width: 900px) { .layout { margin: 0; border-radius: 0; border: none; } }
  `],
})
export class AppComponent {
  private router = inject(Router);
  private theme = inject(ThemeService);

  isStandalonePage = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => {
        const url = e.urlAfterRedirects.split('?')[0];
        return url === '/' || url === '' || url.startsWith('/login') || url.startsWith('/no-workspace');
      }),
    ),
    {
      initialValue: (() => {
        const url = window.location.pathname;
        return url === '/' || url === '' || url.startsWith('/login') || url.startsWith('/no-workspace');
      })(),
    },
  );
}
