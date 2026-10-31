# Enterprise test catalogue

Every scenario an enterprise multi-tenant workflow platform should prove, where it is tested, and what is **not**
covered. Run everything with `npm test --workspace server` (≈ 300 tests, no external services; the 25 Java-sidecar
tests need a JDK and fail without one). IDs below are in the test titles, so `--test-name-pattern="EXE-3"` etc. work.

Legend: ✅ automated · 🟡 partly · ⛔ known gap (listed again at the end)

## 1. Sign-in surface (configuration-driven) — `auth-accounts.test.ts`, `oidc-sso.test.ts`
| ID | Scenario | |
|---|---|---|
| AUTH-CFG-01 | `/auth/config` reflects every flag (SSO, local login, registration, forgot-password, email verification, password policy); local-only features disappear when local login is off | ✅ |
| AUTH-CFG-02 | every disabled feature answers 404 on every endpoint | ✅ |
| AUTH-CFG-03 | local login off ⇒ already-issued local tokens are refused too | ✅ |
| oidc-sso | SSO: PKCE S256 + state + nonce, `client_secret_basic`, tokens only in the URL fragment, forged/missing transaction cookie, open-redirect `return_to`, logout via end-session, JWKS verification (wrong key/aud/iss/expired/alg-none/HS256-confusion) | ✅ |
| oidc-sso | claim-by-verified-email (unverified refused, bound seat never re-bound), platform admin only by verified email, SSO signup requires sign-in and ignores a free-text owner | ✅ |
| AUTH-REG-01…05 | register: normalised email, welcome mail, validation matrix, no roles / no workspace access, `x-tenant-id` cannot steer account creation, registering a victim's email does **not** grant their pending seat | ✅ |
| AUTH-VER-01…03 | email verification: blocked until verified, single use, expiry, resend rotates & never reveals existence, tokens hashed at rest, no secrets in `/users` | ✅ |
| AUTH-PWD-01…05 | forgot/reset: single use, expiry, old password dies, reuse refused, other sessions revoked, anti-enumeration, per-account throttle, unlocks account, deactivated user, change-own-password | ✅ |
| AUTH-LOCK-01/02 | lockout after N failures (even for the right password), expiry, notice mail, counter reset, unknown-user ≡ wrong-password | ✅ |
| AUTH-TOK-01 | tampered / alg-none / garbage / truncated / wrong-secret / no-scheme / token-in-query ⇒ 401 | ✅ |
| AUTH-POL-01 | password policy (length, identity, common, character classes, admin path) | ✅ |
| SEC-06 | per-IP login throttling | ✅ |
| — | real Identity Server round-trip (discovery matches; flow tested against a fake IdP) | 🟡 |

## 2. Email — `auth-accounts.test.ts` (MAIL-*)
| ID | Scenario | |
|---|---|---|
| MAIL-01 | all 16 templates (verification, reset, password-changed ×3, locked, welcome, workspace-created, invitation, invitation-accepted, role-changed, suspended/restored, removed, ownership ×2) render subject+text+HTML; links stay on `DASHBOARD_URL`; user input HTML-escaped | ✅ |
| MAIL-02 | CR/LF header injection neutralised | ✅ |
| MAIL-03 | full team lifecycle sends the right mails to the right people | ✅ |
| MAIL-04 | transport failure never breaks the triggering request | ✅ |
| MAIL-05 | with a transport, the invite token travels only by email (not in the API response); webhook payload verified | ✅ |
| — | real SMTP server delivery (nodemailer path is exercised only through the webhook/capture transports) | ⛔ |

## 3. Workspaces, switcher, membership — `enterprise-edge.test.ts`, `rbac-matrix.test.ts`, `tenant-isolation.test.ts`, `team.test.ts`
| ID | Scenario | |
|---|---|---|
| WS-01 | switcher lists exactly your workspaces with *your* role in each; no platform view for ordinary members | ✅ |
| WS-02 | same person: admin in A, viewer in B, nothing in C — enforced and reflected in `/me/profile` | ✅ |
| WS-03 | removal / demotion / suspension take effect on the next request and in the switcher | ✅ |
| WS-04 | suspended / pending / deleted workspace unusable for everyone incl. owner; hidden from switcher; reactivation restores | ✅ |
| WS-05 | invited / suspended seats are not "your workspaces"; shown as inactive memberships | ✅ |
| WS-06 | switcher search + limit over own workspaces only | ✅ |
| WS-07 | default workspace is not a free-for-all | ✅ |
| WS-08 | `x-tenant-id` abuse (empty, padded, case, huge, injection, wildcard, lists) ⇒ 403, never 500/other tenant | ✅ |
| WS-09 | signup race (exactly one wins), reserved / invalid / homoglyph slugs | ✅ |
| rbac-matrix | **every route × 7 roles × scopes** (none, non-member, suspended, other workspace, `all`, local admin): denied ⇒ exactly 403, allowed ⇒ never 401/403/5xx; UI permission list ≡ server permission set | ✅ |
| tenant-isolation | other workspace's ids probed on every id route; lists & analytics never include foreign rows | ✅ |
| oidc-sso | platform admin = the single fixed email; fake `system_admin` seat, first member, local admin confer nothing | ✅ |
| ws-auth / oidc-sso | WebSocket bound to one workspace, only that workspace's instance topics | ✅ |
| — | WS message delivery end-to-end over a real socket | ⛔ |

