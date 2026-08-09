import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiBase } from '../api/api-base';
import type { LoginResponse, MeResponse } from './auth.models';

@Injectable({ providedIn: 'root' })
export class AuthApiService extends ApiBase {
  login(username: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.base}/auth/login`, { username, password });
  }
  me(): Observable<MeResponse> {
    return this.http.get<MeResponse>(`${this.base}/auth/me`);
  }
  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http.post<void>(`${this.base}/auth/me/password`, { currentPassword, newPassword });
  }
}
