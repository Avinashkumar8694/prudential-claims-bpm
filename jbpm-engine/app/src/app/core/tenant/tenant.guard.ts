import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { TenantService } from './tenant.service';

export const tenantGuard: CanActivateFn = async (_route, _state) => {
  const auth = inject(AuthService);
  const tenant = inject(TenantService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }

  await auth.ready;
  await tenant.ready;

  if (tenant.status() === 'empty') {
    return router.createUrlTree(['/no-workspace']);
  }

  return true;
};
