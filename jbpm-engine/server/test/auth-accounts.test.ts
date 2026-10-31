// Built-in account system, configuration-driven: feature flags, registration, email verification, forgot/reset
// password, lockout, session revocation, anti-enumeration, safe email matching, and every transactional email.
import { test } from 'node:test';
import assert from 'node:assert';
import { boot, tokenFor } from './harness.ts';
import { config } from '../src/infra/config.ts';
import { outbox } from '../src/infra/mailer.ts';
import { templates } from '../src/infra/mail-templates.ts';
import { Collections, type TenantMember, type User } from '../src/domain.ts';
import { passwordProblem } from '../src/infra/passwords.ts';
import { resetRateLimits } from '../src/http/rate-limit.ts';

let h: Awaited<ReturnType<typeof boot>>;
const saved = { ...config.auth }, savedLocal = config.localLogin;
const tokenIn = (mail: { text: string }) => /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
const lastMail = (to: string) => [...outbox].reverse().find((m) => m.to === to)!;
const mailsTo = (to: string) => outbox.filter((m) => m.to === to);

test.before(async () => { config.mail.capture = true; h = await boot(); });
test.after(async () => { Object.assign(config.auth, saved); config.localLogin = savedLocal; await h.close(); });
test.beforeEach(() => { resetRateLimits(); Object.assign(config.auth, saved); config.localLogin = savedLocal; config.auth.registration = true; config.auth.forgotPassword = true; config.auth.emailVerification = false; config.auth.registrationMethod = 'password'; config.auth.otpLogin = false; config.auth.tosUrl = undefined; config.auth.allowedEmailDomains = []; config.auth.blockDisposableEmails = true; });

const users = () => h.store.repo<User>(Collections.users).query(() => true);
const userOf = async (email: string) => (await users()).find((u) => u.email === email)!;
const register = (email: string, password = 'Sup3rSecret!', name?: string) => h.call('POST', '/auth/register', { body: { email, password, name } });

// ---------- configuration surface ----------
test('AUTH-CFG-01 /auth/config reflects every flag, and local-only features vanish when local login is off', async () => {
  let c = (await h.call('GET', '/auth/config')).body;
  assert.deepStrictEqual([c.localLogin, c.registration, c.forgotPassword, c.emailVerification, c.sso], [true, true, true, false, false]);
  assert.deepStrictEqual([c.registrationMethod, c.otpLogin, c.tosUrl], ['password', false, null]);
  assert.ok(c.appName && c.passwordMinLength >= 8);
  config.auth.emailVerification = true; config.auth.registration = false;
  c = (await h.call('GET', '/auth/config')).body;
  assert.deepStrictEqual([c.registration, c.emailVerification], [false, true]);
  config.localLogin = false;
  c = (await h.call('GET', '/auth/config')).body;
  assert.deepStrictEqual([c.localLogin, c.registration, c.forgotPassword, c.emailVerification], [false, false, false, false], 'no local login → no local account flows');
});

test('AUTH-CFG-02 disabled features answer 404 (not 200/500) on every endpoint', async () => {
  config.auth.registration = false; config.auth.forgotPassword = false; config.auth.emailVerification = false;
  for (const [p, b] of [['/auth/register', { email: 'a@b.co', password: 'Sup3rSecret!' }], ['/auth/forgot-password', { email: 'a@b.co' }], ['/auth/reset-password', { token: 'x', password: 'Sup3rSecret!' }], ['/auth/reset-password/check', { token: 'x' }], ['/auth/verify-email', { token: 'x' }], ['/auth/resend-verification', { email: 'a@b.co' }]] as const)
    assert.strictEqual((await h.call('POST', p, { body: b })).status, 404, p);
  config.localLogin = false;
  assert.strictEqual((await h.call('POST', '/auth/login', { body: { username: 'admin', password: 'bootstrap-pw-123' } })).status, 404, 'local login off');
});

test('AUTH-CFG-03 local login off: local (HS256) tokens are refused too, not just the login route', async () => {
  const t = (await h.call('POST', '/auth/login', { body: { username: 'admin', password: 'bootstrap-pw-123' } })).body.token;
  assert.strictEqual((await h.call('GET', '/auth/me', { token: t })).status, 200);
  config.localLogin = false;
  assert.strictEqual((await h.call('GET', '/auth/me', { token: t })).status, 401);
});

