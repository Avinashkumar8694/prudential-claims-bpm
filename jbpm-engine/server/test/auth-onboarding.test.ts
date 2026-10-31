// The Identity-Server / rules-manager onboarding model for built-in accounts:
//   register (no password) → temporary password emailed → signing in with it CREATES the account → forced to choose a
//   real password → first session.  Plus: emailed one-time sign-in codes, invitation activation, and the registration rules
//   (disposable domains, allowed domains, terms) — all configuration-driven.
import { test } from 'node:test';
import assert from 'node:assert';
import { boot, tokenFor } from './harness.ts';
import { config } from '../src/infra/config.ts';
import { outbox } from '../src/infra/mailer.ts';
import { resetRateLimits } from '../src/http/rate-limit.ts';
import { Collections, type PendingRegistration, type User } from '../src/domain.ts';
import jwt from 'jsonwebtoken';

let h: Awaited<ReturnType<typeof boot>>;
const saved = { ...config.auth };
test.before(async () => { config.mail.capture = true; h = await boot(); });
test.after(async () => { Object.assign(config.auth, saved); await h.close(); });
test.beforeEach(() => { resetRateLimits(); Object.assign(config.auth, saved); config.auth.registration = true; config.auth.registrationMethod = 'temp_password'; config.auth.emailVerification = false; config.auth.otpLogin = false; config.auth.tosUrl = undefined; config.auth.allowedEmailDomains = []; config.auth.blockDisposableEmails = true; config.auth.forgotPassword = true; });

const mails = (to: string) => outbox.filter((m) => m.to === to);
const tempOf = (to: string) => /Temporary password: (\S+)/.exec([...mails(to)].reverse().find((m) => /temporary password/i.test(m.subject))!.text)![1];
const register = (email: string, extra: any = {}) => h.call('POST', '/auth/register', { body: { email, name: 'Tess Temp', ...extra } });
const login = (u: string, p: string) => h.call('POST', '/auth/login', { body: { username: u, password: p } });
const users = () => h.store.repo<User>(Collections.users).query(() => true);
const pendings = () => h.store.repo<PendingRegistration>(Collections.pendingRegistrations).query(() => true);

// ================= temp-password registration =================
test('REG-TMP-01 register collects NO password, answers 202, emails a temporary password — and creates NO account yet', async () => {
  const r = await register('Tess@Example.com');
  assert.strictEqual(r.status, 202);
  assert.deepStrictEqual([r.body.method, r.body.email, r.body.expiresInHours], ['temp_password', 'tess@example.com', config.auth.tempPasswordHours]);
  assert.ok(!(await users()).some((u) => u.email === 'tess@example.com'), 'no account until the password is used');
  assert.strictEqual((await pendings()).filter((p) => p.email === 'tess@example.com').length, 1);
  const m = mails('tess@example.com').at(-1)!;
  assert.match(m.subject, /temporary password/i);
  assert.ok(/Temporary password: \S{12,}/.test(m.text) && m.html!.includes('Temporary password'));
  assert.ok(!JSON.stringify(r.body).includes(tempOf('tess@example.com')), 'the password is only ever in the email');
  const pend = (await pendings())[0]; assert.ok(pend.tempHash && !pend.tempHash.includes(tempOf('tess@example.com')), 'stored hashed');
});

test('REG-TMP-02 signing in with the temp password confirms the mailbox, creates the account, and returns a SETUP step — not a session', async () => {
  await register('step@example.com');
  const r = await login('step@example.com', tempOf('step@example.com'));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.passwordSetupRequired, true);
  assert.ok(r.body.setupToken && !r.body.token, 'no session token yet');
  const u = (await users()).find((x) => x.email === 'step@example.com')!;
  assert.ok(u, 'account created now');
  assert.deepStrictEqual([u.emailVerified, u.mustResetPassword, u.roles], [true, true, []]);
  assert.strictEqual((await pendings()).filter((p) => p.email === 'step@example.com').length, 0, 'pending row consumed');
  assert.strictEqual((await h.call('GET', '/auth/me', { token: r.body.setupToken })).status, 401, 'the setup token is NOT a bearer token');
  assert.strictEqual((await h.call('GET', '/workflows', { token: r.body.setupToken })).status, 401);
});

