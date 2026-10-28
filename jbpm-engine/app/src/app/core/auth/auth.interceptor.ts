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

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const toast = inject(ToastService);

  const isPublicAuthRoute = req.url.includes('/api/auth/login');
  const token = auth.token();
  const authed = token && !isPublicAuthRoute ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authed).pipe(
    catchError((err) => {
      if (err.status === 401 && !isPublicAuthRoute && !router.url.startsWith('/login')) {
        auth.logout();
        router.navigate(['/login'], { queryParams: { redirect: router.url } });
      } else if (err.status === 403) {
        toast.error(err.error?.error?.message || 'You don’t have permission to do that');
      }
      return throwError(() => err);
    }),
  );
};