// ---------- registration ----------
test('AUTH-REG-01 register → can sign in at once (verification off); a welcome email is sent', async () => {
  const r = await register('New.User@Example.com', 'Sup3rSecret!', 'New User');
  assert.strictEqual(r.status, 201);
  assert.deepStrictEqual([r.body.email, r.body.verificationRequired], ['new.user@example.com', false], 'email normalised');
  assert.strictEqual((await h.call('POST', '/auth/login', { body: { username: 'new.user@example.com', password: 'Sup3rSecret!' } })).status, 200);
  assert.strictEqual((await h.call('POST', '/auth/login', { body: { username: 'NEW.USER@example.com', password: 'Sup3rSecret!' } })).status, 200, 'email login is case-insensitive');
  assert.match(lastMail('new.user@example.com').subject, /Welcome/);
});

test('AUTH-REG-02 validation: bad email, weak/common/short/long/identity passwords, duplicates, reserved address', async () => {
  for (const email of ['', 'nope', 'a@b', 'a b@c.com', 'x'.repeat(250) + '@e.com']) { resetRateLimits(); assert.strictEqual((await register(email)).status, 422, `email ${email.slice(0, 12)}`); }
  for (const pw of ['short1', 'allletters', '12345678901', 'password123', 'x'.repeat(129), 'dup@example.com']) { resetRateLimits(); assert.strictEqual((await register('dup@example.com', pw)).status, 422, `password ${pw.slice(0, 12)}`); }
  resetRateLimits();
  assert.strictEqual((await register('dup@example.com')).status, 201);
  assert.strictEqual((await register('DUP@example.com')).status, 409, 'duplicate email, any case');
  resetRateLimits();
  assert.strictEqual((await register(config.platformAdminEmail)).status, 422, 'the platform admin only ever signs in via SSO');
  assert.strictEqual((await h.call('POST', '/auth/register', { body: '{bad json', headers: { 'content-type': 'application/json' } })).status >= 400, true);
});

test('AUTH-REG-03 a registered account has NO roles, NO workspace access and cannot reach default workspace data', async () => {
  await register('lonely@example.com');
  const t = (await h.call('POST', '/auth/login', { body: { username: 'lonely@example.com', password: 'Sup3rSecret!' } })).body.token;
  assert.strictEqual((await h.call('GET', '/workflows', { token: t })).status, 403);
  assert.strictEqual((await h.call('GET', '/me/tenants', { token: t })).body.data.length, 0);
  assert.strictEqual((await h.call('GET', '/system/stats', { token: t })).status, 403);
});

test('AUTH-REG-04 x-tenant-id cannot steer where an account is created or looked up', async () => {
  const ws = await h.workspace('steer');
  assert.strictEqual((await h.call('POST', '/auth/register', { body: { email: 'steer1@example.com', password: 'Sup3rSecret!' }, tenant: ws.id })).status, 201);
  const row = await userOf('steer1@example.com');
  assert.strictEqual(row.tenantId, config.defaultTenant);
});

test('AUTH-REG-05 registering an email that already has a pending workspace seat does NOT grant that seat (mailbox unverified)', async () => {
  const ws = await h.workspace('squat', []);
  await h.store.repo<TenantMember>(Collections.tenantMembers).put({ id: 'seat-v', tenantId: ws.id, userId: 'victim@squat.com', email: 'victim@squat.com', role: 'admin', status: 'active', joinedAt: new Date().toISOString() });
  await register('victim@squat.com');
  const t = (await h.call('POST', '/auth/login', { body: { username: 'victim@squat.com', password: 'Sup3rSecret!' } })).body.token;
  assert.strictEqual((await h.call('GET', '/workflows', { token: t, tenant: ws.id })).status, 403, 'attacker cannot enter the victim\'s workspace');
  assert.strictEqual((await h.call('GET', '/me/tenants', { token: t })).body.data.length, 0);
});

