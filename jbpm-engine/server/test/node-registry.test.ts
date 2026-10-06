// Node-registry consistency — the "factory pattern" safety net: every node type self-registers via
// registerNode() (see factory.ts), which validates consistency the moment it's called. This test just
// confirms the FULL bootstrap (nodes/index.ts) produces a complete, internally-consistent registry —
// if it imports at all without throwing, every node already passed the factory's own validation.
import { test } from 'node:test';
import assert from 'node:assert';
import { NODE_HANDLERS, NODE_DEFS } from '../src/engine/nodes/index.ts';

const HANDLERLESS_BY_DESIGN = new Set(['boundary']);
const EXPECTED_TYPES = ['start', 'end', 'manual', 'script', 'http', 'rule', 'gateway', 'userTask', 'receive', 'catch', 'throw', 'send', 'call', 'forEach', 'subprocess', 'boundary', 'workItem'];

test('every expected node type registered', () => {
  const types = new Set(NODE_DEFS.map((d) => d.engineType));
  for (const t of EXPECTED_TYPES) assert.ok(types.has(t), `"${t}" never registered`);
  assert.strictEqual(types.size, EXPECTED_TYPES.length, `expected exactly ${EXPECTED_TYPES.length} node types, got ${types.size}`);
});

test('every NODE_DEFS engineType has a matching NODE_HANDLERS entry (or is the documented boundary exception)', () => {
  const handlerTypes = new Set(Object.keys(NODE_HANDLERS));
  for (const d of NODE_DEFS) {
    if (HANDLERLESS_BY_DESIGN.has(d.engineType)) continue;
    assert.ok(handlerTypes.has(d.engineType), `NODE_DEFS has "${d.engineType}" with no matching NODE_HANDLERS entry`);
  }
});

test('every NODE_HANDLERS entry has a matching NODE_DEFS entry', () => {
  const defTypes = new Set(NODE_DEFS.map((d) => d.engineType));
  for (const type of Object.keys(NODE_HANDLERS)) assert.ok(defTypes.has(type), `NODE_HANDLERS has "${type}" with no matching NODE_DEFS entry`);
});

test('every palette tile\'s own engineType and defaults.type agree with its NodeDef\'s engineType', () => {
  for (const d of NODE_DEFS) {
    for (const p of d.palette) {
      assert.strictEqual(p.engineType, d.engineType, `${d.engineType}: palette tile "${p.key}" declares engineType "${p.engineType}"`);
      assert.strictEqual((p.defaults as any).type, d.engineType, `${d.engineType}: palette tile "${p.key}"'s defaults.type is "${(p.defaults as any).type}"`);
    }
  }
});

// By the time this file runs, nodes/index.ts has already been imported (by an earlier test in this
// same process) and called sealRegistry() — so registerNode() correctly refuses ANY further call,
// which is itself the behavior worth proving (a node module that registered lazily/out of order,
// after something already read the registry, fails loudly instead of silently never appearing).
test('the factory refuses to register anything after the registry is sealed', async () => {
  const { registerNode } = await import('../src/engine/nodes/factory.ts');
  assert.throws(() => registerNode({
    engineType: 'bogus',
    def: { engineType: 'bogus', palette: [{ key: 'x', label: 'X', category: 'Tasks', icon: '?', color: '#000', engineType: 'bogus', defaults: { type: 'bogus' } }], ports: {}, schema: [], diagram: { icon: 'x', color: '#000', shape: 'rectangle' }, typeLabel: 'Bogus' },
    handler: () => ({}),
  } as any), /sealed/);
});

// A mismatched registration is exercised in complete isolation (a subprocess with a fresh module
// registry, never touching nodes/index.ts at all), so the mismatch check itself — not the seal — is
// what actually fires.
test('the factory rejects a mismatched registration (fresh, unsealed registry)', async () => {
  const { execFileSync } = await import('node:child_process');
  const script = `
    import { registerNode } from './src/engine/nodes/factory.ts';
    try {
      registerNode({
        engineType: 'bogus',
        def: { engineType: 'wrong-type', palette: [{ key: 'x', label: 'X', category: 'Tasks', icon: '?', color: '#000', engineType: 'bogus', defaults: { type: 'bogus' } }], ports: {}, schema: [], diagram: { icon: 'x', color: '#000', shape: 'rectangle' }, typeLabel: 'Bogus' },
        handler: () => ({}),
      });
      console.log('NO_THROW');
    } catch (e) { console.log('THROW:' + e.message); }
  `;
  const out = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.match(out, /THROW:.*def\.engineType/);
});
