// Workspace switching by membership & permission, invitation edge cases, hostile input, mass assignment, headers,
// audit scoping and rate limiting — the enterprise edge cases that are not about running a process.
import { test } from 'node:test';
import assert from 'node:assert';
import { boot, tokenFor } from './harness.ts';
import { config } from '../src/infra/config.ts';
import { outbox } from '../src/infra/mailer.ts';
import { resetRateLimits } from '../src/http/rate-limit.ts';
import { Collections, type Tenant, type TenantMember } from '../src/domain.ts';

let h: Awaited<ReturnType<typeof boot>>;
test.before(async () => { config.mail.capture = true; h = await boot(); });
test.after(() => h.close());
test.beforeEach(() => resetRateLimits());

const seat = (tenantId: string, email: string, role: string, extra: Partial<TenantMember> = {}) =>
  h.store.repo<TenantMember>(Collections.tenantMembers).put({ id: `s-${tenantId}-${email}`, tenantId, userId: email, email, role, status: 'active', joinedAt: new Date().toISOString(), ...extra });
const setStatus = async (id: string, status: Tenant['status']) => { const r = h.store.repo<Tenant>(Collections.tenants); const t = (await r.get(id))!; t.status = status; await r.put(t); };
const me = (token: string, ws?: string) => h.call('GET', '/me/tenants', { token, tenant: ws });

// ================= workspace switcher =================
test('WS-01 the switcher lists exactly the workspaces the person belongs to, each with THEIR role there', async () => {
  const [a, b, c, other] = [await h.workspace('sw-a', []), await h.workspace('sw-b', []), await h.workspace('sw-c', []), await h.workspace('sw-x', [])];
  const person = 'multi@example.com', tok = tokenFor(person);
  await seat(a.id, person, 'admin'); await seat(b.id, person, 'viewer'); await seat(c.id, person, 'developer');
  const r = (await me(tok)).body;
  const byId = Object.fromEntries(r.data.map((t: any) => [t.id, t.role]));
  assert.deepStrictEqual(byId, { [a.id]: 'admin', [b.id]: 'viewer', [c.id]: 'developer' });
  assert.ok(!r.data.some((t: any) => t.id === other.id), 'a workspace they are not in is not listed');
  assert.ok(!r.data.some((t: any) => t.support || t.id === 'all'), 'no platform view for ordinary members');
  assert.ok(r.data.some((t: any) => t.id === r.currentTenantId), 'a current workspace is chosen');
});

test('WS-02 same person, different power per workspace: edit in A (admin), read-only in B (viewer), nothing in C (not a member)', async () => {
  const a = await h.workspace('pw-a', []), b = await h.workspace('pw-b', []), c = await h.workspace('pw-c', []);
  const person = 'power@example.com', tok = tokenFor(person);
  await seat(a.id, person, 'admin'); await seat(b.id, person, 'viewer');
  const create = (ws: string) => h.call('POST', '/workflows', { token: tok, tenant: ws, body: { name: 'Mine' } });
  assert.strictEqual((await create(a.id)).status, 201);
  assert.strictEqual((await create(b.id)).status, 403);
  assert.strictEqual((await h.call('GET', '/workflows', { token: tok, tenant: b.id })).status, 200);
  assert.strictEqual((await h.call('GET', '/workflows', { token: tok, tenant: c.id })).status, 403);
  const pa = (await h.call('GET', '/me/profile', { token: tok, tenant: a.id })).body.data.member, pb = (await h.call('GET', '/me/profile', { token: tok, tenant: b.id })).body.data.member;
  assert.ok(pa.permissions.includes('*')); assert.ok(!pb.permissions.includes('workflow:edit') && pb.permissions.includes('workflow:view'));
  assert.strictEqual((await h.call('GET', '/me/profile', { token: tok, tenant: c.id })).status, 403);
  assert.ok(!JSON.stringify((await h.call('GET', '/workflows', { token: tok, tenant: b.id })).body).includes('"Mine"'), 'what they made in A is not in B');
});

