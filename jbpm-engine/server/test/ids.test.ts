import { test } from 'node:test';
import assert from 'node:assert';
import { newId, fakeClock } from '../src/infra/ids.ts';

test('newId — 16 chars, base32 only, highly unique', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 20000; i++) {
    const id = newId();
    assert.match(id, /^[0-9A-Z]{16}$/, `id must be clean base32: ${id}`);
    assert.ok(!id.includes('undefined'), 'no undefined chars');
    seen.add(id);
  }
  assert.ok(seen.size >= 19990, `expected near-unique ids, got ${seen.size}/20000`);
});

test('fakeClock advances deterministically', () => {
  const fc = fakeClock('2025-01-01T00:00:00.000Z');
  assert.strictEqual(fc.now(), '2025-01-01T00:00:00.000Z');
  fc.advanceMs(1500);
  assert.strictEqual(fc.now(), '2025-01-01T00:00:01.500Z');
});
