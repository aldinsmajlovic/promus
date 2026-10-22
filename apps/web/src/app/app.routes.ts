import type { Routes } from '@angular/router';
import { authGuard, loginGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/list/list.page').then((m) => m.ListPage),
  },
  {
    path: 'add',
    canActivate: [authGuard],
    loadComponent: () => import('./features/add/add.page').then((m) => m.AddPage),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage),
  },
  {
    path: 'login',
    canActivate: [loginGuard],
    loadComponent: () => import('./features/login/login.page').then((m) => m.LoginPage),
  },
];