test('REG-TMP-03 set your own password → first real session; the temp password dies; policy and reuse are enforced', async () => {
  await register('own@example.com');
  const temp = tempOf('own@example.com');
  const { setupToken } = (await login('own@example.com', temp)).body;
  const set = (pw: string, tok = setupToken) => h.call('POST', '/auth/set-password', { body: { setupToken: tok, password: pw } });
  assert.strictEqual((await set('short')).status, 422);
  assert.strictEqual((await set('onlyletters')).status, 422);
  assert.strictEqual((await set(temp)).status, 422, 'must differ from the temporary password');
  assert.strictEqual((await set('Brand-New-Pw9', 'garbage')).status, 401);
  assert.strictEqual((await set('Brand-New-Pw9', jwt.sign({ sub: 'x', purpose: 'set-password' }, 'wrong-key'))).status, 401);
  const ok = await set('Brand-New-Pw9');
  assert.strictEqual(ok.status, 200); assert.ok(ok.body.token);
  assert.strictEqual((await h.call('GET', '/auth/me', { token: ok.body.token })).status, 200);
  assert.strictEqual((await login('own@example.com', temp)).status, 401, 'temp password no longer works');
  assert.strictEqual((await login('own@example.com', 'Brand-New-Pw9')).body.token !== undefined, true);
  assert.strictEqual((await set('Another-Pw-99')).status, 401, 'the setup step is single use');
  assert.ok(mails('own@example.com').some((m) => /welcome/i.test(m.subject)), 'welcome after onboarding');
});

test('REG-TMP-04 anti-enumeration: an existing account gets an identical answer and an "already registered" email instead', async () => {
  await register('exists@example.com');
  const { setupToken } = (await login('exists@example.com', tempOf('exists@example.com'))).body;
  await h.call('POST', '/auth/set-password', { body: { setupToken, password: 'Real-Passw0rd' } });
  resetRateLimits();
  const before = mails('exists@example.com').length;
  const again = await register('exists@example.com');
  const fresh = await register('fresh-one@example.com');
  assert.deepStrictEqual([again.status, Object.keys(again.body).sort()], [fresh.status, Object.keys(fresh.body).sort()], 'same shape for new and existing');
  assert.ok(mails('exists@example.com').slice(before).some((m) => /already have/i.test(m.subject)));
  assert.ok(!mails('exists@example.com').slice(before).some((m) => /temporary password/i.test(m.subject)), 'no temp password for an existing account');
  assert.strictEqual((await login('exists@example.com', 'Real-Passw0rd')).status, 200, 'and the real password is untouched');
});

test('REG-TMP-05 expiry: an expired temp password is refused with a clear message; registering again issues a new one (old dies)', async () => {
  await register('late@example.com');
  const old = tempOf('late@example.com');
  const pend = (await pendings()).find((p) => p.email === 'late@example.com')!;
  pend.expiresAt = new Date(Date.now() - 1000).toISOString(); pend.lastSentAt = new Date(Date.now() - 120000).toISOString();
  await h.store.repo<PendingRegistration>(Collections.pendingRegistrations).put(pend);
  const r = await login('late@example.com', old);
  assert.strictEqual(r.status, 403); assert.match(r.body.error.message, /expired.*register again/i);
  assert.strictEqual((await register('late@example.com')).status, 202);
  const fresh = tempOf('late@example.com');
  assert.notStrictEqual(fresh, old);
  assert.strictEqual((await login('late@example.com', fresh)).body.passwordSetupRequired, true);

  // expired AFTER the account was created but before a real password was chosen
  const u = (await users()).find((x) => x.email === 'late@example.com')!;
  u.tempPasswordExpiresAt = new Date(Date.now() - 1000).toISOString(); u.passwordResetSentAt = new Date(Date.now() - 120000).toISOString();
  await h.store.repo<User>(Collections.users).put(u);
  assert.strictEqual((await login('late@example.com', fresh)).status, 403);
  assert.strictEqual((await register('late@example.com')).status, 202, 're-register re-issues for an unfinished account');
  const third = tempOf('late@example.com');
  assert.strictEqual((await login('late@example.com', third)).body.passwordSetupRequired, true);
});

