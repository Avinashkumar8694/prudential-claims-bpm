import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page">
      <div class="card">
        <div class="brand">
          <span class="mark">⚡</span>
          <span class="name">Workflow</span>
        </div>
        <h1>Sign in</h1>
        <form (ngSubmit)="submit()">
          <div class="field">
            <label>Username</label>
            <input name="username" [(ngModel)]="username" autocomplete="username" />
          </div>
          <div class="field">
            <label>Password</label>
            <input name="password" type="password" [(ngModel)]="password" autocomplete="current-password" />
          </div>
          @if (error()) { <div class="err">{{ error() }}</div> }
          <button class="btn primary submit" type="submit" [disabled]="loading()">
            {{ loading() ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>
      </div>
    </div>
  `,
  styles: [`
    .page {
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: var(--grad-page), var(--bg-page);
    }
    .card {
      width: 340px; background: var(--bg-surface); border: 1px solid var(--border-soft);
      border-radius: var(--radius-lg); padding: 28px; box-shadow: var(--shadow-shell);
    }
    .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 22px; }
    .mark {
      width: 32px; height: 32px; border-radius: 10px; background: var(--grad-brand);
      display: flex; align-items: center; justify-content: center; font-size: 15px;
    }
    .name { font-weight: 700; font-size: 14px; }
    h1 { font-size: 20px; margin-bottom: 18px; }
    .field { margin-bottom: 14px; }
    .err { font-size: 12.5px; color: var(--bad); background: var(--bad-bg); border-radius: var(--radius-sm); padding: 8px 10px; margin-bottom: 14px; }
    .submit { width: 100%; justify-content: center; padding: 10px; font-size: 13.5px; }
  `],
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  username = '';
  password = '';
  loading = signal(false);
  error = signal('');

  async submit(): Promise<void> {
    if (!this.username || !this.password) { this.error.set('Enter your username and password.'); return; }
    this.loading.set(true);
    this.error.set('');
    try {
      await this.auth.login(this.username, this.password);
      this.router.navigateByUrl('/home');
    } catch {
      this.error.set('Incorrect username or password.');
    } finally {
      this.loading.set(false);
    }
  }
}
