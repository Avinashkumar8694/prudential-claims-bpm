import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

// AuthService hydrates its user signal synchronously from localStorage at construction — no async
// gap for this guard to race against (a real bug from the earlier build: a guard that checked
// authentication before an async "who am I" call had resolved, so a hard refresh briefly bounced an
// already-logged-in user to /login).
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) return true;
  return router.parseUrl('/login');
};
