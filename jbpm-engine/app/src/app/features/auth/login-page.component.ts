import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AuthApiService } from '../../core/auth/auth-api.service';
import type { AuthConfig } from '../../core/auth/auth.models';
import { API_BASE } from '../../core/config';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [IconComponent, FormsModule],
  template: `
    <div class="wrap">
      <form class="card login" (ngSubmit)="submit()">
        <div class="brand"><span class="logo"><app-icon name="zap" [size]="18" /></span><span class="brand-name">jBPM Engine</span></div>
        <h1>Sign in</h1>
        @if (error()) { <div class="error">{{ error() }}</div> }
        @if (cfg().sso) {
          <button class="btn primary" type="button" (click)="ssoLogin()">Continue with single sign-on</button>
        }
        @if (cfg().sso && cfg().localLogin) { <div class="or"><span>or sign in with a local account</span></div> }
        @if (cfg().localLogin) {
        <label>
          Username
          <input name="username" [(ngModel)]="username" autocomplete="username" required autofocus />
        </label>
        <label>
          Password
          <input name="password" type="password" [(ngModel)]="password" autocomplete="current-password" required />
        </label>
        <button class="btn primary" type="submit" [disabled]="loading()">{{ loading() ? 'Signing in…' : 'Sign in' }}</button>
        }
      </form>
    </div>
  `,
  styles: [`
    /* Transparent so the page's mesh gradient (set on body) shows through — the sign-in screen is
       the first impression and is where the brand backdrop does the most work. */
    .wrap { min-height: 100vh; display: grid; place-items: center; background: transparent; }
    .login { width: 360px; padding: 34px; display: flex; flex-direction: column; gap: 14px; border-radius: var(--radius-shell); box-shadow: var(--shadow-pop); }
    .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
    .logo { width: 34px; height: 34px; display: grid; place-items: center; background: var(--grad-brand); color: #fff; border-radius: 11px; box-shadow: 0 6px 16px -6px rgba(139, 92, 246, .9); }
    .brand-name { font-weight: 700; color: var(--text-secondary); font-size: 13px; }
    h1 { margin: 0 0 8px; font-size: var(--text-xl); letter-spacing: -.02em; }
    label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--muted); }
    input { padding: 9px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 14px; font-family: inherit; }
    input:focus { outline: 2px solid var(--primary); outline-offset: 1px; border-color: var(--primary); }
    .error { color: var(--red); font-size: 13px; background: var(--red-bg); border-radius: var(--radius-sm); padding: 8px 10px; }
    .or { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 12px; }
    .or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--border); }
    .btn.primary { justify-content: center; padding: 10px; font-size: 14px; margin-top: 6px; }
  `],
})
export class LoginPageComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private authApi = inject(AuthApiService);

  /** which sign-in methods the server offers; local login is the safe default until /auth/config answers */
  cfg = signal<AuthConfig>({ sso: false, localLogin: true, ssoLoginUrl: null });

  ngOnInit() {
    const err = this.route.snapshot.queryParamMap.get('error');
    if (err) this.error.set(err);
    this.authApi.config().subscribe({ next: (c) => this.cfg.set(c), error: () => { /* keep the local-login default */ } });
  }

  /** Full-page navigation: the server redirects to the identity server and back to /auth/callback. */
  ssoLogin() {
    const redirect = this.route.snapshot.queryParamMap.get('redirect') || '/home';
    window.location.href = `${API_BASE}/auth/oidc/login?redirect=${encodeURIComponent(redirect)}`;
  }

  username = '';
  password = '';
  loading = signal(false);
  error = signal<string | null>(null);

  submit() {
    if (!this.username || !this.password) return;
    this.loading.set(true);
    this.error.set(null);
    this.auth.login(this.username, this.password).subscribe({
      next: () => {
        const redirect = this.route.snapshot.queryParamMap.get('redirect') || '/projects';
        this.router.navigateByUrl(redirect);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.status === 401 ? 'Invalid username or password' : 'Something went wrong — try again');
      },
    });
  }
}
