// Mirrors the backend's JWT claims (server/src/infra/auth.ts's JwtClaims) and /auth/login,/auth/me
// response shapes (server/src/http/auth-routes.ts).
export interface JwtClaims { sub: string; username: string; roles: string[]; groups: string[]; exp: number; iat: number; }
export interface AuthUser { id: string; username: string; roles: string[]; groups: string[]; }
export interface LoginResponse { token: string; user: { id: string; username: string; roles: string[]; groups: string[]; active: boolean; createdAt: string }; }
export interface MeResponse { user: AuthUser; permissions: string[]; }