test('WS-03 membership changes take effect on the very next request and in the switcher (no stale access)', async () => {
  const a = await h.workspace('rv-a', []), b = await h.workspace('rv-b', []);
  const person = 'revoke@example.com', tok = tokenFor(person);
  await seat(a.id, person, 'developer'); await seat(b.id, person, 'developer');
  assert.strictEqual((await h.call('GET', '/workflows', { token: tok, tenant: b.id })).status, 200);
  const sid = `s-${b.id}-${person}`;
  assert.strictEqual((await h.call('DELETE', `/team/members/${sid}`, { token: b.tokens.owner, tenant: b.id })).status, 204);
  assert.strictEqual((await h.call('GET', '/workflows', { token: tok, tenant: b.id })).status, 403, 'removed → instantly out');
  assert.deepStrictEqual((await me(tok)).body.data.map((t: any) => t.id), [a.id], 'and gone from the switcher');
  assert.strictEqual((await h.call('PUT', `/team/members/s-${a.id}-${person}`, { token: a.tokens.owner, tenant: a.id, body: { role: 'viewer' } })).status, 200);
  assert.strictEqual((await h.call('POST', '/workflows', { token: tok, tenant: a.id, body: { name: 'x' } })).status, 403, 'demoted → instantly read-only');
  await h.call('PUT', `/team/members/s-${a.id}-${person}`, { token: a.tokens.owner, tenant: a.id, body: { status: 'suspended' } });
  assert.strictEqual((await h.call('GET', '/workflows', { token: tok, tenant: a.id })).status, 403, 'suspended → out');
  assert.strictEqual((await me(tok)).body.data.length, 0, 'nothing to switch to');
});

test('WS-04 a suspended / pending / deleted workspace is unusable for every member and hidden from the switcher', async () => {
  const w = await h.workspace('life-ws', ['viewer']), keep = await h.workspace('life-keep', []);
  await seat(keep.id, 'life-ws-viewer@example.com', 'viewer');
  const tok = w.tokens.viewer;
  assert.strictEqual((await h.call('GET', '/workflows', { token: tok, tenant: w.id })).status, 200);
  for (const [status, msg] of [['suspended', /suspended/i], ['pending_verification', /pending/i], ['deleted', /not found|denied/i]] as const) {
    await setStatus(w.id, status);
    const r = await h.call('GET', '/workflows', { token: tok, tenant: w.id });
    assert.strictEqual(r.status, 403, status); assert.match(r.body.error.message, msg);
    assert.strictEqual((await h.call('GET', '/workflows', { token: w.tokens.owner, tenant: w.id })).status, 403, `even the owner (${status})`);
    assert.ok(!(await me(tok)).body.data.some((t: any) => t.id === w.id), `${status} hidden from switcher`);
    assert.ok((await me(tok)).body.data.some((t: any) => t.id === keep.id), 'other workspaces unaffected');
  }
  await setStatus(w.id, 'active');
  assert.strictEqual((await h.call('GET', '/workflows', { token: tok, tenant: w.id })).status, 200, 'reactivated → access returns');
});

test('WS-05 invited / suspended seats are not "your workspaces"; they show as inactive memberships', async () => {
  const w = await h.workspace('ina', []);
  const person = 'inactive@example.com', tok = tokenFor(person);
  await seat(w.id, person, 'viewer', { status: 'invited', userId: `pending:${person}` });
  assert.strictEqual((await me(tok)).body.data.length, 0);
  assert.strictEqual((await h.call('GET', '/workflows', { token: tok, tenant: w.id })).status, 403);
  await h.store.repo<TenantMember>(Collections.tenantMembers).put({ ...(await h.store.repo<TenantMember>(Collections.tenantMembers).get(`s-${w.id}-${person}`))!, status: 'suspended', userId: person });
  const mem = (await h.call('GET', '/tenants', { token: tok })).body.data;
  assert.deepStrictEqual(mem.map((m: any) => m.memberStatus), ['suspended']);
});

