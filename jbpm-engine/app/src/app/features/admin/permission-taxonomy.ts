// The known, documented permission strings (server/src/modules/iam/service.ts's DEFAULT_ROLES + '*').
// A checkbox list of exactly these, not freeform text — the backend does zero validation on permission
// strings, so a typo in a hand-typed permission would silently grant nothing.
export const KNOWN_PERMISSIONS: { key: string; label: string }[] = [
  { key: 'workflow:view', label: 'View projects & processes' },
  { key: 'workflow:edit', label: 'Edit projects & processes' },
  { key: 'workflow:deploy', label: 'Deploy projects' },
  { key: 'workflow:run', label: 'Run / manage instances' },
  { key: 'query:read', label: 'Read analytics & queries' },
  { key: 'task:manage', label: 'Manage tasks' },
  { key: 'admin:iam', label: 'Manage users, roles & groups' },
];
export const FULL_ACCESS = '*';
