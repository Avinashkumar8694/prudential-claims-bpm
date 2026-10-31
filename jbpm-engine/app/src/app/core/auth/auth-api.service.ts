import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiBase } from '../api/api-base';
import type { AuthConfig, LoginResponse, MeResponse } from './auth.models';

@Injectable({ providedIn: 'root' })
export class AuthApiService extends ApiBase {
  login(username: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.base}/auth/login`, { username, password });
  }
  config(): Observable<AuthConfig> {
    return this.http.get<AuthConfig>(`${this.base}/auth/config`);
  }
  register(email: string, password: string, name?: string): Observable<{ id: string; email: string; verificationRequired: boolean }> {
    return this.http.post<{ id: string; email: string; verificationRequired: boolean }>(`${this.base}/auth/register`, { email, password, name });
  }
  verifyEmail(token: string): Observable<void> { return this.http.post<void>(`${this.base}/auth/verify-email`, { token }); }
  resendVerification(email: string): Observable<unknown> { return this.http.post(`${this.base}/auth/resend-verification`, { email }); }
  forgotPassword(email: string): Observable<unknown> { return this.http.post(`${this.base}/auth/forgot-password`, { email }); }
  checkResetToken(token: string): Observable<{ valid: boolean }> { return this.http.post<{ valid: boolean }>(`${this.base}/auth/reset-password/check`, { token }); }
  resetPassword(token: string, password: string): Observable<void> { return this.http.post<void>(`${this.base}/auth/reset-password`, { token, password }); }
  me(): Observable<MeResponse> {
    return this.http.get<MeResponse>(`${this.base}/auth/me`);
  }
  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http.post<void>(`${this.base}/auth/me/password`, { currentPassword, newPassword });
  }
}
