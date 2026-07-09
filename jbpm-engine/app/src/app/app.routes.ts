import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'projects', pathMatch: 'full' },
  { path: 'projects', loadComponent: () => import('./features/workflows/workflows.component').then((m) => m.WorkflowsComponent) },
  { path: 'projects/:id', loadComponent: () => import('./features/project/project.component').then((m) => m.ProjectComponent) },
  { path: 'projects/:id/process/:pid/builder', loadComponent: () => import('./features/builder/builder.component').then((m) => m.BuilderComponent) },
  { path: 'projects/:id/deployments', loadComponent: () => import('./features/deployments/deployments.component').then((m) => m.DeploymentsComponent) },
  { path: 'projects/:id/instances', loadComponent: () => import('./features/instances/instances.component').then((m) => m.InstancesComponent) },
  { path: 'tasks', loadComponent: () => import('./features/instances/instances.component').then((m) => m.InstancesComponent) },
  { path: '**', redirectTo: 'projects' },
];
