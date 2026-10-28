// The reference rule engine (examples/08) executes the engine-ruleset JSON against plain objects.
// Proves how `where`, joins (`ref`), `exists`, `priority`, and `then` apply to data at runtime.
import { test } from 'node:test';
import assert from 'node:assert';
import { run, RULESET, FACTS } from '../examples/rules-runtime/08-run-engine-rules.mjs';
import { RULESET as ALL, FACTS as ALL_FACTS, NOLOOP_RULESET } from '../examples/rules-runtime/09-comprehensive-rules.mjs';

const byId = (facts, id) => facts.find((f) => f._id === id);

test('rules apply to data: match -> resolve -> act', () => {
  const { facts, trace } = run(RULESET, FACTS.map((f) => ({ ...f })));
  // rule 1: c1 amount>100000 -> priority HIGH
  assert.strictEqual(byId(facts, 'c1').priority, 'HIGH');
  // rule 2: c2 is small+NEW and NO open FraudAlert joins to c2 (a1 is for c1) -> APPROVED
  assert.strictEqual(byId(facts, 'c2').status, 'APPROVED');
  assert.strictEqual(trace.length, 2);
});

test('join + negation: an open fraud alert for THIS claim blocks approval', () => {
  const facts = [
    { _id: 'c2', _type: 'Claim', id: 'c2', amount: 3000, status: 'NEW', type: 'TI' },
    { _id: 'a2', _type: 'FraudAlert', claimId: 'c2', open: true },  // now the alert IS for c2
  ];
  const { facts: out } = run(RULESET, facts);
  assert.strictEqual(byId(out, 'c2').status, 'NEW', 'not approved — the join found an open alert for c2');
});

test('priority orders rules that compete for the same fact', () => {
  const ruleset = { rules: [
    { name: 'low', priority: 1, when: [{ fact: 'X', as: 'x', where: { n: 1 } }], then: [{ set: 'x', fields: { seen: 'low' } }] },
    { name: 'high', priority: 100, when: [{ fact: 'X', as: 'x', where: { n: 1 } }], then: [{ set: 'x', fields: { seen: 'high' } }] },
  ] };
  const { trace } = run(ruleset, [{ _id: 'x1', _type: 'X', n: 1 }]);
  assert.strictEqual(trace[0].split('  ')[0], 'fired: high', 'higher priority fires first');
});

test('comprehensive ruleset — every construct applies correctly to data', () => {
  const calls = [];
  const { facts } = run(ALL, ALL_FACTS.map((f) => ({ ...f })), { audit: (m) => calls.push(m) });
  const A = byId(facts, 'A'), B = byId(facts, 'B'), C = byId(facts, 'C');
  // priority: High(100) beat Medium/Low; band set; forward chaining -> Escalation + fastTrack (once each)
  assert.strictEqual(A.band, 'HIGH');
  assert.strictEqual(A.fastTrack, true);
  assert.strictEqual(facts.filter((f) => f._type === 'Escalation').length, 1, 'escalated once (no duplicate)');
  // full where grammar + join + exists:false + exists:true -> B approved, AuditLog inserted
  assert.strictEqual(B.status, 'APPROVED');
  assert.strictEqual(B.band, 'LOW');
  assert.ok(facts.some((f) => f._type === 'AuditLog' && f.event === 'approved'));
  // in-list region -> C rejected, ReviewTask inserted (no fields), call(audit) invoked
  assert.strictEqual(C.status, 'REJECTED');
  assert.ok(facts.some((f) => f._type === 'ReviewTask'));
  assert.deepStrictEqual(calls, ['region-block']);
  // delete: withdrawn D removed
  assert.ok(!byId(facts, 'D'), 'withdrawn claim deleted');
});

test('noLoop: with -> fires once; without -> non-terminating (throws)', () => {
  const { facts, trace } = run(NOLOOP_RULESET, [{ _id: 'X', _type: 'Claim', status: 'OPEN' }]);
  assert.strictEqual(trace.length, 1, 'fires exactly once with noLoop');
  assert.strictEqual(facts[0].stamped, true);
  const noGuard = { rules: [{ ...NOLOOP_RULESET.rules[0], noLoop: false }] };
  assert.throws(() => run(noGuard, [{ _id: 'X', _type: 'Claim', status: 'OPEN' }]), /exceeded/, 'loops without noLoop');
});

test('insert adds a fact; delete removes one', () => {
  const ruleset = { rules: [
    { name: 'escalate', when: [{ fact: 'Claim', as: 'c', where: { amount: { gt: 100 } } }],
      then: [{ insert: 'Escalation', fields: { level: 3 } }, { delete: 'c' }] },
  ] };
  const { facts } = run(ruleset, [{ _id: 'c1', _type: 'Claim', amount: 500 }]);
  assert.ok(facts.some((f) => f._type === 'Escalation' && f.level === 3), 'inserted');
  assert.ok(!facts.some((f) => f._type === 'Claim'), 'deleted');
});
