import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AuthApiService } from '../../core/auth/auth-api.service';
import { AuthConfigService } from '../../core/auth/auth-config.service';
import { IconComponent } from '../../shared/icon.component';

/** Self-registration (only when the server has it enabled). With email verification on, the account is created
 *  and the user is asked to confirm their mailbox; otherwise they are signed straight in and land on workspace setup. */
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
        <p class="auth-sub">We sent a confirmation link to <strong>{{ email }}</strong>. Open it to activate your account.</p>
        <button class="btn secondary" type="button" (click)="resend()" [disabled]="resent()">{{ resent() ? 'Sent again' : 'Resend email' }}</button>
        <div class="auth-foot"><a routerLink="/login">Back to sign in</a></div>
      } @else {
        <h1 class="auth-title">Create your account</h1>
        <p class="auth-sub">Then create a workspace for your team.</p>
        @if (error()) { <div class="auth-alert error" role="alert">{{ error() }}</div> }
        <form (ngSubmit)="submit()" class="form" novalidate>
          <label class="auth-field">Full name<input name="name" [(ngModel)]="name" autocomplete="name" /></label>
          <label class="auth-field">Work email<input name="email" type="email" [(ngModel)]="email" autocomplete="email" required /></label>
          <label class="auth-field">Password
            <span class="auth-pw"><input name="password" [type]="show() ? 'text' : 'password'" [(ngModel)]="password" autocomplete="new-password" required />
              <button type="button" (click)="show.set(!show())">{{ show() ? 'Hide' : 'Show' }}</button></span>
          </label>
          <div class="auth-hint" [style.color]="pwOk() ? 'var(--green)' : ''">At least {{ cfg().passwordMinLength }} characters, with a letter and a number.</div>
          <label class="auth-field">Confirm password<input name="confirm" [type]="show() ? 'text' : 'password'" [(ngModel)]="confirm" autocomplete="new-password" required /></label>
          @if (confirm && confirm !== password) { <div class="auth-hint" style="color: var(--red)">Passwords do not match.</div> }
          <button class="btn primary" type="submit" [disabled]="loading() || !valid()">{{ loading() ? 'Creating account…' : 'Create account' }}</button>
        </form>
        <div class="auth-foot"><span>Already have an account? <a routerLink="/login">Sign in</a></span>
          @if (cfg().sso) { <span>or <a routerLink="/login">use single sign-on</a></span> }</div>
      }
    </div></div>
  `,
  styles: [`.form { display: flex; flex-direction: column; gap: 12px; }`],
})
export class RegisterPageComponent {
  private api = inject(AuthApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  config = inject(AuthConfigService);
  cfg = this.config.cfg;

  name = ''; email = ''; password = ''; confirm = '';
  show = signal(false); loading = signal(false); sent = signal(false); resent = signal(false);
  error = signal<string | null>(null);
  pwOk = computed(() => { const p = this.password; return p.length >= this.cfg().passwordMinLength && /[a-zA-Z]/.test(p) && /[0-9]/.test(p); });
  valid() { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(this.email.trim()) && this.pwOk() && this.password === this.confirm; }

  submit() {
    if (!this.valid()) return;
    this.loading.set(true); this.error.set(null);
    const email = this.email.trim();
    this.api.register(email, this.password, this.name.trim() || undefined).subscribe({
      next: (r) => {
        if (r.verificationRequired) { this.sent.set(true); this.loading.set(false); return; }
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
  resend() { this.api.resendVerification(this.email.trim()).subscribe({ next: () => this.resent.set(true), error: () => this.resent.set(true) }); }
}