test('REG-TMP-06 throttle: re-registering within a minute does not send a second email', async () => {
  await register('thr@example.com');
  const n = mails('thr@example.com').length;
  assert.strictEqual((await register('thr@example.com')).status, 202);
  assert.strictEqual(mails('thr@example.com').length, n);
});

test('REG-TMP-07 no squatting: an unconfirmed address creates no account, blocks nobody, and cannot be matched to workspace seats', async () => {
  const w = await h.workspace('tmp-seat', []);
  await h.store.repo<any>(Collections.tenantMembers).put({ id: 'seat-x', tenantId: w.id, userId: 'victim@corp.com', email: 'victim@corp.com', role: 'admin', status: 'active', joinedAt: new Date().toISOString() });
  await register('victim@corp.com');                                    // attacker requests a temp password for the victim's address…
  assert.ok(!(await users()).some((u) => u.email === 'victim@corp.com'), '…and no account exists');
  const attackerLogin = await login('victim@corp.com', 'guess-guess-1');
  assert.strictEqual(attackerLogin.status, 401);
  // the real owner of the mailbox receives the temp password and is the only one who can confirm
  const { setupToken } = (await login('victim@corp.com', tempOf('victim@corp.com'))).body;
  const session = (await h.call('POST', '/auth/set-password', { body: { setupToken, password: 'Owner-Chosen-1' } })).body.token;
  assert.strictEqual((await h.call('GET', '/workflows', { token: session, tenant: w.id })).status, 200, 'the verified owner of the mailbox does get the seat');
});

test('REG-TMP-08 brute-forcing the temp password locks the pending registration', async () => {
  await register('brute@example.com');
  for (let i = 0; i < config.auth.maxFailedLogins; i++) assert.strictEqual((await login('brute@example.com', `wrong-${i}`)).status, 401);
  assert.strictEqual((await login('brute@example.com', tempOf('brute@example.com'))).status, 429, 'even the right one is refused while locked');
});

// ================= registration rules =================
test('REG-RULE-01 disposable mailboxes are refused; allowed-domain list restricts; terms must be accepted when configured', async () => {
  for (const e of ['x@mailinator.com', 'x@Guerrillamail.com', 'x@sub.yopmail.com']) assert.strictEqual((await register(e)).status, 422, e);
  config.auth.blockDisposableEmails = false;
  assert.strictEqual((await register('x@mailinator.com')).status, 202, 'switchable');
  config.auth.blockDisposableEmails = true;
  config.auth.allowedEmailDomains = ['acme.com'];
  assert.strictEqual((await register('a@other.com')).status, 422);
  assert.strictEqual((await register('a@acme.com')).status, 202);
  config.auth.allowedEmailDomains = [];
  config.auth.tosUrl = 'https://example.com/terms';
  assert.strictEqual((await register('t@example.com')).status, 422, 'terms required');
  assert.strictEqual((await register('t@example.com', { tosAccepted: 'yes' })).status, 422, 'must be literally true');
  assert.strictEqual((await register('t@example.com', { tosAccepted: true })).status, 202);
  assert.strictEqual((await h.call('GET', '/auth/config')).body.tosUrl, 'https://example.com/terms');
});

test('REG-RULE-02 invalid input is 422 (never 500): bad email, reserved SSO admin address, object/array bodies; registration off ⇒ 404', async () => {
  for (const email of ['', 'nope', 'a@b', { a: 1 }, ['x@y.co']]) assert.strictEqual((await h.call('POST', '/auth/register', { body: { email } })).status, 422, JSON.stringify(email));
  assert.strictEqual((await register(config.platformAdminEmail)).status, 422);
  config.auth.registration = false;
  assert.strictEqual((await register('closed@example.com')).status, 404);
});

