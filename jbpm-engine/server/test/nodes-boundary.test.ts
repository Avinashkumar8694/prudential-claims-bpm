// Boundary/error-catch node matching — pure predicate tests over engine-node fragments (no instance,
// no execution). Mirrors the engine-decisioning.test.ts precedent for decisioning.ts.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  isErrorCatch, isCatchAll, isGlobalCatch, catchErrorName, globalNameMatches,
  findErrorHandler, boundaryTimerHosts, compensationBoundaries,
} from '../src/engine/nodes/boundary/handler.ts';

test('findErrorHandler prefers a host-specific catch over any global catch', () => {
  const nodes: any[] = [
    { id: 'bad', type: 'script' },
    { id: 'c1', type: 'boundary', on: ['bad'], event: { error: '' } },
    { id: 'g1', type: 'boundary', on: ['*'], event: { error: '*' } },
  ];
  const found = findErrorHandler(nodes, 'bad', 'SCRIPT_ERROR');
  assert.strictEqual(found?.id, 'c1');
});

test('findErrorHandler falls back to a global NAMED catch over a global catch-all', () => {
  const nodes: any[] = [
    { id: 'bad', type: 'http' },
    { id: 'named', type: 'boundary', on: ['*'], event: { error: 'SERVICE_ERROR' } },
    { id: 'catchAll', type: 'boundary', on: ['*'], event: { error: '*' } },
  ];
  const found = findErrorHandler(nodes, 'bad', 'SERVICE_ERROR');
  assert.strictEqual(found?.id, 'named');
});

test('findErrorHandler falls back to a global catch-all when no host-specific or named catch matches', () => {
  // A named catch declared with a RECOGNIZED engine-error name (SCRIPT_ERROR) only ever matches that
  // exact code — unlike an unrecognized custom name, it does NOT default-match SERVICE_ERROR.
  const nodes: any[] = [
    { id: 'bad', type: 'http' },
    { id: 'named', type: 'boundary', on: ['*'], event: { error: 'SCRIPT_ERROR' } },
    { id: 'catchAll', type: 'boundary', on: ['*'], event: { error: '*' } },
  ];
  const found = findErrorHandler(nodes, 'bad', 'SERVICE_ERROR');
  assert.strictEqual(found?.id, 'catchAll');
});

test('findErrorHandler returns undefined when nothing matches', () => {
  const nodes: any[] = [
    { id: 'bad', type: 'http' },
    { id: 'other', type: 'boundary', on: ['other-node'], event: { error: '' } },
  ];
  assert.strictEqual(findErrorHandler(nodes, 'bad', 'SERVICE_ERROR'), undefined);
});

test('an event sub-process error-start is always a global catch, regardless of "on"', () => {
  const sub: any = { id: 'esp', type: 'subprocess', on: { error: 'SERVICE_ERROR' } };
  assert.strictEqual(isErrorCatch(sub), true);
  assert.strictEqual(isGlobalCatch(sub), true);
  assert.strictEqual(catchErrorName(sub), 'SERVICE_ERROR');
});

test('globalNameMatches: exact custom name match always wins', () => {
  // An unrecognized custom name also default-matches SERVICE_ERROR (see the next test) — so the
  // negative case here must use a different recognized engine code to isolate "exact match" itself.
  const n: any = { type: 'boundary', event: { error: 'VALIDATION' } };
  assert.strictEqual(globalNameMatches(n, 'VALIDATION'), true);
  assert.strictEqual(globalNameMatches(n, 'SCRIPT_ERROR'), false);
});

test('globalNameMatches: a non-standard-named catch matches SERVICE_ERROR only, never other engine codes', () => {
  const n: any = { type: 'boundary', event: { error: 'REST_API_FAILURE' } };
  assert.strictEqual(globalNameMatches(n, 'SERVICE_ERROR'), true);
  assert.strictEqual(globalNameMatches(n, 'SCRIPT_ERROR'), false);
  assert.strictEqual(globalNameMatches(n, 'RULE_ERROR'), false);
});

test('globalNameMatches: a catch already named with a recognized engine code only matches that exact code', () => {
  const n: any = { type: 'boundary', event: { error: 'SCRIPT_ERROR' } };
  assert.strictEqual(globalNameMatches(n, 'SCRIPT_ERROR'), true);
  assert.strictEqual(globalNameMatches(n, 'SERVICE_ERROR'), false);
});

test('isCatchAll treats empty string, "*", undefined, and "ANY" as catch-all', () => {
  assert.strictEqual(isCatchAll({ type: 'boundary', event: { error: '' } } as any), true);
  assert.strictEqual(isCatchAll({ type: 'boundary', event: { error: '*' } } as any), true);
  assert.strictEqual(isCatchAll({ type: 'boundary', event: { error: 'ANY' } } as any), true);
  assert.strictEqual(isCatchAll({ type: 'boundary', event: { error: 'VALIDATION' } } as any), false);
});

test('boundaryTimerHosts finds only timer boundaries attached to the given host', () => {
  const nodes: any[] = [
    { id: 'review', type: 'userTask' },
    { id: 'sla', type: 'boundary', on: ['review'], event: { timer: { duration: 'PT1H' } } },
    { id: 'other-timer', type: 'boundary', on: ['other'], event: { timer: { duration: 'PT2H' } } },
    { id: 'err', type: 'boundary', on: ['review'], event: { error: '' } },
  ];
  const hosts = boundaryTimerHosts(nodes, 'review');
  assert.deepStrictEqual(hosts.map((n) => n.id), ['sla']);
});

test('compensationBoundaries finds only compensation boundaries attached to the given host', () => {
  const nodes: any[] = [
    { id: 'A', type: 'script' },
    { id: 'B', type: 'script' },
    { id: 'bA', type: 'boundary', on: ['A'], event: { compensation: true } },
    { id: 'bB', type: 'boundary', on: ['B'], event: { compensation: true } },
  ];
  assert.deepStrictEqual(compensationBoundaries(nodes, 'A').map((n) => n.id), ['bA']);
  assert.deepStrictEqual(compensationBoundaries(nodes, 'B').map((n) => n.id), ['bB']);
  assert.deepStrictEqual(compensationBoundaries(nodes, 'C'), []);
});
