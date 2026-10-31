import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

/** Landing page of the single-sign-on round trip. The server (GET /api/auth/oidc/callback) redirects here with
 *  the tokens — or an error — in the URL FRAGMENT (never the query string, so they stay out of server logs and
 *  Referer headers). We consume them once and wipe them from the address bar. */
@Component({
  selector: 'app-sso-callback',
  standalone: true,
  template: `<div class="wrap"><p>{{ message() }}</p></div>`,
  styles: [`.wrap { min-height: 100vh; display: grid; place-items: center; color: var(--muted); font-size: 14px; }`],
})
export class SsoCallbackComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  message = signal('Signing you in…');

  ngOnInit(): void {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    history.replaceState(null, '', window.location.pathname);   // tokens never linger in the address bar/history

    const error = params.get('error');
    const access = params.get('access_token');
    const id = params.get('id_token');
    if (error || (!access && !id)) {
      this.router.navigate(['/login'], { queryParams: { error: error || 'Sign-in failed. Please try again.' }, replaceUrl: true });
      return;
    }
    const returnTo = params.get('return_to');
    // only same-origin paths (the server also checks this)
    const target = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/home';
    this.auth.completeSso(access, id).subscribe({
      next: () => this.router.navigateByUrl(target, { replaceUrl: true }),
      error: () => {
        this.auth.logout();
        this.router.navigate(['/login'], { queryParams: { error: 'Sign-in failed. Please try again.' }, replaceUrl: true });
      },
    });
  }
}
