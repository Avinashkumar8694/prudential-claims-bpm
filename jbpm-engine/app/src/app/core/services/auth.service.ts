import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

export interface AuthedUser { id: string; tenantId: string; username: string; groups: string[]; roles: string[]; }
interface LoginResponse { token: string; user: AuthedUser; }

const TOKEN_KEY = 'jbpm.token';
const USER_KEY = 'jbpm.user';
const PERMS_KEY = 'jbpm.permissions';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly userSig = signal<AuthedUser | null>(this.readStored<AuthedUser>(USER_KEY));
  private readonly permsSig = signal<Set<string>>(new Set(this.readStored<string[]>(PERMS_KEY) ?? []));
  readonly user = this.userSig.asReadonly();
  readonly isAuthenticated = computed(() => this.userSig() !== null);

  constructor(private http: HttpClient, private router: Router) {}

  private readStored<T>(key: string): T | null {
    try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
  }

  token(): string | null {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  }

  async login(username: string, password: string): Promise<void> {
    const res = await firstValueFrom(this.http.post<LoginResponse>('/api/auth/login', { username, password }));
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    this.userSig.set(res.user);
    await this.refreshPermissions();
  }

  async refreshPermissions(): Promise<void> {
    const res = await firstValueFrom(this.http.get<{ permissions: string[] }>('/api/auth/permissions'));
    localStorage.setItem(PERMS_KEY, JSON.stringify(res.permissions));
    this.permsSig.set(new Set(res.permissions));
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(PERMS_KEY);
    this.userSig.set(null);
    this.permsSig.set(new Set());
    this.router.navigateByUrl('/login');
  }

  hasPermission(permission: string): boolean {
    const p = this.permsSig();
    return p.has('*') || p.has(permission);
  }
}
