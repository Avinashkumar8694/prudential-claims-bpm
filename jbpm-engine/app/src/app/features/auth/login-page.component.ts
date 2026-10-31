import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AuthApiService } from '../../core/auth/auth-api.service';
import { AuthConfigService } from '../../core/auth/auth-config.service';
import type { LoginOutcome } from '../../core/auth/auth.models';
import { IconComponent } from '../../shared/icon.component';
import { API_BASE } from '../../core/config';

type Step = 'credentials' | 'setPassword' | 'otpRequest' | 'otpCode';

/** Sign-in. Everything on it is driven by GET /api/auth/config: the SSO button, the password form, the emailed-code
 *  option, "forgot password" and "create account" each appear only when the server has that feature on.
 *  Signing in with an emailed TEMPORARY password (from registration) continues in the "choose your password" step. */
@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [IconComponent, FormsModule, RouterLink],
  template: `
    <div class="auth-wrap">
      <div class="card auth-card">
        <div class="auth-logo"><app-icon name="zap" [size]="22" /></div>
        <h1 class="auth-title">{{ cfg().appName }}</h1>
        <p class="auth-sub">
          @switch (step()) {
            @case ('setPassword') { Welcome! Choose your password to finish setting up }
            @case ('otpRequest') { We’ll email you a sign-in code }
            @case ('otpCode') { Enter the code we sent to {{ username }} }
            @default { Sign in to your workspace }
          }
        </p>

        @if (notice(); as n) {
          <div class="auth-alert" [class.error]="n.kind === 'error'" [class.success]="n.kind === 'success'" [class.info]="n.kind === 'info'" role="alert">
            <span>{{ n.text }}</span><button type="button" (click)="notice.set(null)">Dismiss</button>
          </div>
        }
        @if (invited() && step() === 'credentials') { <div class="auth-alert info">You have a pending team invitation. Sign in to review and accept it.</div> }
        @if (config.noSignIn()) { <div class="auth-alert error">Sign-in is not configured for this deployment. Please contact your administrator.</div> }

        @switch (step()) {
          @case ('credentials') {
            @if (cfg().sso) { <button class="btn primary" type="button" (click)="ssoLogin()">Sign in with SSO</button> }
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
                <div class="auth-links">
                  @if (cfg().otpLogin) { <a (click)="step.set('otpRequest')">Email me a sign-in code</a> } @else { <span></span> }
                  @if (cfg().forgotPassword) { <a routerLink="/forgot-password">Forgot password?</a> }
                </div>
                <button class="btn primary" type="submit" [disabled]="loading() || !username || !password">{{ loading() ? 'Signing in…' : 'Sign in' }}</button>
              </form>
              @if (cfg().registration && cfg().registrationMethod === 'temp_password') {
                <p class="auth-hint">First time here? Register and we’ll email you a temporary password to sign in with.</p>
              }
            }
          }
          @case ('setPassword') {
            <form (ngSubmit)="setPassword()" class="form" novalidate>
              <label class="auth-field">New password
                <span class="auth-pw"><input name="np" [type]="show() ? 'text' : 'password'" [(ngModel)]="newPassword" autocomplete="new-password" required [autofocus]="true" />
                  <button type="button" (click)="show.set(!show())">{{ show() ? 'Hide' : 'Show' }}</button></span>
              </label>
              <div class="auth-hint" [style.color]="pwOk() ? 'var(--green)' : ''">At least {{ cfg().passwordMinLength }} characters, with a letter and a number — and different from the temporary one.</div>
              <label class="auth-field">Confirm new password
                <input name="cp" [type]="show() ? 'text' : 'password'" [(ngModel)]="confirm" autocomplete="new-password" required />
              </label>
              @if (confirm && confirm !== newPassword) { <div class="auth-hint" style="color: var(--red)">Passwords do not match.</div> }
              <button class="btn primary" type="submit" [disabled]="loading() || !pwOk() || newPassword !== confirm">{{ loading() ? 'Saving…' : 'Set password & continue' }}</button>
            </form>
          }
          @case ('otpRequest') {
            <form (ngSubmit)="requestOtp()" class="form" novalidate>
              <label class="auth-field">Email<input name="otpemail" type="email" [(ngModel)]="username" autocomplete="email" required [autofocus]="true" /></label>
              <button class="btn primary" type="submit" [disabled]="loading() || !username">{{ loading() ? 'Sending…' : 'Send code' }}</button>
            </form>
            <div class="auth-foot"><a (click)="step.set('credentials')">Use a password instead</a></div>
          }
          @case ('otpCode') {
            <form (ngSubmit)="verifyOtp()" class="form" novalidate>
              <label class="auth-field">6-digit code
                <input name="otp" inputmode="numeric" pattern="[0-9]*" maxlength="6" [(ngModel)]="code" autocomplete="one-time-code" required [autofocus]="true" />
              </label>
              <button class="btn primary" type="submit" [disabled]="loading() || code.length !== 6">{{ loading() ? 'Verifying…' : 'Sign in' }}</button>
            </form>
            <div class="auth-foot"><a (click)="requestOtp()">Send a new code</a><a (click)="step.set('credentials')">Use a password instead</a></div>
          }
        }

        @if (step() === 'credentials') {
          <div class="auth-foot">
            @if (cfg().registration) { <span>New to {{ cfg().appName }}? <a routerLink="/register">Create an account</a></span> }
            <a routerLink="/">← Back to home</a>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`.form { display: flex; flex-direction: column; gap: 14px; } .auth-hint { text-align: center; }`],
})
export class LoginPageComponent implements OnInit {
  private auth = inject(AuthService);
  private api = inject(AuthApiService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  config = inject(AuthConfigService);
  cfg = this.config.cfg;

  step = signal<Step>('credentials');
  username = '';
  password = '';
  newPassword = '';
  confirm = '';
  code = '';
  private setupToken = '';
  show = signal(false);
  loading = signal(false);
  notice = signal<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null);
  private redirect = this.route.snapshot.queryParamMap.get('redirect') || '';
  invited = computed(() => this.redirect.startsWith('/accept-invite'));
  pwOk = () => this.newPassword.length >= this.cfg().passwordMinLength && /[a-zA-Z]/.test(this.newPassword) && /[0-9]/.test(this.newPassword);

  ngOnInit() {
    const q = this.route.snapshot.queryParamMap;
    if (q.get('error')) this.notice.set({ kind: 'error', text: q.get('error')! });
    else if (q.get('reason') === 'expired') this.notice.set({ kind: 'info', text: 'Your session has expired. Please sign in again.' });
    else if (q.get('reset')) this.notice.set({ kind: 'success', text: 'Your password was changed. Sign in with the new password.' });
    else if (q.get('verified')) this.notice.set({ kind: 'success', text: 'Email verified. You can sign in now.' });
    else if (q.get('registered')) this.notice.set({ kind: 'success', text: 'Account created. Sign in to continue.' });
    else if (q.get('email')) { this.username = q.get('email')!; this.notice.set({ kind: 'info', text: 'Check your email for your temporary password, then sign in with it.' }); }
  }

  private target() { return this.redirect.startsWith('/') && !this.redirect.startsWith('//') ? this.redirect : '/home'; }

  /** Full-page navigation: the server redirects to the identity server and back to /auth/callback. */
  ssoLogin() { window.location.href = `${API_BASE}/auth/oidc/login?redirect=${encodeURIComponent(this.target())}`; }

  private message(err: any, fallback: string): string {
    const msg = err?.error?.error?.message as string | undefined;
    if (err?.status === 429) return msg || 'Too many attempts. Please wait and try again.';
    if (err?.status === 403) return msg || 'You cannot sign in yet.';
    return fallback;
  }

  private handle(out: LoginOutcome) {
    this.loading.set(false);
    if (out.kind === 'setup') { this.setupToken = out.setupToken; this.newPassword = this.confirm = ''; this.step.set('setPassword'); return; }
    this.router.navigateByUrl(this.target());
  }

  submit() {
    if (!this.username || !this.password) return;
    this.loading.set(true); this.notice.set(null);
    this.auth.login(this.username.trim(), this.password).subscribe({
      next: (o) => this.handle(o),
      error: (err) => { this.loading.set(false); this.notice.set({ kind: 'error', text: err.status === 401 ? 'Invalid email/username or password' : this.message(err, 'Something went wrong — try again') }); },
    });
  }

  setPassword() {
    if (!this.pwOk() || this.newPassword !== this.confirm) return;
    this.loading.set(true); this.notice.set(null);
    this.auth.setInitialPassword(this.setupToken, this.newPassword).subscribe({
      next: (o) => this.handle(o),
      error: (err) => {
        this.loading.set(false);
        if (err.status === 401) { this.step.set('credentials'); this.password = ''; this.notice.set({ kind: 'info', text: 'That step expired. Sign in again with your temporary password.' }); }
        else this.notice.set({ kind: 'error', text: err.error?.error?.message || this.message(err, 'Could not set the password') });
      },
    });
  }

  requestOtp() {
    if (!this.username) return;
    this.loading.set(true); this.notice.set(null);
    this.api.otpRequest(this.username.trim()).subscribe({
      next: () => { this.loading.set(false); this.code = ''; this.step.set('otpCode'); this.notice.set({ kind: 'info', text: 'If an account exists for that email, a code is on its way.' }); },
      error: (err) => { this.loading.set(false); this.notice.set({ kind: 'error', text: this.message(err, 'Could not send the code') }); },
    });
  }

  verifyOtp() {
    this.loading.set(true); this.notice.set(null);
    this.auth.verifyOtp(this.username.trim(), this.code.trim()).subscribe({
      next: (o) => this.handle(o),
      error: (err) => { this.loading.set(false); this.notice.set({ kind: 'error', text: err.status === 401 ? 'That code is invalid or has expired.' : this.message(err, 'Could not verify the code') }); },
    });
  }
}
