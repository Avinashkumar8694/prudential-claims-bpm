import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthApiService } from '../../core/auth/auth-api.service';
import { AuthConfigService } from '../../core/auth/auth-config.service';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
  template: `
    <div class="auth-wrap"><div class="card auth-card">
      <div class="auth-logo"><app-icon name="zap" [size]="22" /></div>
      @if (config.loaded() && !config.cfg().forgotPassword) {
        <h1 class="auth-title">Password reset unavailable</h1>
        <p class="auth-sub">{{ config.cfg().sso ? 'Your password is managed by single sign-on. Use “Forgot password” on the identity provider.' : 'Ask your administrator to reset your password.' }}</p>
        <a class="btn primary" routerLink="/login">Back to sign in</a>
      } @else if (done()) {
        <h1 class="auth-title">Check your email</h1>
        <p class="auth-sub">If an account exists for <strong>{{ email }}</strong>, we sent a link to choose a new password. It expires in 1 hour.</p>
        <div class="auth-foot"><a routerLink="/login">Back to sign in</a></div>
      } @else {
        <h1 class="auth-title">Forgot your password?</h1>
        <p class="auth-sub">Enter your email and we’ll send you a reset link.</p>
        @if (error()) { <div class="auth-alert error">{{ error() }}</div> }
        <form (ngSubmit)="submit()" class="form" novalidate>
          <label class="auth-field">Email<input name="email" type="email" [(ngModel)]="email" autocomplete="email" required /></label>
          <button class="btn primary" type="submit" [disabled]="loading() || !email.trim()">{{ loading() ? 'Sending…' : 'Send reset link' }}</button>
        </form>
        <div class="auth-foot"><a routerLink="/login">Back to sign in</a></div>
      }
    </div></div>
  `,
  styles: [`.form { display: flex; flex-direction: column; gap: 14px; }`],
})
export class ForgotPasswordComponent {
  private api = inject(AuthApiService);
  config = inject(AuthConfigService);
  email = ''; loading = signal(false); done = signal(false); error = signal<string | null>(null);
  submit() {
    this.loading.set(true); this.error.set(null);
    this.api.forgotPassword(this.email.trim()).subscribe({
      next: () => this.done.set(true),
      // the server answers 202 whether or not the address exists; only throttling/availability can fail
      error: (e) => { this.loading.set(false); this.error.set(e.status === 429 ? 'Too many requests. Please wait and try again.' : 'Could not send the email. Try again shortly.'); },
    });
  }
}
