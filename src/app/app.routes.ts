import { Routes } from '@angular/router';
import { roleGuard } from './auth/guards/role.guard';

export const routes: Routes = [
  { 
    path: '', 
    loadComponent: () => import('./status-list/status-list.component').then(c => c.StatusListComponent),
    pathMatch: 'full' 
  },

  {
    path: 'trip-confirmation',
    loadComponent: () => import('./trip-confirmation/trip-confirmation.component').then(c => c.TripConfirmationComponent),
    canActivate: [roleGuard],
    data: { roles: ['pilot', 'admin'] }
  },

  {
    path: 'new-visit',
    loadComponent: () => import('./new-visit/new-visit.component').then(c => c.NewVisitComponent),
    canActivate: [roleGuard],
    data: { roles: ['pilot', 'admin', 'sfpc'] }
  },

  {
    path: 'date-time-picker',
    loadComponent: () => import('./date-time-picker/date-time-picker.component').then(c => c.DateTimePickerComponent),
    canActivate: [roleGuard],
    data: { roles: ['pilot', 'admin'] }
  },

  {
    path: 'admin',
    loadComponent: () => import('./admin/admin.component').then(c => c.AdminComponent),
    canActivate: [roleGuard],
    data: { roles: ['admin'] }
  },

  {
    path: 'auth',
    children: [
      {
        path: 'login',
        loadComponent: () => import('./auth/login/login.component').then(c => c.LoginComponent)
      },
      {
        path: 'register',
        loadComponent: () => import('./auth/register/register.component').then(c => c.RegisterComponent)
      }
    ]
  },

  {
    path: 'dist2shannon',
    loadComponent: () => import('./dist2shannon/dist2shannon.component').then(c => c.Dist2ShannonComponent),
    canActivate: [roleGuard],
    data: { roles: ['pilot', 'admin', 'sfpc'] }
  },

  { path: '**', redirectTo: 'auth/login' }
];