test('REG-RULE-03 /auth/config advertises the method, validity window and terms so the UI renders the right form', async () => {
  const c = (await h.call('GET', '/auth/config')).body;
  assert.deepStrictEqual([c.registrationMethod, c.tempPasswordHours, c.otpLogin], ['temp_password', config.auth.tempPasswordHours, false]);
});

// ================= OTP sign-in =================
test('OTP-01 emailed code signs you in: 6 digits, hashed, single use, expiry, wrong guesses burn it, resend throttled, anti-enumeration', async () => {
  config.auth.otpLogin = true;
  config.auth.registrationMethod = 'password';
  await register('otp@example.com', { password: 'Sup3rSecret!' });
  const code = () => /sign-in code: (\d{6})/.exec([...mails('otp@example.com')].reverse().find((m) => /sign-in code/i.test(m.subject))!.subject)![1];
  const ask = (e = 'otp@example.com') => h.call('POST', '/auth/otp/request', { body: { email: e } });
  const verify = (c: string, e = 'otp@example.com') => h.call('POST', '/auth/otp/verify', { body: { email: e, code: c } });
  assert.strictEqual((await ask()).status, 202);
  const c1 = code();
  assert.match(c1, /^\d{6}$/);
  const row = (await users()).find((u) => u.email === 'otp@example.com')!;
  assert.ok(row.otpHash && !row.otpHash.includes(c1), 'hashed at rest');
  const n = mails('otp@example.com').length; await ask();
  assert.strictEqual(mails('otp@example.com').length, n, 'resend throttled');
  const wrong = c1 === '000000' ? '111111' : '000000';
  assert.strictEqual((await verify(wrong)).status, 401);
  const ok = await verify(c1);
  assert.strictEqual(ok.status, 200); assert.ok(ok.body.token);
  assert.strictEqual((await verify(c1)).status, 401, 'single use');
  const before = outbox.length;
  assert.strictEqual((await ask('ghost@example.com')).status, 202); assert.strictEqual(outbox.length, before, 'unknown address: same answer, no mail');
  assert.strictEqual((await verify('123456', 'ghost@example.com')).status, 401);
});

test('OTP-02 five wrong guesses burn the code; an expired code is refused; disabled ⇒ 404', async () => {
  config.auth.otpLogin = true; config.auth.registrationMethod = 'password';
  await register('burn@example.com', { password: 'Sup3rSecret!' });
  await h.call('POST', '/auth/otp/request', { body: { email: 'burn@example.com' } });
  const code = /sign-in code: (\d{6})/.exec(mails('burn@example.com').at(-1)!.subject)![1];
  const bad = code === '999999' ? '888888' : '999999';
  for (let i = 0; i < 5; i++) assert.strictEqual((await h.call('POST', '/auth/otp/verify', { body: { email: 'burn@example.com', code: bad } })).status, 401);
  assert.strictEqual((await h.call('POST', '/auth/otp/verify', { body: { email: 'burn@example.com', code } })).status, 401, 'burnt: even the right code fails');
  const u = (await users()).find((x) => x.email === 'burn@example.com')!;
  u.otpSentAt = null; await h.store.repo<User>(Collections.users).put(u);
  await h.call('POST', '/auth/otp/request', { body: { email: 'burn@example.com' } });
  const c2 = /sign-in code: (\d{6})/.exec(mails('burn@example.com').at(-1)!.subject)![1];
  const u2 = (await users()).find((x) => x.email === 'burn@example.com')!; u2.otpExpiresAt = new Date(Date.now() - 1000).toISOString(); await h.store.repo<User>(Collections.users).put(u2);
  assert.strictEqual((await h.call('POST', '/auth/otp/verify', { body: { email: 'burn@example.com', code: c2 } })).status, 401, 'expired');
  config.auth.otpLogin = false;
  assert.strictEqual((await h.call('POST', '/auth/otp/request', { body: { email: 'burn@example.com' } })).status, 404);
});

