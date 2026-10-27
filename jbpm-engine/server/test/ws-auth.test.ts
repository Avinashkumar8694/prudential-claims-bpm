// WS upgrade-handshake auth — the WS hub previously accepted every connection with zero auth check
// at all (didn't even read the upgrade request). Unit-tested directly against a fake IncomingMessage
// rather than booting the real server (index.ts binds a fixed port + starts timers as a side effect
// of import, so it isn't a unit-testable module — this is exactly why the check was extracted into
// its own small function).
import { test } from 'node:test';
import assert from 'node:assert';
import type { IncomingMessage } from 'node:http';
import { authenticateWsUpgrade } from '../src/infra/ws-auth.ts';
import { signToken } from '../src/infra/auth.ts';

const fakeReq = (url: string): IncomingMessage => ({ url } as IncomingMessage);

test('rejects a connection with no token at all', () => {
  assert.strictEqual(authenticateWsUpgrade(fakeReq('/ws')), false);
});

test('rejects a connection with a garbage token', () => {
  assert.strictEqual(authenticateWsUpgrade(fakeReq('/ws?token=not-a-real-jwt')), false);
});

test('accepts a connection with a valid token passed as a query param', () => {
  const token = signToken({ sub: 'u1', username: 'alice', roles: ['worker'], groups: [] });
  assert.strictEqual(authenticateWsUpgrade(fakeReq(`/ws?token=${encodeURIComponent(token)}`)), true);
});
