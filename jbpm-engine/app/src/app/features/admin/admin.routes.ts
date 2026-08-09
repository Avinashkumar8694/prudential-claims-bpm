import { Routes } from '@angular/router';

export const ADMIN_ROUTES: Routes = [
  { path: '', redirectTo: 'users', pathMatch: 'full' },
  { path: 'users', loadComponent: () => import('./users-list.component').then((m) => m.UsersListComponent) },
  { path: 'roles', loadComponent: () => import('./roles-list.component').then((m) => m.RolesListComponent) },
  { path: 'groups', loadComponent: () => import('./groups-list.component').then((m) => m.GroupsListComponent) },
];
