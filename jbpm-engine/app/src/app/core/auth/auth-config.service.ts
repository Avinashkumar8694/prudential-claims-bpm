// The sign-in surface is configuration-driven: the server (GET /api/auth/config, from its env) says whether SSO,
// local login, self-registration, forgot-password and email verification are on, and every auth screen and
// landing-page button renders from this — nothing is hard-coded in the UI.
import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { AuthConfig } from './auth.models';
import { API_BASE, APP_NAME } from '../config';

// until the server answers (or if it cannot): the safest minimal surface — password sign-in only
const FALLBACK: AuthConfig = {
  appName: APP_NAME, sso: false, localLogin: true, registration: false, forgotPassword: false,
  emailVerification: false, passwordMinLength: 8, ssoLoginUrl: null,
};

@Injectable({ providedIn: 'root' })
export class AuthConfigService {
  private http = inject(HttpClient);
  private cfgSig = signal<AuthConfig>(FALLBACK);
  private loadedSig = signal(false);
  cfg = this.cfgSig.asReadonly();
  loaded = this.loadedSig.asReadonly();
  /** where "Start free trial" / "Get started" buttons go: the register page when self-registration is on, else sign-in (SSO creates the account) */
  signupLink = computed(() => (this.cfgSig().registration ? '/register' : '/login'));
  noSignIn = computed(() => !this.cfgSig().sso && !this.cfgSig().localLogin);

  constructor() {
    this.http.get<AuthConfig>(`${API_BASE}/auth/config`).subscribe({
      next: (c) => { this.cfgSig.set({ ...FALLBACK, ...c }); this.loadedSig.set(true); },
      error: () => this.loadedSig.set(true),
    });
  }
}
