import { Routes } from '@angular/router';
import { roleGuard } from './auth/guards/role.guard';

export const routes: Routes = [
  // An empty path will attempt to navigate to '/main'.
  // The roleGuard on the '/main' route will handle redirection if the user is not authenticated or authorized.
  { path: '', redirectTo: 'main', pathMatch: 'full' },

  {
    path: 'main',
    loadComponent: () => import('./main/main').then(c => c.MainComponent),
    canActivate: [roleGuard]
  },
  // Group authentication-related routes under the 'auth' path.
  {
    path: 'auth',
    children: [
      {
        path: 'login',
        // Use dynamic import (lazy loading) for the component.
        loadComponent: () => import('./auth/login/login').then(c => c.LoginComponent)
      }
    ]
  },

  // A wildcard route to catch any undefined paths and redirect them to the login page.
  { path: '**', redirectTo: 'auth/login' }
];
