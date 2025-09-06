import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth';
import { map, take } from 'rxjs';

export const roleGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const allowedRoles = ['pilot', 'admin']; // Use lowercase for reliable comparison

  // The authService.profile$ observable encapsulates all the logic for finding
  // and validating a user's profile. We just need to subscribe to its result.
  return authService.profile$.pipe(
    take(1), // We only need to check once per navigation attempt.
    map(profile => {
      // Use optional chaining and nullish coalescing for a safe, case-insensitive check.
      const hasPermission = profile && allowedRoles.includes(profile.userType?.toLowerCase() ?? '');
      if (hasPermission) {
        return true;
      }

      // Otherwise, redirect the user to the login page.
      return router.createUrlTree(['/auth/login']);
    })
  );
};