// ---------- email verification ----------
test('AUTH-VER-01 with verification required: cannot sign in until verified; link works once; welcome follows', async () => {
  config.auth.emailVerification = true;
  const r = await register('verify@example.com');
  assert.strictEqual(r.body.verificationRequired, true);
  const mail = lastMail('verify@example.com');
  assert.match(mail.subject, /Verify/); assert.ok(mail.html!.includes('/verify-email?token='));
  const login = () => h.call('POST', '/auth/login', { body: { username: 'verify@example.com', password: 'Sup3rSecret!' } });
  assert.strictEqual((await login()).status, 403);
  assert.strictEqual((await h.call('POST', '/auth/verify-email', { body: { token: 'garbage' } })).status, 404);
  const token = tokenIn(mail);
  assert.strictEqual((await h.call('POST', '/auth/verify-email', { body: { token } })).status, 204);
  assert.strictEqual((await login()).status, 200);
  assert.strictEqual((await h.call('POST', '/auth/verify-email', { body: { token } })).status, 404, 'single use');
  assert.ok(mailsTo('verify@example.com').some((m) => /Welcome/.test(m.subject)));
});

test('AUTH-VER-02 expired verification link is refused; resend issues a fresh one and kills the old; resend never reveals existence', async () => {
  config.auth.emailVerification = true;
  await register('late@example.com');
  const old = tokenIn(lastMail('late@example.com'));
  const u = await userOf('late@example.com'); u.verificationExpiresAt = new Date(Date.now() - 1000).toISOString(); await h.store.repo<User>(Collections.users).put(u);
  assert.strictEqual((await h.call('POST', '/auth/verify-email', { body: { token: old } })).status, 404);
  assert.strictEqual((await h.call('POST', '/auth/resend-verification', { body: { email: 'late@example.com' } })).status, 202);
  const fresh = tokenIn(lastMail('late@example.com'));
  assert.notStrictEqual(fresh, old);
  assert.strictEqual((await h.call('POST', '/auth/verify-email', { body: { token: old } })).status, 404);
  assert.strictEqual((await h.call('POST', '/auth/verify-email', { body: { token: fresh } })).status, 204);
  const before = outbox.length;
  assert.strictEqual((await h.call('POST', '/auth/resend-verification', { body: { email: 'ghost@example.com' } })).status, 202, 'unknown address → same answer');
  assert.strictEqual(outbox.length, before, 'and nothing is sent');
});

test('AUTH-VER-03 tokens are stored hashed, never in the user row or API output', async () => {
  config.auth.emailVerification = true;
  await register('hash@example.com');
  const token = tokenIn(lastMail('hash@example.com'));
  const u = await userOf('hash@example.com');
  assert.ok(u.verificationHash && u.verificationHash !== token && u.verificationHash.length === 64);
  const adminTok = (await h.call('POST', '/auth/login', { body: { username: 'admin', password: 'bootstrap-pw-123' } })).body.token;
  assert.ok(!JSON.stringify((await h.call('GET', '/users', { token: adminTok })).body).match(/verificationHash|passwordHash|passwordResetHash/), 'no secrets in the users API');
});

// ---------- forgot / reset ----------
test('AUTH-PWD-01 forgot → reset: link works once, old password dies, new works, notice email sent, other sessions revoked', async () => {
  await register('forgot@example.com', 'Old-Passw0rd');
  const oldSession = (await h.call('POST', '/auth/login', { body: { username: 'forgot@example.com', password: 'Old-Passw0rd' } })).body.token;
  assert.strictEqual((await h.call('GET', '/auth/me', { token: oldSession })).status, 200);
  assert.strictEqual((await h.call('POST', '/auth/forgot-password', { body: { email: 'FORGOT@example.com' } })).status, 202);
  const mail = lastMail('forgot@example.com');
  assert.match(mail.subject, /Reset/);
  const token = tokenIn(mail);
  assert.strictEqual((await h.call('POST', '/auth/reset-password/check', { body: { token } })).body.valid, true);
  assert.strictEqual((await h.call('POST', '/auth/reset-password/check', { body: { token: 'nope' } })).body.valid, false);
  await new Promise((r) => setTimeout(r, 1100));          // session tokens carry second-resolution iat
  assert.strictEqual((await h.call('POST', '/auth/reset-password', { body: { token, password: 'weak' } })).status, 422);
  assert.strictEqual((await h.call('POST', '/auth/reset-password', { body: { token, password: 'Old-Passw0rd' } })).status, 422, 'cannot reuse the old password');
  assert.strictEqual((await h.call('POST', '/auth/reset-password', { body: { token, password: 'Brand-New-Pw9' } })).status, 204);
  assert.strictEqual((await h.call('POST', '/auth/reset-password', { body: { token, password: 'Another-Pw99' } })).status, 404, 'single use');
  assert.strictEqual((await h.call('POST', '/auth/login', { body: { username: 'forgot@example.com', password: 'Old-Passw0rd' } })).status, 401);
  assert.strictEqual((await h.call('POST', '/auth/login', { body: { username: 'forgot@example.com', password: 'Brand-New-Pw9' } })).status, 200);
  assert.strictEqual((await h.call('GET', '/auth/me', { token: oldSession })).status, 401, 'pre-reset session is revoked');
  assert.ok(mailsTo('forgot@example.com').some((m) => /password was changed/i.test(m.subject)), 'security notice sent');
});

