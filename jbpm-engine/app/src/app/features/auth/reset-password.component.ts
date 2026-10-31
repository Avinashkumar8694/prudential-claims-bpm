import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthApiService } from '../../core/auth/auth-api.service';
import { AuthConfigService } from '../../core/auth/auth-config.service';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
  template: `
    <div class="auth-wrap"><div class="card auth-card">
      <div class="auth-logo"><app-icon name="zap" [size]="22" /></div>
      @if (state() === 'checking') { <p class="auth-sub">Checking your link…</p> }
      @else if (state() === 'invalid') {
        <h1 class="auth-title">Link expired</h1>
        <p class="auth-sub">This reset link is invalid, has expired, or was already used.</p>
        @if (config.cfg().forgotPassword) { <a class="btn primary" routerLink="/forgot-password">Request a new link</a> }
        <div class="auth-foot"><a routerLink="/login">Back to sign in</a></div>
      } @else {
        <h1 class="auth-title">Choose a new password</h1>
        @if (error()) { <div class="auth-alert error">{{ error() }}</div> }
        <form (ngSubmit)="submit()" class="form" novalidate>
          <label class="auth-field">New password
            <span class="auth-pw"><input name="password" [type]="show() ? 'text' : 'password'" [(ngModel)]="password" autocomplete="new-password" required />
              <button type="button" (click)="show.set(!show())">{{ show() ? 'Hide' : 'Show' }}</button></span></label>
          <div class="auth-hint">At least {{ config.cfg().passwordMinLength }} characters, with a letter and a number.</div>
          <label class="auth-field">Confirm password<input name="confirm" [type]="show() ? 'text' : 'password'" [(ngModel)]="confirm" autocomplete="new-password" required /></label>
          @if (confirm && confirm !== password) { <div class="auth-hint" style="color: var(--red)">Passwords do not match.</div> }
          <button class="btn primary" type="submit" [disabled]="loading() || password.length < config.cfg().passwordMinLength || password !== confirm">{{ loading() ? 'Saving…' : 'Change password' }}</button>
        </form>
      }
    </div></div>
  `,
  styles: [`.form { display: flex; flex-direction: column; gap: 12px; }`],
})
export class ResetPasswordComponent implements OnInit {
  private api = inject(AuthApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  config = inject(AuthConfigService);
  state = signal<'checking' | 'ok' | 'invalid'>('checking');
  password = ''; confirm = ''; show = signal(false); loading = signal(false); error = signal<string | null>(null);
  private token = this.route.snapshot.queryParamMap.get('token') || '';

  ngOnInit() {
    if (!this.token) { this.state.set('invalid'); return; }
    this.api.checkResetToken(this.token).subscribe({ next: (r) => this.state.set(r.valid ? 'ok' : 'invalid'), error: () => this.state.set('invalid') });
  }
  submit() {
    this.loading.set(true); this.error.set(null);
    this.api.resetPassword(this.token, this.password).subscribe({
      next: () => this.router.navigate(['/login'], { queryParams: { reset: 1 }, replaceUrl: true }),
      error: (e) => {
        this.loading.set(false);
        if (e.status === 404) this.state.set('invalid');
        else this.error.set(e.error?.error?.message || 'Could not change the password');
      },
    });
  }
}
