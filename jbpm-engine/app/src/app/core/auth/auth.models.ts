// Mirrors the backend's JWT claims (server/src/infra/auth.ts's JwtClaims) and /auth/login,/auth/me
// response shapes (server/src/http/auth-routes.ts).
export interface JwtClaims { sub: string; username?: string; roles?: string[]; groups?: string[]; email?: string; name?: string; preferred_username?: string; exp: number; iat: number; }
export interface AuthUser { id: string; username: string; roles: string[]; groups: string[]; email?: string; name?: string; }
/** GET /auth/config — which sign-in methods the server offers. */
export interface AuthConfig { sso: boolean; localLogin: boolean; ssoLoginUrl: string | null; }
export interface LoginResponse { token: string; user: { id: string; username: string; roles: string[]; groups: string[]; active: boolean; createdAt: string }; }
export interface MeResponse { user: AuthUser; permissions: string[]; }
