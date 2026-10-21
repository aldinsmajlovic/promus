import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/list/list.page').then((m) => m.ListPage) },
  { path: 'add', loadComponent: () => import('./features/add/add.page').then((m) => m.AddPage) },
];
