// Mirrors the backend's JWT claims (server/src/infra/auth.ts's JwtClaims) and /auth/login,/auth/me
// response shapes (server/src/http/auth-routes.ts).
export interface JwtClaims { sub: string; username?: string; roles?: string[]; groups?: string[]; email?: string; name?: string; preferred_username?: string; exp: number; iat: number; }
export interface AuthUser { id: string; username: string; roles: string[]; groups: string[]; email?: string; name?: string; }
/** GET /auth/config — which sign-in methods the server offers. */
export interface AuthConfig {
  appName: string; sso: boolean; localLogin: boolean; registration: boolean; forgotPassword: boolean;
  emailVerification: boolean; passwordMinLength: number; ssoLoginUrl: string | null;
  registrationMethod: 'temp_password' | 'password'; tempPasswordHours: number; otpLogin: boolean; tosUrl: string | null;
}
/** what a credential check yields: a session, or — for an account still on its emailed temporary password — the set-password step */
export type LoginOutcome = { kind: 'session'; user: AuthUser } | { kind: 'setup'; setupToken: string; email?: string };
export type LoginResponse =
  | { token: string; user: { id: string; username: string; roles: string[]; groups: string[]; active: boolean; createdAt: string } }
  | { passwordSetupRequired: true; setupToken: string; user: { email?: string; displayName?: string } };
export interface MeResponse { user: AuthUser; permissions: string[]; }