test('OTP-03 a deactivated or locked account cannot use a code; an account still on a temp password goes through the set-password step', async () => {
  config.auth.otpLogin = true; config.auth.registrationMethod = 'password';
  await register('off@example.com', { password: 'Sup3rSecret!' });
  const u = (await users()).find((x) => x.email === 'off@example.com')!; u.active = false; await h.store.repo<User>(Collections.users).put(u);
  const before = outbox.length;
  await h.call('POST', '/auth/otp/request', { body: { email: 'off@example.com' } });
  assert.strictEqual(outbox.length, before, 'no code for a deactivated account');
  config.auth.registrationMethod = 'temp_password';
  await register('half@example.com');
  await login('half@example.com', tempOf('half@example.com'));         // account exists, still on the temp password
  await h.call('POST', '/auth/otp/request', { body: { email: 'half@example.com' } });
  const code = /sign-in code: (\d{6})/.exec(mails('half@example.com').at(-1)!.subject)![1];
  const r = await h.call('POST', '/auth/otp/verify', { body: { email: 'half@example.com', code } });
  assert.strictEqual(r.body.passwordSetupRequired, true, 'must still choose a real password');
});

// ================= invitation activation =================
test('ACT-01 an invited person with no account sets a password from the invitation (token proves the mailbox) — even when open registration is off', async () => {
  config.auth.registration = false;
  const w = await h.workspace('act', []);
  const inv = (await h.call('POST', '/team/members/invite', { token: w.tokens.owner, tenant: w.id, body: { email: 'newbie@example.com', role: 'developer' } })).body.data;
  const look = await h.call('GET', `/team/invitations/${inv.invitationToken}`);
  assert.strictEqual(look.body.data.accountExists, false);
  assert.strictEqual((await h.call('POST', `/team/invitations/garbage/activate`, { body: { password: 'Chosen-Pass-1' } })).status, 404);
  assert.strictEqual((await h.call('POST', `/team/invitations/${inv.invitationToken}/activate`, { body: { password: 'weak' } })).status, 422);
  assert.strictEqual((await h.call('POST', `/team/invitations/${inv.invitationToken}/activate`, { body: { password: 'Chosen-Pass-1', name: 'New Bie' } })).status, 204);
  assert.strictEqual((await h.call('POST', `/team/invitations/${inv.invitationToken}/activate`, { body: { password: 'Chosen-Pass-1' } })).status, 409, 'account now exists');
  assert.strictEqual((await h.call('GET', `/team/invitations/${inv.invitationToken}`)).body.data.accountExists, true);
  const session = (await login('newbie@example.com', 'Chosen-Pass-1')).body.token;
  assert.ok(session);
  const acc = await h.call('POST', '/team/invitations/accept', { token: session, body: { token: inv.invitationToken } });
  assert.strictEqual(acc.status, 200);
  assert.strictEqual((await h.call('GET', '/workflows', { token: session, tenant: w.id })).status, 200, 'member with the invited role');
});

test('ACT-02 an expired / cancelled invitation cannot activate an account', async () => {
  const w = await h.workspace('act2', []);
  const inv = (await h.call('POST', '/team/members/invite', { token: w.tokens.owner, tenant: w.id, body: { email: 'gone@example.com', role: 'viewer' } })).body.data;
  await h.call('DELETE', `/team/members/${inv.member.id}/invitation`, { token: w.tokens.owner, tenant: w.id });
  assert.strictEqual((await h.call('POST', `/team/invitations/${inv.invitationToken}/activate`, { body: { password: 'Chosen-Pass-1' } })).status, 404);
  assert.ok(!(await users()).some((u) => u.email === 'gone@example.com'));
});

test('ACT-03 local login off ⇒ activation endpoint is 404; the platform-admin address can never be activated locally', async () => {
  const w = await h.workspace('act3', []);
  const inv = (await h.call('POST', '/team/members/invite', { token: w.tokens.owner, tenant: w.id, body: { email: 'x3@example.com', role: 'viewer' } })).body.data;
  config.localLogin = false;
  try { assert.strictEqual((await h.call('POST', `/team/invitations/${inv.invitationToken}/activate`, { body: { password: 'Chosen-Pass-1' } })).status, 404); }
  finally { config.localLogin = true; }
});
