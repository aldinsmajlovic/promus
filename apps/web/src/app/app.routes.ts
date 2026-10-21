import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/list/list.page').then((m) => m.ListPage) },
];