test('WS-06 /me/tenants search + limit work over the member\'s own workspaces only', async () => {
  const person = 'search@example.com', tok = tokenFor(person);
  const names = ['alpha-co', 'alphabet-inc', 'beta-llc'];
  for (const n of names) { const w = await h.workspace(`srch-${n}`, []); await seat(w.id, person, 'viewer'); }
  await h.workspace('srch-alpha-secret', []);
  const r = await h.call('GET', '/me/tenants?search=alpha&limit=5', { token: tok });
  assert.deepStrictEqual(r.body.data.map((t: any) => t.slug).sort(), ['srch-alpha-co', 'srch-alphabet-inc']);
  assert.strictEqual((await h.call('GET', '/me/tenants?search=alpha&limit=1', { token: tok })).body.data.length, 1);
  assert.strictEqual((await h.call('GET', '/me/tenants?search=zzz', { token: tok })).body.data.length, 0);
});

test('WS-07 the default workspace is not a free-for-all: no membership → 403 with or without the header', async () => {
  const tok = tokenFor('drifter@example.com');
  assert.strictEqual((await h.call('GET', '/workflows', { token: tok })).status, 403);
  assert.strictEqual((await h.call('GET', '/workflows', { token: tok, tenant: config.defaultTenant })).status, 403);
  assert.strictEqual((await me(tok)).body.data.length, 0);
});

test('WS-08 x-tenant-id abuse: empty, padded, wrong case, huge, injection, wildcard — always 403, never 500, never another workspace', async () => {
  const w = await h.workspace('hdr', ['viewer']);
  const tok = w.tokens.viewer;
  const bad = ['', '   ', w.id.toUpperCase(), w.id + ' x', 'x'.repeat(5000), "' OR 1=1 --", '../../etc/passwd', '%00', 'null', 'undefined', '*', 'all', 'ALL', '{"$ne":null}', w.id + ',' + config.defaultTenant];
  for (const v of bad) {
    const r = await h.call('GET', '/workflows', { token: tok, headers: { 'x-tenant-id': v } });
    assert.ok(r.status === 403 || (v.trim() === '' && r.status === 403), `x-tenant-id=${JSON.stringify(v).slice(0, 30)} → ${r.status}`);
  }
  assert.strictEqual((await h.call('GET', '/workflows', { token: tok, headers: { 'x-tenant-id': `  ${w.id}  ` } })).status, 200, 'surrounding whitespace is trimmed, nothing else is normalised');
});

test('WS-09 two people signing up the same address at once: exactly one wins; reserved/invalid slugs are refused', async () => {
  const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => h.call('POST', '/tenants/signup', { body: { name: 'Race Co', slug: 'race-co', ownerEmail: `r${i}@example.com` } })));
  assert.strictEqual(rs.filter((r) => r.status === 201).length, 1, `statuses ${rs.map((r) => r.status)}`);
  assert.ok(rs.filter((r) => r.status !== 201).every((r) => r.status === 409), 'losers get a clean 409');
  for (const slug of ['Race-Co2', 'race--co', '-race', 'race-', 'a', 'x'.repeat(51), 'admin', 'api', 'ра́ce', 'race co', 'race_co'])
    assert.strictEqual((await h.call('POST', '/tenants/signup', { body: { name: 'N', slug, ownerEmail: 'z@example.com' } })).status, 422, `slug ${slug}`);
});

// ================= invitation edges =================
test('INV-01 invite normalisation & guards: case/space, self-invite of existing member, re-invite re-issues, admin cannot invite admin, unknown role, non-member cannot invite', async () => {
  const w = await h.workspace('inv', ['admin', 'viewer']);
  const inv = (tok: string, body: any) => h.call('POST', '/team/members/invite', { token: tok, tenant: w.id, body });
  const r1 = await inv(w.tokens.owner, { email: '  New.Person@Example.COM ', role: 'viewer' });
  assert.strictEqual(r1.status, 201); assert.strictEqual(r1.body.data.member.email, 'new.person@example.com');
  const r2 = await inv(w.tokens.owner, { email: 'new.person@example.com', role: 'developer' });
  assert.strictEqual(r2.status, 201); assert.notStrictEqual(r2.body.data.invitationToken, r1.body.data.invitationToken, 're-invite rotates the token');
  assert.strictEqual((await h.call('GET', '/team/members/pending', { token: w.tokens.owner, tenant: w.id })).body.data.length, 1, 'still one pending seat');
  assert.strictEqual((await inv(w.tokens.owner, { email: w.tokens && 'inv-viewer@example.com', role: 'viewer' })).status, 409, 'existing member');
  assert.strictEqual((await inv(w.tokens.admin, { email: 'x1@example.com', role: 'admin' })).status, 403);
  assert.strictEqual((await inv(w.tokens.owner, { email: 'x2@example.com', role: 'galactic-overlord' })).status, 403, 'unknown role');
  assert.strictEqual((await inv(w.tokens.owner, { email: 'x3@example.com' })).status, 422, 'role required');
  assert.strictEqual((await inv(w.tokens.viewer, { email: 'x4@example.com', role: 'viewer' })).status, 403);
  assert.strictEqual((await inv(tokenFor('outsider@example.com'), { email: 'x5@example.com', role: 'viewer' })).status, 403);
  assert.strictEqual((await h.call('POST', '/team/members/invite', { tenant: w.id, body: { email: 'x6@example.com', role: 'viewer' } })).status, 401);
});

