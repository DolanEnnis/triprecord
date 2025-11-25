import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth';
import { map, take } from 'rxjs';

export const roleGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const allowedRoles = route.data?.['roles'] || ['pilot', 'admin'];

  return authService.profile$.pipe(
    take(1),
    map(profile => {
      const hasPermission = profile && allowedRoles.includes(profile.userType?.toLowerCase() ?? '');
      if (hasPermission) {
        return true;
      }

      return router.createUrlTree(['/auth/login']);
    })
  );
};
