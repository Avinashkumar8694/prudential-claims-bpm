import { Injectable, inject } from '@angular/core';
import { Observable, from, switchMap } from 'rxjs';
import { ApiBase } from '../api/api-base';
import { CryptoService } from '../crypto/crypto.service';
import type { LoginResponse, MeResponse } from './auth.models';

@Injectable({ providedIn: 'root' })
export class AuthApiService extends ApiBase {
  private crypto = inject(CryptoService);

  login(username: string, password: string): Observable<LoginResponse> {
    return from(this.crypto.encryptSecret(password)).pipe(
      switchMap((encryptedPassword) =>
        this.http.post<LoginResponse>(`${this.base}/auth/login`, { username, password: encryptedPassword })
      )
    );
  }

  me(): Observable<MeResponse> {
    return this.http.get<MeResponse>(`${this.base}/auth/me`);
  }

  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return from(
      Promise.all([
        this.crypto.encryptSecret(currentPassword),
        this.crypto.encryptSecret(newPassword),
      ])
    ).pipe(
      switchMap(([encCurrent, encNext]) =>
        this.http.post<void>(`${this.base}/auth/me/password`, {
          currentPassword: encCurrent,
          newPassword: encNext,
        })
      )
    );
  }
}