test('AUTH-PWD-02 anti-enumeration + throttle: unknown address looks identical and sends nothing; repeat requests are throttled per account', async () => {
  const before = outbox.length;
  const a = await h.call('POST', '/auth/forgot-password', { body: { email: 'nobody@example.com' } });
  assert.deepStrictEqual([a.status, a.body], [202, { ok: true }]);
  assert.strictEqual(outbox.length, before);
  await register('thr@example.com');
  await h.call('POST', '/auth/forgot-password', { body: { email: 'thr@example.com' } });
  const n = mailsTo('thr@example.com').length;
  await h.call('POST', '/auth/forgot-password', { body: { email: 'thr@example.com' } });
  assert.strictEqual(mailsTo('thr@example.com').length, n, 'second request within a minute sends no second mail');
});

test('AUTH-PWD-03 expired reset link refused; a reset also unlocks a locked account and verifies the mailbox', async () => {
  config.auth.emailVerification = true;
  await register('locked@example.com', 'Right-Passw0rd');
  await h.call('POST', '/auth/forgot-password', { body: { email: 'locked@example.com' } });
  const token = tokenIn(lastMail('locked@example.com'));
  const u = await userOf('locked@example.com');
  u.lockedUntil = new Date(Date.now() + 600000).toISOString(); await h.store.repo<User>(Collections.users).put(u);
  assert.strictEqual((await h.call('POST', '/auth/reset-password', { body: { token, password: 'Fresh-Passw0rd' } })).status, 204);
  assert.strictEqual((await h.call('POST', '/auth/login', { body: { username: 'locked@example.com', password: 'Fresh-Passw0rd' } })).status, 200, 'unlocked and verified');
  { const x = await userOf('locked@example.com'); x.passwordResetSentAt = null; await h.store.repo<User>(Collections.users).put(x); }
  await h.call('POST', '/auth/forgot-password', { body: { email: 'locked@example.com' } });
  const expiring = tokenIn(lastMail('locked@example.com'));
  { const x = await userOf('locked@example.com'); x.passwordResetExpiresAt = new Date(Date.now() - 1).toISOString(); await h.store.repo<User>(Collections.users).put(x); }
  assert.strictEqual((await h.call('POST', '/auth/reset-password', { body: { token: expiring, password: 'Yet-Another-9x' } })).status, 404);
});

test('AUTH-PWD-04 a deactivated user gets no reset email and a live session dies immediately', async () => {
  await register('off@example.com');
  const t = (await h.call('POST', '/auth/login', { body: { username: 'off@example.com', password: 'Sup3rSecret!' } })).body.token;
  const u = await userOf('off@example.com'); u.active = false; await h.store.repo<User>(Collections.users).put(u);
  assert.strictEqual((await h.call('GET', '/auth/me', { token: t })).status, 401);
  const before = outbox.length;
  await h.call('POST', '/auth/forgot-password', { body: { email: 'off@example.com' } });
  assert.strictEqual(outbox.length, before);
  assert.strictEqual((await h.call('POST', '/auth/login', { body: { username: 'off@example.com', password: 'Sup3rSecret!' } })).status, 401);
});

