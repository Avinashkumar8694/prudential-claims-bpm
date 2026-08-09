// Signal-based auth/session state — no NgRx, matching how the rest of the app (e.g. BuilderComponent)
// already holds state. Token is persisted to sessionStorage (survives reload, dies on tab close — the
// right middle ground given the backend issues flat 12h JWTs with no refresh-token rotation: an
// in-memory-only token would log users out on every accidental reload with no way to silently re-auth,
// while localStorage persists indefinitely across restarts for no benefit here).
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap, switchMap, map } from 'rxjs';
import { AuthApiService } from './auth-api.service';
import { permissionGrants } from './permissions';
import type { AuthUser, JwtClaims } from './auth.models';

const STORAGE_KEY = 'jbpm.token';

function decodeJwt(token: string): JwtClaims | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(AuthApiService);

  private tokenSig = signal<string | null>(sessionStorage.getItem(STORAGE_KEY));
  private permissionsSig = signal<string[]>([]);

  token = this.tokenSig.asReadonly();
  permissions = this.permissionsSig.asReadonly();

  /** null if no token, or the token is present but expired/unparseable. */
  user = computed<AuthUser | null>(() => {
    const t = this.tokenSig();
    if (!t) return null;
    const claims = decodeJwt(t);
    if (!claims || claims.exp * 1000 <= Date.now()) return null;
    return { id: claims.sub, username: claims.username, roles: claims.roles, groups: claims.groups };
  });
  isAuthenticated = computed(() => this.user() !== null);

  // Resolves once the initial permission fetch (below) has settled, success or failure — permissionGuard
  // awaits this before checking hasPermission(). Without it, a hard navigation straight to a
  // permission-gated URL (e.g. reloading on /admin/users) races the guard against the async /auth/me
  // call: the guard would see permissionsSig's empty initial value and wrongly redirect away, even for
  // an admin, before the real permission list has had a chance to load.
  private markReady!: () => void;
  ready: Promise<void> = new Promise((resolve) => { this.markReady = resolve; });

  constructor() {
    // a token survived reload via sessionStorage — refresh its real permission list (roles alone,
    // from the JWT, aren't enough: permissions are only resolved server-side against current Role rows).
    // Deferred to a microtask: authInterceptor injects AuthService on every HttpClient call, so firing
    // this synchronously here — while the DI system is still hydrating this very instance — trips
    // Angular's circular-dependency guard (NG0200). Queuing it lets construction finish first.
    if (this.tokenSig() && this.user()) {
      queueMicrotask(() => this.refreshPermissions().subscribe({ next: () => this.markReady(), error: () => this.markReady() }));
    } else {
      queueMicrotask(() => this.markReady());
    }
  }

  login(username: string, password: string): Observable<AuthUser> {
    return this.api.login(username, password).pipe(
      tap((res) => { this.tokenSig.set(res.token); sessionStorage.setItem(STORAGE_KEY, res.token); }),
      switchMap(() => this.refreshPermissions()),
    );
  }

  logout(): void {
    this.tokenSig.set(null);
    this.permissionsSig.set([]);
    sessionStorage.removeItem(STORAGE_KEY);
  }

  hasPermission(action: string): boolean {
    return permissionGrants(this.permissionsSig(), action);
  }

  private refreshPermissions(): Observable<AuthUser> {
    return this.api.me().pipe(tap((res) => this.permissionsSig.set(res.permissions)), map(() => this.user()!));
  }
}
