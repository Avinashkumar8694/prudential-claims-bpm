import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AuthApiService } from '../../core/auth/auth-api.service';
import { AuthConfigService } from '../../core/auth/auth-config.service';
import { IconComponent } from '../../shared/icon.component';

/** Self-registration, in the mode the server is configured for:
 *   temp_password (default, like the Identity Server / rules-manager): only name + email are asked; a TEMPORARY PASSWORD is
 *     emailed, signing in with it creates the account and asks for a real password.
 *   password: the person chooses a password now (and confirms their email if the server requires it). */
@Component({
  selector: 'app-register-page',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
  template: `
    <div class="auth-wrap"><div class="card auth-card">
      <div class="auth-logo"><app-icon name="zap" [size]="22" /></div>
      @if (!config.loaded()) { <p class="auth-sub">Loading…</p> }
      @else if (!cfg().registration) {
        <h1 class="auth-title">Registration is closed</h1>
        <p class="auth-sub">Accounts are created by invitation{{ cfg().sso ? ' or by signing in with SSO' : '' }}.</p>
        <a class="btn primary" routerLink="/login">Go to sign in</a>
      } @else if (sent()) {
        <h1 class="auth-title">Check your email</h1>
        @if (temp()) {
          <p class="auth-sub">If <strong>{{ email }}</strong> can be registered, we sent a <strong>temporary password</strong> to it. Sign in with it within {{ cfg().tempPasswordHours }} hours — that confirms your email and creates your account — then choose your own password.</p>
          <a class="btn primary" [routerLink]="['/login']" [queryParams]="{ email: email.trim() }">Continue to sign in</a>
          <button class="btn secondary" type="button" (click)="again()" [disabled]="resent()">{{ resent() ? 'Email re-sent' : 'Resend email' }}</button>
        } @else {
          <p class="auth-sub">We sent a confirmation link to <strong>{{ email }}</strong>. Open it to activate your account.</p>
          <button class="btn secondary" type="button" (click)="resend()" [disabled]="resent()">{{ resent() ? 'Sent again' : 'Resend email' }}</button>
        }
        <div class="auth-foot"><a routerLink="/login">Back to sign in</a></div>
      } @else {
        <h1 class="auth-title">Create your account</h1>
        <p class="auth-sub">{{ temp() ? 'We’ll email you a temporary password — no password to invent now.' : 'Then create a workspace for your team.' }}</p>
        @if (error()) { <div class="auth-alert error" role="alert">{{ error() }}</div> }
        <form (ngSubmit)="submit()" class="form" novalidate>
          <label class="auth-field">Full name<input name="name" [(ngModel)]="name" autocomplete="name" /></label>
          <label class="auth-field">Work email<input name="email" type="email" [(ngModel)]="email" autocomplete="email" required /></label>
          @if (!temp()) {
            <label class="auth-field">Password
              <span class="auth-pw"><input name="password" [type]="show() ? 'text' : 'password'" [(ngModel)]="password" autocomplete="new-password" required />
                <button type="button" (click)="show.set(!show())">{{ show() ? 'Hide' : 'Show' }}</button></span>
            </label>
            <div class="auth-hint" [style.color]="pwOk() ? 'var(--green)' : ''">At least {{ cfg().passwordMinLength }} characters, with a letter and a number.</div>
            <label class="auth-field">Confirm password<input name="confirm" [type]="show() ? 'text' : 'password'" [(ngModel)]="confirm" autocomplete="new-password" required /></label>
            @if (confirm && confirm !== password) { <div class="auth-hint" style="color: var(--red)">Passwords do not match.</div> }
          }
          @if (cfg().tosUrl) {
            <label class="auth-check"><input type="checkbox" name="tos" [(ngModel)]="tos" /> I accept the <a [href]="cfg().tosUrl" target="_blank" rel="noopener">Terms of Service</a></label>
          }
          <button class="btn primary" type="submit" [disabled]="loading() || !valid()">{{ loading() ? 'Working…' : temp() ? 'Email me a temporary password' : 'Create account' }}</button>
        </form>
        <div class="auth-foot"><span>Already have an account? <a routerLink="/login">Sign in</a></span>
          @if (cfg().sso) { <span>or <a routerLink="/login">use single sign-on</a></span> }</div>
      }
    </div></div>
  `,
  styles: [`.form { display: flex; flex-direction: column; gap: 12px; } .auth-check { font-size: 13px; color: var(--muted); display: flex; gap: 8px; align-items: center; } .auth-check a { color: var(--primary); }`],
})
export class RegisterPageComponent {
  private api = inject(AuthApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  config = inject(AuthConfigService);
  cfg = this.config.cfg;
  temp = computed(() => this.cfg().registrationMethod === 'temp_password');

  name = ''; email = ''; password = ''; confirm = ''; tos = false;
  show = signal(false); loading = signal(false); sent = signal(false); resent = signal(false);
  error = signal<string | null>(null);
  pwOk = computed(() => { const p = this.password; return p.length >= this.cfg().passwordMinLength && /[a-zA-Z]/.test(p) && /[0-9]/.test(p); });
  valid() {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(this.email.trim());
    const tosOk = !this.cfg().tosUrl || this.tos;
    return emailOk && tosOk && (this.temp() || (this.pwOk() && this.password === this.confirm));
  }

  submit() {
    if (!this.valid()) return;
    this.loading.set(true); this.error.set(null);
    const email = this.email.trim();
    const body = { email, name: this.name.trim() || undefined, ...(this.temp() ? {} : { password: this.password }), ...(this.cfg().tosUrl ? { tosAccepted: this.tos } : {}) };
    this.api.register(body).subscribe({
      next: (r) => {
        if (this.temp() || r.verificationRequired) { this.sent.set(true); this.loading.set(false); return; }
        this.auth.login(email, this.password).subscribe({
          next: () => this.router.navigateByUrl('/home'),
          error: () => this.router.navigate(['/login'], { queryParams: { registered: 1 } }),
        });
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.error?.error?.message || (err.status === 429 ? 'Too many attempts. Please wait and try again.' : 'Could not create the account'));
      },
    });
  }
  /** temp-password mode: asking again re-issues the email (the server throttles to one a minute) */
  again() { this.api.register({ email: this.email.trim(), name: this.name.trim() || undefined, ...(this.cfg().tosUrl ? { tosAccepted: this.tos } : {}) }).subscribe({ next: () => this.resent.set(true), error: () => this.resent.set(true) }); }
  resend() { this.api.resendVerification(this.email.trim()).subscribe({ next: () => this.resent.set(true), error: () => this.resent.set(true) }); }
}
