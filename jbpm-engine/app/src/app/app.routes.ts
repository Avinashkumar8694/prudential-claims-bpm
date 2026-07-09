import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'workflows', pathMatch: 'full' },
  { path: 'workflows', loadComponent: () => import('./features/workflows/workflows.component').then((m) => m.WorkflowsComponent) },
  { path: 'workflows/:id/builder', loadComponent: () => import('./features/builder/builder.component').then((m) => m.BuilderComponent) },
  { path: 'workflows/:id/deployments', loadComponent: () => import('./features/deployments/deployments.component').then((m) => m.DeploymentsComponent) },
  { path: 'workflows/:id/instances', loadComponent: () => import('./features/instances/instances.component').then((m) => m.InstancesComponent) },
  { path: 'tasks', loadComponent: () => import('./features/instances/instances.component').then((m) => m.InstancesComponent) },
  { path: '**', redirectTo: 'workflows' },
];
