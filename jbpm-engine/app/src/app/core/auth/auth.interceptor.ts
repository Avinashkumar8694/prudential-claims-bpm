// Functional HttpInterceptorFn (Angular 18 style). Attaches the bearer token to every request except
// the public /auth/login route; on 401 logs out + redirects to login (token missing/invalid/expired,
// but not while already on /login, to avoid clobbering the login page's own error message); on 403
// surfaces a toast instead of a silent failure or console error. This is the answer to "don't
// re-implement every permission check client-side": gate the obvious high-value UI (nav items,
// Deploy/Run/Edit buttons) and let genuinely edge-case 403s show up here instead.
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { ToastService } from '../../shared/toast.service';
import { getSelectedTenantId } from '../tenant/tenant-selection';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const toast = inject(ToastService);

  const isPublicAuthRoute = /\/api\/auth\/(?!me)/.test(req.url) || req.url.includes('/api/public/') || req.url.includes('/api/tenants/check');
  // signup is public without SSO but needs the caller's token with it (the workspace is created for the signed-in identity)
  const isSignup = req.url.includes('/api/tenants/signup');
  const token = auth.token();
  const selectedTenant = getSelectedTenantId();

  const headers: Record<string, string> = {};
  if (token && (!isPublicAuthRoute || isSignup)) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (selectedTenant && !req.headers.has('x-tenant-id') && !isPublicAuthRoute && !isSignup) {
    headers['x-tenant-id'] = selectedTenant;
  }

  const authed = Object.keys(headers).length > 0 ? req.clone({ setHeaders: headers }) : req;

  return next(authed).pipe(
    catchError((err) => {
      if (err.status === 401 && !isPublicAuthRoute && !router.url.startsWith('/login') && !router.url.startsWith('/auth/callback')) {
        auth.logout();
        router.navigate(['/login'], { queryParams: { redirect: router.url } });
      } else if (err.status === 402 || err.status === 429) {
        // plan expired (402) or a plan/quota limit (429): the server's message says exactly which and when it resets
        toast.error(err.error?.error?.message || (err.status === 402 ? 'Your plan has ended' : 'A plan limit was reached'));
      } else if (err.status === 403) {
        toast.error(err.error?.error?.message || 'You don’t have permission to do that');
      }
      return throwError(() => err);
    }),
  );
};