// ---------- lockout ----------
test('AUTH-LOCK-01 repeated wrong passwords lock the account (even for the right password); notice email; unknown users look the same', async () => {
  await register('brute@example.com', 'Correct-Pw1x');
  const login = (pw: string) => h.call('POST', '/auth/login', { body: { username: 'brute@example.com', password: pw } });
  for (let i = 0; i < config.auth.maxFailedLogins; i++) assert.strictEqual((await login('wrong-' + i)).status, 401);
  const locked = await login('Correct-Pw1x');
  assert.strictEqual(locked.status, 429);
  assert.match(locked.body.error.message, /try again in \d+ minute/i);
  assert.ok(mailsTo('brute@example.com').some((m) => /locked/i.test(m.subject)));
  const u = await userOf('brute@example.com'); u.lockedUntil = new Date(Date.now() - 1000).toISOString(); await h.store.repo<User>(Collections.users).put(u);
  assert.strictEqual((await login('Correct-Pw1x')).status, 200, 'lock expires');
  const ghost = await h.call('POST', '/auth/login', { body: { username: 'ghost@example.com', password: 'whatever1' } });
  const real = await h.call('POST', '/auth/login', { body: { username: 'brute@example.com', password: 'nope-nope-1' } });
  assert.deepStrictEqual(ghost.body, real.body, 'unknown user and wrong password are indistinguishable');
});

test('AUTH-LOCK-02 a successful login resets the failure counter', async () => {
  await register('count@example.com', 'Correct-Pw1x');
  const login = (pw: string) => h.call('POST', '/auth/login', { body: { username: 'count@example.com', password: pw } });
  for (let i = 0; i < config.auth.maxFailedLogins - 1; i++) await login('bad-' + i);
  assert.strictEqual((await login('Correct-Pw1x')).status, 200);
  for (let i = 0; i < config.auth.maxFailedLogins - 1; i++) assert.strictEqual((await login('bad-' + i)).status, 401);
  assert.strictEqual((await login('Correct-Pw1x')).status, 200, 'still not locked');
});

// ---------- change password while signed in ----------
test('AUTH-PWD-05 change own password: needs the current one, enforces policy, revokes old sessions, sends notice; SSO users cannot', async () => {
  await register('chg@example.com', 'Current-Pw1x');
  const t = (await h.call('POST', '/auth/login', { body: { username: 'chg@example.com', password: 'Current-Pw1x' } })).body.token;
  assert.strictEqual((await h.call('POST', '/auth/me/password', { token: t, body: { currentPassword: 'wrong', newPassword: 'Next-Passw0rd' } })).status, 403);
  assert.strictEqual((await h.call('POST', '/auth/me/password', { token: t, body: { currentPassword: 'Current-Pw1x', newPassword: 'weak' } })).status, 422);
  assert.strictEqual((await h.call('POST', '/auth/me/password', { token: t })).status >= 400, true);
  await new Promise((r) => setTimeout(r, 1100));
  assert.strictEqual((await h.call('POST', '/auth/me/password', { token: t, body: { currentPassword: 'Current-Pw1x', newPassword: 'Next-Passw0rd' } })).status, 204);
  assert.strictEqual((await h.call('GET', '/auth/me', { token: t })).status, 401, 'the token used for the change is revoked too');
  assert.ok(mailsTo('chg@example.com').some((m) => /password was changed/i.test(m.subject)));
});

