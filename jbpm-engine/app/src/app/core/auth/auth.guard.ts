import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.isAuthenticated()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { redirect: state.url } });
};

/** Factory, not a hardcoded adminGuard, so it's reusable for any future permission-gated route.
 *  Awaits AuthService.ready first so a hard navigation straight to a gated URL doesn't race the guard
 *  against the async /auth/me permission fetch (see AuthService.ready's comment). */
export function permissionGuard(action: string): CanActivateFn {
  return async () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    await auth.ready;
    if (auth.hasPermission(action)) return true;
    return router.createUrlTree(['/projects']);
  };
}
