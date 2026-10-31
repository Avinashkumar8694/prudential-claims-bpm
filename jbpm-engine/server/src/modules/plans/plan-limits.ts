// What a plan can limit. EVERY key here is enforced by the server — there are no decorative limits. -1 (or an
// absent key) means unlimited. Plan limits are the commercial layer: they tighten (never loosen) the platform-wide
// caps in modules/platform/limits.ts, and the platform administrator edits them (PUT /api/platform/plans/:key).
export interface PlanLimits {
  /** API requests being served at the same moment for the workspace (over → 429 + Retry-After) */
  concurrentRequests?: number;
  /** API requests per minute (fixed one-minute window) for the workspace (over → 429 + Retry-After) */
  requestsPerMinute?: number;
  /** scripts running in parallel = the workspace's script pool size cap (memory ≈ size × per-isolate cap) */
  concurrentScripts?: number;
  /** process instances started per UTC day / ISO week (Mon–Sun) / calendar month (over → 429 with resetsAt) */
  instancesPerDay?: number;
  instancesPerWeek?: number;
  instancesPerMonth?: number;
  /** root instances running or waiting at once */
  maxActiveInstances?: number;
  /** scheduled timers alive at once */
  maxActiveTimers?: number;
  /** workflows (projects), archived ones excluded */
  maxWorkflows?: number;
  /** members + pending invitations, platform administrator excluded */
  maxTeamMembers?: number;
  /** deployments that are not archived */
  maxDeployments?: number;
}

export type PlanLimitKey = keyof PlanLimits;

export const LIMIT_CATALOG: Record<PlanLimitKey, { label: string; unit: string; description: string }> = {
  concurrentRequests: { label: 'Concurrent API requests', unit: 'requests', description: 'In-flight requests for the workspace at the same moment; extra requests get 429 + Retry-After.' },
  requestsPerMinute: { label: 'API requests per minute', unit: 'requests / min', description: 'One-minute request budget for the workspace; over it → 429 + Retry-After.' },
  concurrentScripts: { label: 'Parallel script executions', unit: 'scripts', description: 'Script pool size cap — how many scripts may run at the same time.' },
  instancesPerDay: { label: 'Process starts per day', unit: 'instances / UTC day', description: 'Root process instances started per UTC calendar day.' },
  instancesPerWeek: { label: 'Process starts per week', unit: 'instances / ISO week', description: 'Root process instances started per ISO week (Monday–Sunday, UTC).' },
  instancesPerMonth: { label: 'Process starts per month', unit: 'instances / month', description: 'Root process instances started per UTC calendar month.' },
  maxActiveInstances: { label: 'Active instances', unit: 'instances', description: 'Root instances that are running or waiting at once.' },
  maxActiveTimers: { label: 'Active timers', unit: 'timers', description: 'Scheduled timers alive at once.' },
  maxWorkflows: { label: 'Workflows', unit: 'workflows', description: 'Non-archived workflows (projects).' },
  maxTeamMembers: { label: 'Team members', unit: 'members', description: 'Active members plus pending invitations.' },
  maxDeployments: { label: 'Deployments', unit: 'deployments', description: 'Deployments that are not archived.' },
};
export const PLAN_LIMIT_KEYS = Object.keys(LIMIT_CATALOG) as PlanLimitKey[];

export const UNLIMITED = -1;
const UNLIMITED_ALL = Object.fromEntries(PLAN_LIMIT_KEYS.map((k) => [k, UNLIMITED])) as Required<PlanLimits>;

/** built-in plans; stored plan rows are topped up with any key they lack (admin-edited values are never overwritten). */
export const DEFAULT_PLAN_LIMITS: Record<string, Required<PlanLimits>> = {
  // Free trial: 7 days (see TRIAL_DAYS), 50 concurrent requests, daily / weekly / monthly process-start budgets
  trial: {
    concurrentRequests: 50, requestsPerMinute: 600, concurrentScripts: 2,
    instancesPerDay: 200, instancesPerWeek: 1000, instancesPerMonth: 3000,
    maxActiveInstances: 50, maxActiveTimers: 100, maxWorkflows: 10, maxTeamMembers: 5, maxDeployments: 20,
  },
  starter: {
    concurrentRequests: 100, requestsPerMinute: 3000, concurrentScripts: 4,
    instancesPerDay: 2000, instancesPerWeek: 10000, instancesPerMonth: 30000,
    maxActiveInstances: 500, maxActiveTimers: 1000, maxWorkflows: 50, maxTeamMembers: 15, maxDeployments: 100,
  },
  pro: {
    concurrentRequests: 250, requestsPerMinute: 15000, concurrentScripts: 8,
    instancesPerDay: 20000, instancesPerWeek: 100000, instancesPerMonth: 300000,
    maxActiveInstances: 5000, maxActiveTimers: 10000, maxWorkflows: 500, maxTeamMembers: 100, maxDeployments: 1000,
  },
  enterprise: UNLIMITED_ALL,
  custom: UNLIMITED_ALL,
};

export const TRIAL_DAYS = 7;

/** a limit as a positive number, or undefined = unlimited */
export const cap = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
