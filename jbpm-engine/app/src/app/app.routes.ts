import { Routes } from '@angular/router';
import { authGuard, permissionGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./features/auth/login-page.component').then((m) => m.LoginPageComponent) },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      // Home is the landing page, not the project grid: a project grid is the *builder's* view, while
      // an operator or process owner logging in wants their work and the system's health first.
      { path: '', redirectTo: 'home', pathMatch: 'full' },
      { path: 'home', loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent) },
      { path: 'projects', loadComponent: () => import('./features/workflows/workflows.component').then((m) => m.WorkflowsComponent) },
      {
        path: 'projects/:id',
        loadComponent: () => import('./features/project/project-shell.component').then((m) => m.ProjectShellComponent),
        children: [
          { path: '', redirectTo: 'processes', pathMatch: 'full' },
          // Processes is a list only (matches Assets) — the canvas needs real width for its node
          // palette + diagram, so opening a process routes to its own full-bleed page instead of
          // sharing a row with the list.
          { path: 'processes', loadComponent: () => import('./features/project/project-processes.component').then((m) => m.ProjectProcessesComponent) },
          { path: 'processes/:pid', loadComponent: () => import('./features/project/project-process-canvas-page.component').then((m) => m.ProjectProcessCanvasPageComponent) },
          { path: 'assets', loadComponent: () => import('./features/project/project-assets.component').then((m) => m.ProjectAssetsComponent) },
          { path: 'settings', loadComponent: () => import('./features/project/project-settings.component').then((m) => m.ProjectSettingsComponent) },
        ],
      },
      // Deployments/Instances are top-level, cross-project pages (like Tasks) — a deployment/instance
      // always belongs to one project, but browsing them is a cross-project concern, matching real
      // jBPM's Deploy/Manage menus. Project header links pass ?workflowId= to pre-filter.
      { path: 'deployments', loadComponent: () => import('./features/deployments/deployments.component').then((m) => m.DeploymentsComponent) },
      { path: 'deployments/:id', loadComponent: () => import('./features/deployments/deployment-detail.component').then((m) => m.DeploymentDetailComponent) },
      { path: 'instances', loadComponent: () => import('./features/instances/instances.component').then((m) => m.InstancesComponent) },
      // Start New Instance is its own page (jBPM's "New Process Instance" flow), not a modal —
      // it must come before instances/:id or "start" would be read as an instance id.
      { path: 'instances/start', loadComponent: () => import('./features/instances/start-instance.component').then((m) => m.StartInstanceComponent) },
      // Dedicated page per instance: Details / Diagram / Variables / Logs / Documents tabs.
      { path: 'instances/:id', loadComponent: () => import('./features/instances/instance-detail.component').then((m) => m.InstanceDetailComponent) },
      // Operations pages share the Instances list+rail shape (see ux_design execution-errors.html).
      { path: 'errors', loadComponent: () => import('./features/ops/execution-errors.component').then((m) => m.ExecutionErrorsComponent) },
      { path: 'errors/:id', loadComponent: () => import('./features/ops/execution-error-detail.component').then((m) => m.ExecutionErrorDetailComponent) },
      { path: 'jobs', loadComponent: () => import('./features/ops/jobs-timers.component').then((m) => m.JobsTimersComponent) },
      { path: 'reports', loadComponent: () => import('./features/reports/reports.component').then((m) => m.ReportsComponent) },
      {
        path: 'tasks',
        canActivate: [permissionGuard('task:manage')],
        loadComponent: () => import('./features/tasks/task-inbox.component').then((m) => m.TaskInboxComponent),
      },
      // Dedicated page per task: Work / Details / Assignments / Comments / Admin / Logs tabs.
      {
        path: 'tasks/:id',
        canActivate: [permissionGuard('task:manage')],
        loadComponent: () => import('./features/tasks/task-detail.component').then((m) => m.TaskDetailComponent),
      },
      {
        path: 'audit',
        canActivate: [permissionGuard('admin:iam')],
        loadComponent: () => import('./features/ops/audit-log.component').then((m) => m.AuditLogComponent),
      },
      {
        path: 'audit/:id',
        canActivate: [permissionGuard('admin:iam')],
        loadComponent: () => import('./features/ops/audit-detail.component').then((m) => m.AuditDetailComponent),
      },
      {
        path: 'admin',
        canActivate: [permissionGuard('admin:iam')],
        loadComponent: () => import('./features/admin/admin-shell.component').then((m) => m.AdminShellComponent),
        loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
      },
      { path: 'settings', loadComponent: () => import('./features/settings/settings.component').then((m) => m.SettingsComponent) },
      { path: 'integration-guide', loadComponent: () => import('./features/integration-guide/integration-guide.component').then((m) => m.IntegrationGuideComponent) },
      // Workflow Instance Management (Case Management)
      {
        path: 'workflow-management',
        canActivate: [permissionGuard('workflowInstance:admin')],
        loadComponent: () => import('./features/workflow-mgmt/workflow-management.component').then((m) => m.WorkflowManagementComponent),
      },
      {
        path: 'workflow-instances',
        redirectTo: 'instances',
        pathMatch: 'full',
      },
      {
        path: 'workflow-instances/:id',
        loadComponent: () => import('./features/instances/instance-detail.component').then((m) => m.InstanceDetailComponent),
      },
      {
        path: 'workflow-analytics',
        redirectTo: 'reports',
        pathMatch: 'full',
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