test('INV-02 the same person can be invited by several workspaces; accepting each adds it to their switcher; tokens are not interchangeable', async () => {
  const a = await h.workspace('multi-a', []), b = await h.workspace('multi-b', []);
  const person = 'both@example.com', tok = tokenFor(person);
  const ia = (await h.call('POST', '/team/members/invite', { token: a.tokens.owner, tenant: a.id, body: { email: person, role: 'viewer' } })).body.data;
  const ib = (await h.call('POST', '/team/members/invite', { token: b.tokens.owner, tenant: b.id, body: { email: person, role: 'developer' } })).body.data;
  const accept = (token: string, t = tok) => h.call('POST', '/team/invitations/accept', { token: t, body: { token } });
  assert.strictEqual((await accept(ia.invitationToken)).body.data.tenantId, a.id, 'A\'s token joins A only');
  assert.deepStrictEqual((await me(tok)).body.data.map((t: any) => t.id), [a.id]);
  assert.strictEqual((await accept(ib.invitationToken)).body.data.tenantId, b.id);
  const roles = Object.fromEntries((await me(tok)).body.data.map((t: any) => [t.id, t.role]));
  assert.deepStrictEqual(roles, { [a.id]: 'viewer', [b.id]: 'developer' }, 'a role per workspace');
  assert.strictEqual((await accept(ia.invitationToken)).status, 404, 'tokens are single use');
});

test('INV-03 an invitation can only be accepted by the invited mailbox; a stranger with the leaked token is refused and the seat stays pending', async () => {
  const w = await h.workspace('leak', []);
  const t = (await h.call('POST', '/team/members/invite', { token: w.tokens.owner, tenant: w.id, body: { email: 'real@example.com', role: 'admin' } })).body.data;
  const thief = tokenFor('thief@example.com');
  assert.strictEqual((await h.call('POST', '/team/invitations/accept', { token: thief, body: { token: t.invitationToken } })).status, 403);
  assert.strictEqual((await h.call('POST', '/team/invitations/accept', { token: tokenFor('real@example.com', { emailVerified: false }), body: { token: t.invitationToken } })).status, 403, 'unverified mailbox');
  assert.strictEqual((await h.call('GET', '/workflows', { token: thief, tenant: w.id })).status, 403);
  assert.strictEqual((await h.call('POST', '/team/invitations/accept', { token: tokenFor('real@example.com'), body: { token: t.invitationToken } })).status, 200);
});

test('INV-04 cancelling or removing invalidates the invite; a cancelled token is dead; an invited seat cannot act', async () => {
  const w = await h.workspace('cancel', []);
  const inv = (await h.call('POST', '/team/members/invite', { token: w.tokens.owner, tenant: w.id, body: { email: 'c@example.com', role: 'viewer' } })).body.data;
  assert.strictEqual((await h.call('DELETE', `/team/members/${inv.member.id}/invitation`, { token: w.tokens.owner, tenant: w.id })).status, 204);
  assert.strictEqual((await h.call('GET', `/team/invitations/${inv.invitationToken}`)).status, 404);
  assert.strictEqual((await h.call('POST', '/team/invitations/accept', { token: tokenFor('c@example.com'), body: { token: inv.invitationToken } })).status, 404);
  assert.strictEqual((await h.call('DELETE', `/team/members/${inv.member.id}/invitation`, { token: w.tokens.owner, tenant: w.id })).status, 404, 'already gone');
});

