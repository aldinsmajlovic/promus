import type { Routes } from '@angular/router';
import { authGuard, loginGuard, setupGuard, setupNeededGuard } from './core/auth.guard';
import { guestGuard, guestProviders } from './core/guest';

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
    path: 'settings/account',
    canActivate: [authGuard],
    loadComponent: () => import('./features/settings/account.page').then((m) => m.AccountPage),
  },
  {
    path: 'settings/household',
    canActivate: [authGuard],
    loadComponent: () => import('./features/settings/household.page').then((m) => m.HouseholdPage),
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
  // a guest of a link: the list page over the link's own data
  {
    path: 's/:shareId',
    providers: guestProviders(),
    canActivate: [guestGuard],
    loadComponent: () => import('./features/list/list.page').then((m) => m.ListPage),
  },
  // no loginGuard: an invite also turns someone who shared another's login into their own user
  {
    path: 'join',
    loadComponent: () => import('./features/join/join.page').then((m) => m.JoinPage),
  },
];
