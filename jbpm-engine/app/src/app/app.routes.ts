import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

// The two canvases (process builder, instance diagram) are deliberately top-level routes, NOT nested
// under the shell — the whole point of the redesign is that the canvas owns the screen; a persistent
// sidenav around it would undo that. Everything else lives inside the shell's sidenav + router-outlet.
export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./features/auth/login/login.component').then((m) => m.LoginComponent) },
  {
    path: 'projects/:workflowId/processes/:versionId/:processId',
    canActivate: [authGuard],
    loadComponent: () => import('./features/builder/process-builder.component').then((m) => m.ProcessBuilderComponent),
  },
  {
    path: 'instances/:id/diagram',
    canActivate: [authGuard],
    loadComponent: () => import('./features/instance-diagram/instance-diagram.component').then((m) => m.InstanceDiagramComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent) },
      { path: 'projects', loadComponent: () => import('./features/projects/project-list.component').then((m) => m.ProjectListComponent) },
      { path: 'projects/:id', loadComponent: () => import('./features/projects/project-detail.component').then((m) => m.ProjectDetailComponent) },
      { path: 'instances', loadComponent: () => import('./features/instances/instance-list.component').then((m) => m.InstanceListComponent) },
      { path: 'instances/:id', loadComponent: () => import('./features/instances/instance-detail.component').then((m) => m.InstanceDetailComponent) },
      { path: 'tasks', loadComponent: () => import('./features/tasks/task-list.component').then((m) => m.TaskListComponent) },
      { path: 'tasks/:id', loadComponent: () => import('./features/tasks/task-detail.component').then((m) => m.TaskDetailComponent) },
      { path: 'deployments', loadComponent: () => import('./features/deployments/deployment-list.component').then((m) => m.DeploymentListComponent) },
      { path: 'settings', loadComponent: () => import('./features/settings/settings.component').then((m) => m.SettingsComponent) },
      { path: 'admin', loadComponent: () => import('./features/admin/admin.component').then((m) => m.AdminComponent) },
    ],
  },
  { path: '**', redirectTo: 'home' },
];
