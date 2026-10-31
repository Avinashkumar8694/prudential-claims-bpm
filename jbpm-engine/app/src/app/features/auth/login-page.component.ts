import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AuthConfigService } from '../../core/auth/auth-config.service';
import { IconComponent } from '../../shared/icon.component';
import { API_BASE } from '../../core/config';

/** Sign-in. Everything on it is driven by GET /api/auth/config: the SSO button, the password form, the
 *  "forgot password" and "create account" links each appear only when the server has that feature on. */
@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [IconComponent, FormsModule, RouterLink],
  template: `
    <div class="auth-wrap">
      <div class="card auth-card">
        <div class="auth-logo"><app-icon name="zap" [size]="22" /></div>
        <h1 class="auth-title">{{ cfg().appName }}</h1>
        <p class="auth-sub">Sign in to your workspace</p>

        @if (notice(); as n) {
          <div class="auth-alert" [class.error]="n.kind === 'error'" [class.success]="n.kind === 'success'" [class.info]="n.kind === 'info'" role="alert">
            <span>{{ n.text }}</span><button type="button" (click)="notice.set(null)">Dismiss</button>
          </div>
        }
        @if (invited()) { <div class="auth-alert info">You have a pending team invitation. Sign in to review and accept it.</div> }

        @if (config.noSignIn()) {
          <div class="auth-alert error">Sign-in is not configured for this deployment. Please contact your administrator.</div>
        }

        @if (cfg().sso) {
          <button class="btn primary" type="button" (click)="ssoLogin()">Sign in with SSO</button>
        }
        @if (cfg().sso && cfg().localLogin) { <div class="auth-divider"><span>or use your email and password</span></div> }

        @if (cfg().localLogin) {
          <form (ngSubmit)="submit()" class="form" novalidate>
            <label class="auth-field">Email or username
              <input name="username" [(ngModel)]="username" autocomplete="username" required [autofocus]="!cfg().sso" />
            </label>
            <label class="auth-field">Password
              <span class="auth-pw">
                <input name="password" [type]="show() ? 'text' : 'password'" [(ngModel)]="password" autocomplete="current-password" required />
                <button type="button" (click)="show.set(!show())" [attr.aria-label]="show() ? 'Hide password' : 'Show password'">{{ show() ? 'Hide' : 'Show' }}</button>
              </span>
            </label>
            @if (cfg().forgotPassword) { <div class="auth-links"><span></span><a routerLink="/forgot-password">Forgot password?</a></div> }
            <button class="btn primary" type="submit" [disabled]="loading() || !username || !password">{{ loading() ? 'Signing in…' : 'Sign in' }}</button>
          </form>
        }

        <div class="auth-foot">
          @if (cfg().registration) { <span>New to {{ cfg().appName }}? <a routerLink="/register">Create an account</a></span> }
          <a routerLink="/">← Back to home</a>
        </div>
      </div>
    </div>
  `,
  styles: [`.form { display: flex; flex-direction: column; gap: 14px; }`],
})
export class LoginPageComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  config = inject(AuthConfigService);
  cfg = this.config.cfg;

  username = '';
  password = '';
  show = signal(false);
  loading = signal(false);
  notice = signal<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null);
  private redirect = this.route.snapshot.queryParamMap.get('redirect') || '';
  invited = computed(() => this.redirect.startsWith('/accept-invite'));

  ngOnInit() {
    const q = this.route.snapshot.queryParamMap;
    if (q.get('error')) this.notice.set({ kind: 'error', text: q.get('error')! });
    else if (q.get('reason') === 'expired') this.notice.set({ kind: 'info', text: 'Your session has expired. Please sign in again.' });
    else if (q.get('reset')) this.notice.set({ kind: 'success', text: 'Your password was changed. Sign in with the new password.' });
    else if (q.get('verified')) this.notice.set({ kind: 'success', text: 'Email verified. You can sign in now.' });
    else if (q.get('registered')) this.notice.set({ kind: 'success', text: 'Account created. Sign in to continue.' });
  }

  private target() { return this.redirect.startsWith('/') && !this.redirect.startsWith('//') ? this.redirect : '/home'; }

  /** Full-page navigation: the server redirects to the identity server and back to /auth/callback. */
  ssoLogin() { window.location.href = `${API_BASE}/auth/oidc/login?redirect=${encodeURIComponent(this.target())}`; }

  submit() {
    if (!this.username || !this.password) return;
    this.loading.set(true);
    this.notice.set(null);
    this.auth.login(this.username.trim(), this.password).subscribe({
      next: () => this.router.navigateByUrl(this.target()),
      error: (err) => {
        this.loading.set(false);
        const msg = err.error?.error?.message as string | undefined;
        this.notice.set({ kind: 'error', text: err.status === 401 ? 'Invalid email/username or password'
          : err.status === 429 ? (msg || 'Too many attempts. Please wait and try again.')
          : err.status === 403 ? (msg || 'You cannot sign in yet.') : 'Something went wrong — try again' });
      },
    });
  }
}