## 4. Team & invitations — `team.test.ts`, `enterprise-edge.test.ts` (INV-*)
| ID | Scenario | |
|---|---|---|
| team | invite → accept, hashed token, expiry, single use, owner/admin/member hierarchy (`canManage`), assignable roles, no second owner, suspend/reinstate, resend/cancel, leave, ownership transfer (+ former owner demoted), cross-workspace member ids ⇒ 404 | ✅ |
| INV-01 | normalisation, re-invite rotates token, admin cannot invite admin, unknown role, non-member / anonymous cannot invite | ✅ |
| INV-02 | invited to several workspaces: a role per workspace, tokens not interchangeable | ✅ |
| INV-03 | leaked token + wrong / unverified mailbox refused; seat stays pending | ✅ |
| INV-04 | cancelled token dead; invited seat cannot act | ✅ |

## 5. Executions — `execution-matrix.test.ts` (EXE-*) driven through the HTTP API as real roles
| ID | Execution type | |
|---|---|---|
| EXE-01/02/03 | script task; who may start (`workflow:run`) vs only view; start edge cases (unknown workflow/deployment/env, malformed/huge body, archived deployment) | ✅ |
| EXE-10…13 | user task: claim → start → save → complete; **ownership** (only owner/admin may complete/save/release/delegate/forward; no claim-stealing); racing completions ⇒ exactly one wins; manual task | ✅ |
| EXE-20…23 | exclusive, parallel, inclusive, event-based gateways | ✅ |
| EXE-30…32 | catch timer, boundary timer (interrupting + non-interrupting), timers tenant-scoped | ✅ |
| EXE-40/41 | signal catch (wrong name ignored, viewers refused); signal throw never crosses workspaces | ✅ |
| EXE-50…52 | embedded subprocess, call activity (+ cannot call another workspace's process), multi-instance sequential & parallel | ✅ |
| EXE-60…62 | business-rule (DMN) task, HTTP service task (success / failure recorded), SSRF blocked (metadata, loopback, link-local, private, `file:`) | ✅ |
| EXE-70/71 | failure → recorded → ack → fix → retry; error boundary, error end event | ✅ |
| EXE-80…82 | suspend/resume, abort, terminal-state control, variable edits, deployment lifecycle by role | ✅ |
| EXE-90…92 | quotas per workspace (no bleed), sandbox infinite loop & direct globals, 25 concurrent starts | ✅ |
| EXE-95/96 | other workspace can neither see nor drive any of it; analytics per workspace | ✅ |
| EXE-97 | case management: definition/instance roles, isolation, no audit on non-existent case | ✅ |
| POOL-7…11 | overflow mode: reject (2000-burst, limit 50 → exactly 50 run/1950 refused instantly), queue (all 2000 ok, ≤50 concurrent), small queue/short wait errors, effective concurrency + workspace-over-env + invalid value, mixed-mode workspaces, pool healthy after reject burst | ✅ |
| POOL-1…6 | isolate pool: no state leak between scripts/tenants, 2000-burst bounded, queue overflow/timeout, recycle on timeout/OOM, idle eviction, fair under a global ceiling | ✅ |
| EXE-91b | **sandbox escape via constructor chains** | ✅ |
| engine-*.test.ts | 30 files of engine semantics (cascades, compensation, messaging, DMN import, java sidecar…) | ✅ (java needs JDK) |

## 6. Hostile input, headers, audit, config — `enterprise-edge.test.ts`
SEC-01 mass assignment · SEC-02 prototype pollution · SEC-03 malformed bodies ⇒ 4xx, no stack traces · SEC-04 operator injection in login ·
SEC-05 security headers & CORS preflight · SEC-07 no secrets in responses · AUD-01 audit trail scoped per workspace · CFG-01 landing/sign-in render from public endpoints only. ✅

## 7. Gaps — stated plainly
1. ⛔ No browser-driven end-to-end tests of the Angular screens (verified manually: login, team page, invite). The permission *logic* behind the UI is covered by the parity test in `rbac-matrix`.
2. ⛔ No load / soak / failover tests; rate limiting and WebSocket hub are single-process in-memory.
3. ⛔ Postgres store (`test:pg`) is not exercised by this suite.
4. ⛔ Real SMTP and real Identity Server round-trips are not automated (fakes/capture are).
5. 🟡 Task *group* membership is enforced only for IAM-provisioned users; workspace members (SSO) are authorised by role, not by task group.
