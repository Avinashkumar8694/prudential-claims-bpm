import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { TenantService } from '../../core/tenant/tenant.service';
import { TeamApiService, type InvitationInfo } from '../../core/team/team.service';
import { setSelectedTenantId } from '../../core/tenant/tenant-selection';
import { API_BASE } from '../../core/config';
import { AuthConfigService } from '../../core/auth/auth-config.service';
import { AuthApiService } from '../../core/auth/auth-api.service';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

/** Landing page of an invitation link: shows what the invitation is for (public lookup), then — once signed in
 *  with the invited email — accepts it and switches to that workspace. */
@Component({
  selector: 'app-accept-invite',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="wrap"><div class="card box">
      @if (info(); as i) {
        <h1>Join {{ i.workspace.name }}</h1>
        <p>You were invited as <strong>{{ i.role }}</strong> with <strong>{{ i.email }}</strong>.</p>
        @if (error()) { <div class="error">{{ error() }}</div> }
        @if (auth.isAuthenticated()) {
          <button class="btn primary" (click)="accept()" [disabled]="busy()">{{ busy() ? 'Joining…' : 'Accept invitation' }}</button>
        } @else if (!i.accountExists && config.cfg().localLogin) {
          <p class="muted">Choose a password to create your account — your invitation email already confirms it is you.</p>
          <label class="field">Password<input type="password" name="pw" [(ngModel)]="password" autocomplete="new-password" /></label>
          <div class="muted small">At least {{ config.cfg().passwordMinLength }} characters, with a letter and a number.</div>
          <button class="btn primary" (click)="activate()" [disabled]="busy() || password.length < config.cfg().passwordMinLength">{{ busy() ? 'Creating…' : 'Create account & join' }}</button>
          @if (config.cfg().sso) { <button class="btn secondary" (click)="signIn()">Use single sign-on instead</button> }
        } @else {
          <button class="btn primary" (click)="signIn()">Sign in to accept</button>
        }
      } @else if (error()) {
        <h1>Invitation unavailable</h1><div class="error">{{ error() }}</div>
      } @else { <p>Loading invitation…</p> }
    </div></div>
  `,
  styles: [`
    .wrap { min-height: 100vh; display: grid; place-items: center; }
    .box { width: 420px; padding: 32px; display: flex; flex-direction: column; gap: 12px; border-radius: var(--radius-shell); }
    h1 { margin: 0; font-size: var(--text-xl); }
    .field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; } .field input { padding: 9px 11px; border: 1px solid var(--border); border-radius: var(--radius-sm); font: inherit; }
    .muted { color: var(--muted); } .small { font-size: 12px; }
    .error { color: var(--red); background: var(--red-bg); border-radius: var(--radius-sm); padding: 8px 10px; font-size: 13px; }
  `],
})
export class AcceptInviteComponent implements OnInit {
  auth = inject(AuthService);
  config = inject(AuthConfigService);
  private authApi = inject(AuthApiService);
  password = '';
  private api = inject(TeamApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private tenant = inject(TenantService);

  info = signal<InvitationInfo | null>(null);
  error = signal<string | null>(null);
  busy = signal(false);
  private token = '';

  async ngOnInit() {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
    if (!this.token) { this.error.set('This invitation link is incomplete.'); return; }
    try { this.info.set(await this.api.lookupInvitation(this.token)); }
    catch { this.error.set('This invitation is invalid, has expired, or was already used.'); }
  }

  /** No account yet: create it from the invitation (token proves the mailbox), sign in, then accept. */
  async activate() {
    const i = this.info(); if (!i) return;
    this.busy.set(true); this.error.set(null);
    try {
      await firstValueFrom(this.api.activateInvitation(this.token, this.password));
      const out = await firstValueFrom(this.auth.login(i.email, this.password));
      if (out.kind !== 'session') throw new Error('unexpected');
      await this.accept();
    } catch (e: any) {
      this.error.set(e?.error?.error?.message || 'Could not create the account.');
      this.busy.set(false);
    }
  }

  signIn() {
    const back = `/accept-invite?token=${encodeURIComponent(this.token)}`;
    window.location.href = `${API_BASE}/auth/oidc/login?redirect=${encodeURIComponent(back)}`;
  }

  async accept() {
    this.busy.set(true); this.error.set(null);
    try {
      const res = await this.api.acceptInvitation(this.token);
      setSelectedTenantId(res.tenantId);
      await this.tenant.refresh(res.tenantId);
      this.router.navigateByUrl('/home');
    } catch (e: any) {
      this.error.set(e?.error?.error?.message || 'Could not accept the invitation.');
      this.busy.set(false);
    }
  }
}
