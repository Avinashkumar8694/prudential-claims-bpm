import { Injectable, inject } from '@angular/core';
import { Observable, from, switchMap } from 'rxjs';
import { ApiBase, ApiList } from './api-base';
import { CryptoService } from '../crypto/crypto.service';
import type { AppGroup, AppRole, AppUser } from '../models';

@Injectable({ providedIn: 'root' })
export class IamApiService extends ApiBase {
  private crypto = inject(CryptoService);

  // users
  listUsers(): Observable<AppUser[]> { return this.items(this.http.get<ApiList<AppUser>>(`${this.base}/users`)); }
  getUser(id: string): Observable<AppUser> { return this.http.get<AppUser>(`${this.base}/users/${id}`); }

  createUser(body: { username: string; password: string; roles?: string[]; groups?: string[] }): Observable<AppUser> {
    return from(this.crypto.encryptSecret(body.password)).pipe(
      switchMap((encPass) => this.http.post<AppUser>(`${this.base}/users`, { ...body, password: encPass }))
    );
  }

  updateUser(id: string, patch: { roles?: string[]; groups?: string[]; active?: boolean }): Observable<AppUser> {
    return this.http.patch<AppUser>(`${this.base}/users/${id}`, patch);
  }

  setPassword(id: string, password: string): Observable<void> {
    return from(this.crypto.encryptSecret(password)).pipe(
      switchMap((encPass) => this.http.post<void>(`${this.base}/users/${id}/password`, { password: encPass }))
    );
  }

  // groups (create + delete only — backend has no rename/update)
  listGroups(): Observable<AppGroup[]> { return this.items(this.http.get<ApiList<AppGroup>>(`${this.base}/groups`)); }
  createGroup(body: { name: string; description?: string }): Observable<AppGroup> { return this.http.post<AppGroup>(`${this.base}/groups`, body); }
  deleteGroup(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/groups/${id}`); }

  // roles
  listRoles(): Observable<AppRole[]> { return this.items(this.http.get<ApiList<AppRole>>(`${this.base}/roles`)); }
  createRole(body: { name: string; permissions: string[] }): Observable<AppRole> { return this.http.post<AppRole>(`${this.base}/roles`, body); }
  updateRolePermissions(id: string, permissions: string[]): Observable<AppRole> { return this.http.patch<AppRole>(`${this.base}/roles/${id}`, { permissions }); }
  deleteRole(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/roles/${id}`); }
}
