import { Routes } from '@angular/router';
import { roleGuard } from './auth/guards/role.guard';

export const routes: Routes = [
  // An empty path will attempt to navigate to '/main'.
  // The roleGuard on the '/trip-confirmation' route will handle redirection if the user is not authenticated or authorized.
  { path: '', redirectTo: 'trip-confirmation', pathMatch: 'full' },

  {
    path: 'trip-confirmation',
    // Point to the new component. Assumes standard file name `trip-confirmation.component.ts` and class `TripConfirmationComponent`.
    loadComponent: () => import('./trip-confirmation/trip-confirmation.component').then(c => c.TripConfirmationComponent),
    canActivate: [roleGuard]
  },


  // Group authentication-related routes under the 'auth' path.
  {
    path: 'auth',
    children: [
      {
        path: 'login',
        // Use dynamic import (lazy loading) for the component.
        loadComponent: () => import('./auth/login/login.component').then(c => c.LoginComponent)
      }
    ]
  },

  // A wildcard route to catch any undefined paths and redirect them to the login page.
  { path: '**', redirectTo: 'auth/login' }
];