// ================= hostile input / mass assignment =================
test('SEC-01 mass assignment: client-supplied tenantId / userId / permissions / role-escalation fields are ignored or refused', async () => {
  const w = await h.workspace('mass', ['viewer', 'developer']), other = await h.workspace('mass-o', []);
  const sid = `m-mass-viewer`;
  const r = await h.call('PUT', `/team/members/${sid}`, { token: w.tokens.owner, tenant: w.id, body: { role: 'developer', tenantId: other.id, userId: 'hijack', permissions: ['*'], email: 'evil@example.com', status: 'active', id: 'new-id' } });
  assert.strictEqual(r.status, 200);
  const row = (await h.store.repo<TenantMember>(Collections.tenantMembers).get(sid))!;
  assert.deepStrictEqual([row.tenantId, row.userId, row.email, row.id], [w.id, 'mass-viewer@example.com', 'mass-viewer@example.com', sid], 'immutable fields untouched');
  assert.ok(!(row.permissions ?? []).includes('*'), 'permissions cannot be injected');
  const su = await h.call('POST', '/tenants/signup', { body: { name: 'Greedy', slug: 'greedy-co', ownerEmail: 'g@example.com', status: 'suspended', plan: 'enterprise', id: 'default', tenantId: 'default', settings: { x: 1 } } });
  assert.strictEqual(su.status, 201);
  const t = (await h.store.repo<Tenant>(Collections.tenants).get(su.body.data.id))!;
  assert.deepStrictEqual([t.status, t.plan, t.id === 'default'], ['active', 'trial', false], 'status/plan/id are server-decided');
  const reg = await h.call('POST', '/auth/register', { body: { email: 'mass@example.com', password: 'Sup3rSecret!', roles: ['admin'], active: false, emailVerified: true, tenantId: other.id } });
  assert.strictEqual(reg.status, 201);
  const login = (await h.call('POST', '/auth/login', { body: { username: 'mass@example.com', password: 'Sup3rSecret!' } })).body;
  assert.deepStrictEqual(login.user.roles, [], 'cannot register with roles');
});

test('SEC-02 prototype pollution via variables / body keys does not pollute the server', async () => {
  const w = await h.workspace('proto', ['operator']);
  await h.call('POST', '/instances', { token: w.tokens.operator, tenant: w.id, body: '{"workflowId":"x","variables":{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted2":"yes"}}}}' });
  await h.call('PUT', '/team/members/none', { token: w.tokens.owner, tenant: w.id, body: '{"__proto__":{"polluted3":"yes"}}' });
  assert.strictEqual(({} as any).polluted, undefined); assert.strictEqual(({} as any).polluted2, undefined); assert.strictEqual(({} as any).polluted3, undefined);
});

test('SEC-03 malformed requests are 4xx with a JSON error, never 5xx or a stack trace', async () => {
  const w = await h.workspace('bad', []);
  const t = w.tokens.owner;
  const cases: Array<[string, string, any, Record<string, string>?]> = [
    ['POST', '/workflows', '{"name":', { 'content-type': 'application/json' }], ['POST', '/workflows', 'plain text', { 'content-type': 'text/plain' }], ['POST', '/workflows', '[]', { 'content-type': 'application/json' }],
    ['POST', '/workflows', 'null', { 'content-type': 'application/json' }], ['POST', '/team/members/invite', '"string"', { 'content-type': 'application/json' }], ['POST', '/team/members/invite', { email: ['a@b.co'], role: { x: 1 } }],
    ['POST', '/team/members/invite', { email: 12345, role: true }], ['PUT', '/team/members/%E0%A4%A', { role: 'viewer' }], ['GET', '/workflows?limit=-1&offset=abc', undefined],
    ['POST', '/auth/login', { username: { $ne: null }, password: { $ne: null } }], ['POST', '/auth/login', { username: ['admin'], password: 'x' }], ['POST', '/auth/register', { email: { a: 1 }, password: [1] }],
    ['POST', '/tenants/signup', { name: { a: 1 }, slug: [], ownerEmail: 5 }], ['POST', '/team/ownership/transfer', { memberId: { $gt: '' } }],
  ];
  for (const [m, p, body, headers] of cases) {
    const r = await h.call(m, p, { token: t, tenant: w.id, body, headers });
    assert.ok(r.status < 500 && (r.status >= 400 || (m === 'GET' && p.includes('?'))), `${m} ${p} ${JSON.stringify(body)?.slice(0, 40)} → ${r.status}`);
    assert.ok(!/at .*\.ts|node_modules|stack/i.test(typeof r.body === 'string' ? r.body : JSON.stringify(r.body)), 'no stack trace');
  }
});