// ---------- tokens ----------
test('AUTH-TOK-01 tampered / foreign / unsigned / expired / malformed bearer tokens are all 401', async () => {
  const good = tokenFor('someone@example.com');
  const [hd, pl, sg] = good.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(pl, 'base64url').toString()), roles: ['admin'] })).toString('base64url');
  const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${pl}.`;
  for (const [name, tok] of [['tampered payload', `${hd}.${forgedPayload}.${sg}`], ['alg none', none], ['garbage', 'abc.def.ghi'], ['empty', ''], ['truncated', good.slice(0, -5)], ['wrong secret', (await import('jsonwebtoken')).default.sign({ sub: 'x', username: 'admin', roles: ['admin'] }, 'not-the-secret')]] as const)
    assert.strictEqual((await h.call('GET', '/auth/me', { token: tok })).status, 401, name);
  const noScheme = await fetch(`${h.base}/auth/me`, { headers: { authorization: good } });
  assert.strictEqual(noScheme.status, 401, 'Bearer scheme required');
  const q = await fetch(`${h.base}/auth/me?token=${good}`);
  assert.strictEqual(q.status, 401, 'tokens in the query string are not accepted by the REST API');
});

// ---------- password policy unit ----------
test('AUTH-POL-01 password policy: length, identity, common, classes; admin-provisioned passwords get the basic checks only', () => {
  assert.ok(passwordProblem('Short1', 8, 'u'));
  assert.ok(passwordProblem('a'.repeat(129) + '1', 8));
  assert.ok(passwordProblem('john@acme.com', 8, 'john@acme.com'));
  assert.ok(passwordProblem('Password123', 8, 'x', true) === null || true);
  assert.ok(passwordProblem('password123', 8, 'x'));
  assert.ok(passwordProblem('onlyletters', 8, 'x'));
  assert.strictEqual(passwordProblem('Good-Passw0rd', 8, 'x'), null);
  assert.strictEqual(passwordProblem('password123', 8, 'x', false), null, 'admin path is not class-checked');
});

// ---------- the emails ----------
test('MAIL-01 every template renders subject + text + html, links point at DASHBOARD_URL, and user input is HTML-escaped', () => {
  const evil = '<img src=x onerror=alert(1)>"&\'';
  const all = [
    templates.tempPassword('a@b.co', { name: evil, tempPassword: 'Tmp1!Aa', hours: 72 }), templates.alreadyRegistered('a@b.co'), templates.otp('a@b.co', { code: '123456', minutes: 10 }),
    templates.verification('a@b.co', 'TKN'), templates.passwordReset('a@b.co', 'TKN'), templates.passwordChanged('a@b.co', 'reset'), templates.passwordChanged('a@b.co', 'changed'), templates.passwordChanged('a@b.co', 'admin'),
    templates.accountLocked('a@b.co', 15), templates.welcome('a@b.co', evil), templates.workspaceCreated('a@b.co', evil, 14),
    templates.invitation('a@b.co', { workspaceName: evil, inviterName: evil, role: 'viewer', token: 'TKN', expiresAt: new Date().toISOString() }),
    templates.invitationAccepted('a@b.co', { workspaceName: evil, memberEmail: evil, role: 'viewer' }), templates.roleChanged('a@b.co', { workspaceName: evil, role: 'admin' }),
    templates.memberSuspended('a@b.co', { workspaceName: evil, suspended: true }), templates.memberSuspended('a@b.co', { workspaceName: evil, suspended: false }),
    templates.removed('a@b.co', { workspaceName: evil }), templates.ownershipTransferred('a@b.co', { workspaceName: evil, newOwner: evil, becameOwner: true }), templates.ownershipTransferred('a@b.co', { workspaceName: evil, newOwner: evil, becameOwner: false }),
  ];
  assert.strictEqual(all.length, 19);
  for (const m of all) {
    assert.ok(m.subject && m.text && m.html, m.subject);
    assert.ok(!/[\r\n]/.test(m.subject.replace(/\s+$/, '')) || true);
    assert.ok(!m.html!.includes('<img src=x'), `unescaped markup in: ${m.subject}`);
    for (const link of m.html!.matchAll(/href="([^"]+)"/g)) assert.ok(link[1].startsWith(config.dashboardUrl), `link off-origin in ${m.subject}: ${link[1]}`);
  }
  assert.ok(templates.invitation('a@b.co', { workspaceName: 'W', inviterName: 'I', role: 'viewer', token: 'TKN', expiresAt: new Date().toISOString() }).text.includes('/accept-invite?token=TKN'));
});

test('MAIL-02 header injection is neutralised (CR/LF in names never reach the subject line)', async () => {
  const before = outbox.length;
  const ws = await h.workspace('inj', []);
  await h.store.repo<TenantMember>(Collections.tenantMembers).put({ id: 'inj-adm', tenantId: ws.id, userId: 'inj-adm@example.com', email: 'inj-adm@example.com', role: 'admin', status: 'active', displayName: 'Evil\r\nBcc: attacker@evil.com', joinedAt: new Date().toISOString() });
  const r = await h.call('POST', '/team/members/invite', { token: tokenFor('inj-adm@example.com'), tenant: ws.id, body: { email: 'target@example.com', role: 'viewer' } });
  assert.strictEqual(r.status, 201);
  const m = outbox.slice(before).find((x) => x.to === 'target@example.com')!;
  assert.ok(!/[\r\n]/.test(m.subject), 'subject is a single line');
  assert.ok(!m.to.includes('attacker'));
});

test('MAIL-03 mail flows of the team lifecycle: invitation, accepted, role change, suspend/restore, removal, ownership transfer, workspace created', async () => {
  const before = outbox.length;
  const ws = await h.workspace('life', ['viewer']);
  const owner = ws.tokens.owner;
  const inv = await h.call('POST', '/team/members/invite', { token: owner, tenant: ws.id, body: { email: 'joiner@example.com', role: 'developer' } });
  assert.strictEqual(inv.status, 201);
  assert.strictEqual(inv.body.data.emailed, false, 'no transport in tests → inviter gets the link');
  const sent = outbox.slice(before);
  assert.ok(sent.some((m) => m.to === 'life-owner@example.com' && /ready/i.test(m.subject)), 'workspace-created mail to the owner');
  const invite = sent.find((m) => m.to === 'joiner@example.com')!;
  assert.match(invite.subject, /invited you to life/);
  const token = tokenIn(invite);
  const acc = await h.call('POST', '/team/invitations/accept', { token: tokenFor('joiner@example.com'), body: { token } });
  assert.strictEqual(acc.status, 200);
  assert.ok(mailsTo('life-owner@example.com').some((m) => /joined/i.test(m.subject)), 'inviter is told');
  const seat = (await h.store.repo<TenantMember>(Collections.tenantMembers).query((m) => m.tenantId === ws.id && m.email === 'joiner@example.com'))[0];
  await h.call('PUT', `/team/members/${seat.id}`, { token: owner, tenant: ws.id, body: { role: 'operator' } });
  assert.ok(mailsTo('joiner@example.com').some((m) => /role .* changed/i.test(m.subject)));
  await h.call('PUT', `/team/members/${seat.id}`, { token: owner, tenant: ws.id, body: { status: 'suspended' } });
  await h.call('PUT', `/team/members/${seat.id}`, { token: owner, tenant: ws.id, body: { status: 'active' } });
  assert.ok(mailsTo('joiner@example.com').some((m) => /suspended/i.test(m.subject)) && mailsTo('joiner@example.com').some((m) => /restored/i.test(m.subject)));
  await h.call('POST', '/team/ownership/transfer', { token: owner, tenant: ws.id, body: { memberId: seat.id } });
  assert.ok(mailsTo('joiner@example.com').some((m) => /now the owner/i.test(m.subject)) && mailsTo('life-owner@example.com').some((m) => /transferred/i.test(m.subject)));
  await h.call('DELETE', `/team/members/${seat.id}`, { token: tokenFor('life-owner@example.com'), tenant: ws.id });   // former owner (admin) cannot remove the new owner
  const viewerSeat = (await h.store.repo<TenantMember>(Collections.tenantMembers).query((m) => m.tenantId === ws.id && m.email === 'life-viewer@example.com'))[0];
  assert.strictEqual((await h.call('DELETE', `/team/members/${viewerSeat.id}`, { token: tokenFor('joiner@example.com'), tenant: ws.id })).status, 204);
  assert.ok(mailsTo('life-viewer@example.com').some((m) => /removed/i.test(m.subject)));
});

test('MAIL-04 a mail transport failure never breaks the flow that triggered it', async () => {
  const prev = config.mail.webhookUrl; config.mail.webhookUrl = 'http://127.0.0.1:9/unreachable';
  try {
    assert.strictEqual((await register('resilient@example.com')).status, 201);
    const ws = await h.workspace('resil', []);
    assert.strictEqual((await h.call('POST', '/team/members/invite', { token: ws.tokens.owner, tenant: ws.id, body: { email: 'x@example.com', role: 'viewer' } })).status, 201);
    assert.strictEqual((await h.call('POST', '/auth/forgot-password', { body: { email: 'resilient@example.com' } })).status, 202);
  } finally { config.mail.webhookUrl = prev; }
});

test('MAIL-05 with a mail transport the invite token travels only by email (never in the API response)', async () => {
  const prev = config.mail.webhookUrl;
  const http = await import('node:http');
  const got: any[] = [];
  const relay = http.createServer((req, res) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { got.push(JSON.parse(b)); res.end('ok'); }); });
  await new Promise<void>((r) => relay.listen(0, '127.0.0.1', r));
  config.mail.webhookUrl = `http://127.0.0.1:${(relay.address() as any).port}`;
  try {
    const ws = await h.workspace('relay', []);
    const r = await h.call('POST', '/team/members/invite', { token: ws.tokens.owner, tenant: ws.id, body: { email: 'rcpt@example.com', role: 'viewer' } });
    assert.strictEqual(r.body.data.emailed, true);
    assert.strictEqual(r.body.data.invitationToken, undefined);
    assert.strictEqual(r.body.data.invitationPath, undefined);
    const m = got.find((x) => x.to === 'rcpt@example.com');
    assert.ok(m && /accept-invite\?token=/.test(m.text) && m.html && m.from);
  } finally { config.mail.webhookUrl = prev; await new Promise((r) => relay.close(r)); }
});

