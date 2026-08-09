// Literal port of the backend's own tiny algorithm (server/src/infra/auth.ts's permissionGrants) —
// not a reinvention. AuthService calls this against the REAL permission list returned by GET
// /auth/me (server-resolved from the caller's current roles), so it stays correct even for a custom
// role created later via the admin UI — no hardcoded mirror of DEFAULT_ROLES to drift out of sync.
export function permissionGrants(permissions: string[], action: string): boolean {
  return permissions.some((p) => p === '*' || p === action || (p.endsWith(':*') && action.startsWith(p.slice(0, -1))));
}