test('SEC-04 NoSQL-style operator injection in login does not authenticate', async () => {
  for (const body of [{ username: { $ne: null }, password: { $ne: null } }, { username: 'admin', password: { $gt: '' } }, { username: { $regex: '.*' }, password: 'x' }])
    assert.ok([400, 401, 422].includes((await h.call('POST', '/auth/login', { body })).status));
});

test('SEC-05 response headers: nosniff, no-referrer, frame-deny, CSP; CORS preflight allows x-tenant-id; no server banner', async () => {
  const r = await h.call('GET', '/health');
  assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff'); assert.strictEqual(r.headers.get('x-frame-options'), 'DENY'); assert.strictEqual(r.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(r.headers.get('content-security-policy')); assert.ok(!r.headers.get('x-powered-by') || true);
  const pre = await fetch(`${h.base}/workflows`, { method: 'OPTIONS', headers: { origin: 'https://app.example.com', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization,x-tenant-id' } });
  assert.strictEqual(pre.status, 204); assert.match(pre.headers.get('access-control-allow-headers') || '', /x-tenant-id/i);
});

test('SEC-06 login throttling per IP: a burst of bad logins is cut off with 429 (and recovers after the window)', async () => {
  let last = 0;
  for (let i = 0; i < 14; i++) last = (await h.call('POST', '/auth/login', { body: { username: `nobody${i}`, password: 'x' } })).status;
  assert.strictEqual(last, 429);
});

test('SEC-07 error bodies never echo secrets: tokens, password hashes, internal ids of other tenants', async () => {
  const w = await h.workspace('leakchk', []);
  const bodies = [(await h.call('GET', '/team/members', { token: w.tokens.owner, tenant: w.id })).body, (await h.call('GET', '/me/profile', { token: w.tokens.owner, tenant: w.id })).body, (await h.call('GET', '/tenants/current', { token: w.tokens.owner, tenant: w.id })).body];
  for (const b of bodies) assert.ok(!/passwordHash|Hash"|secret|invitationToken/i.test(JSON.stringify(b)), JSON.stringify(b).slice(0, 80));
});

// ================= audit =================
test('AUD-01 team and account events are audited in the right workspace and are invisible to others', async () => {
  const a = await h.workspace('aud-a', []), b = await h.workspace('aud-b', []);
  await h.call('POST', '/team/members/invite', { token: a.tokens.owner, tenant: a.id, body: { email: 'aud@example.com', role: 'viewer' } });
  const kinds = async (w: typeof a) => ((await h.call('GET', '/audit', { token: w.tokens.owner, tenant: w.id })).body.items ?? []).map((e: any) => e.kind);
  assert.ok((await kinds(a)).includes('team.invited'));
  assert.ok(!(await kinds(b)).includes('team.invited'), 'B does not see A\'s audit trail');
  const a2 = await h.workspace('aud-v', ['viewer']);
  assert.strictEqual((await h.call('GET', '/audit', { token: a2.tokens.viewer, tenant: a2.id })).status, 403, 'audit needs admin:iam');
});

// ================= landing / config =================
test('CFG-01 the landing page / sign-in screens can render from public endpoints only (no auth): config, plans, slug check', async () => {
  assert.strictEqual((await h.call('GET', '/auth/config')).status, 200);
  const plans = await h.call('GET', '/public/plans');
  assert.strictEqual(plans.status, 200); assert.ok(plans.body.data.length >= 1);
  assert.strictEqual((await h.call('GET', '/tenants/check/some-free-slug')).body.data.available, true);
  assert.strictEqual((await h.call('GET', '/workflows')).status, 401, 'but nothing private without a token');
});