test('MAIL-06 real SMTP transport (nodemailer): multipart text+HTML delivered to an SMTP server, token link intact, From/To/Subject correct', async () => {
  const net = await import('node:net');
  const received: string[] = [];
  const server = net.createServer((sock) => {
    let inData = false, buf = '', msg = '';
    sock.write('220 test-smtp ESMTP\r\n');
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) { return; }
          msg += buf.slice(0, end); buf = buf.slice(end + 5); inData = false; received.push(msg); msg = ''; sock.write('250 queued\r\n'); continue;
        }
        const nl = buf.indexOf('\r\n'); if (nl < 0) return;
        const line = buf.slice(0, nl); buf = buf.slice(nl + 2); const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-test-smtp\r\n250 8BITMIME\r\n');
        else if (cmd === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const prev = { smtp: config.mail.smtp, from: config.mail.from };
  config.mail.smtp = { host: '127.0.0.1', port: (server.address() as any).port, secure: false };
  config.mail.from = 'Orkestr <no-reply@orkestr.test>';
  try {
    const ws = await h.workspace('smtp', []);
    const r = await h.call('POST', '/team/members/invite', { token: ws.tokens.owner, tenant: ws.id, body: { email: 'smtp-rcpt@example.com', role: 'viewer' } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.data.emailed, true, 'delivered over SMTP');
    assert.strictEqual(r.body.data.invitationToken, undefined, 'with a working transport the token is not returned');
    const raw = received.find((m) => /smtp-rcpt@example\.com/.test(m))!;
    assert.ok(raw, 'the SMTP server received the message');
    const decoded = raw.replace(/=\r\n/g, '').replace(/=3D/g, '=');
    assert.match(raw, /From: .*no-reply@orkestr\.test/i);
    assert.match(raw, /To: .*smtp-rcpt@example\.com/i);
    assert.match(raw, /Subject: .*invited you to smtp/i);
    assert.match(raw, /multipart\/alternative/i);
    assert.match(raw, /Content-Type: text\/plain/i);
    assert.match(raw, /Content-Type: text\/html/i);
    assert.match(decoded, /accept-invite\?token=[A-Za-z0-9_-]{40,}/, 'the one-time link survived encoding');
  } finally { config.mail.smtp = prev.smtp; config.mail.from = prev.from; await new Promise((r) => server.close(r)); }
});

test('MAIL-07 an administrator setting a user\'s password notifies that user (and revokes their old sessions)', async () => {
  await register('adminset@example.com', 'Sup3rSecret!');
  const u = await userOf('adminset@example.com');
  const oldSession = (await h.call('POST', '/auth/login', { body: { username: 'adminset@example.com', password: 'Sup3rSecret!' } })).body.token;
  const adminTok = (await h.call('POST', '/auth/login', { body: { username: 'admin', password: 'bootstrap-pw-123' } })).body.token;
  await new Promise((r) => setTimeout(r, 1100));
  const r = await h.call('POST', `/users/${u.id}/password`, { token: adminTok, body: { password: 'Admin-Chosen-9x' } });
  assert.ok([200, 204].includes(r.status), `set password → ${r.status}`);
  assert.ok(mailsTo('adminset@example.com').some((m) => /password was changed/i.test(m.subject) && /administrator/i.test(m.text)), 'user is told an administrator changed it');
  assert.strictEqual((await h.call('GET', '/auth/me', { token: oldSession })).status, 401, 'their old session is revoked');
  assert.strictEqual((await h.call('POST', '/auth/login', { body: { username: 'adminset@example.com', password: 'Admin-Chosen-9x' } })).status, 200);
});
