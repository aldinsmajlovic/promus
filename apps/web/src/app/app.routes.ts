import type { Routes } from '@angular/router';
import { authGuard, loginGuard, setupGuard, setupNeededGuard } from './core/auth.guard';

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
    canActivate: [loginGuard, setupNeededGuard],
    loadComponent: () => import('./features/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'setup',
    canActivate: [loginGuard, setupGuard],
    loadComponent: () => import('./features/setup/setup.page').then((m) => m.SetupPage),
  },
  {
    path: 'join',
    canActivate: [loginGuard],
    loadComponent: () => import('./features/join/join.page').then((m) => m.JoinPage),
  },
];
