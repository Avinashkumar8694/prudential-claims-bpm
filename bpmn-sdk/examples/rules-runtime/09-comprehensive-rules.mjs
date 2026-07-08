// 09-comprehensive-rules.mjs
// ONE ruleset that exercises EVERY engine-ruleset construct, executed on data by the reference engine
// from example 08. Each rule is annotated with the construct(s) it demonstrates:
//   operators : eq(bare) ne gt gte lt lte in(bare & {in}) notIn contains notContains matches memberOf
//   where     : literal, array, multi-op range, {ref} cross-fact join, {op:{ref}}
//   patterns  : positive match + bind (as), exists:false (negation), exists:true (existence)
//   actions   : set, insert (with & without fields), delete, call
//   control   : priority (conflict resolution), noLoop (self-retrigger guard), forward chaining
import { run } from '../functions/rule-engine.mjs';
import { isMain } from '../functions/io.mjs';
import { printFacts, printTrace } from '../functions/report.mjs';

export const RULESET = {
  rules: [
    // priority 100/90/90/80: several rules can match one claim; priority orders them.
    { name: 'High value',   priority: 100,   // gt ; set
      when: [{ fact: 'Claim', as: 'c', where: { amount: { gt: 100000 } } }],
      then: [{ set: 'c', fields: { band: 'HIGH' } }] },

    { name: 'Medium value', priority: 90,     // multi-op range (gte + lte) ; set
      when: [{ fact: 'Claim', as: 'c', where: { amount: { gte: 5000, lte: 100000 } } }],
      then: [{ set: 'c', fields: { band: 'MEDIUM' } }] },

    { name: 'Low value',    priority: 90,     // lt ; set
      when: [{ fact: 'Claim', as: 'c', where: { amount: { lt: 5000 } } }],
      then: [{ set: 'c', fields: { band: 'LOW' } }] },

    { name: 'Reject blocked region',          // in ({in}) ; set + insert(no fields) + call
      when: [{ fact: 'Claim', as: 'c', where: { region: { in: ['BLOCKED', 'SANCTIONED'] } } }],
      then: [{ set: 'c', fields: { status: 'REJECTED' } }, { insert: 'ReviewTask' }, { call: 'audit', args: ['region-block'] }] },

    { name: 'Delete withdrawn',               // eq (bare) ; delete
      when: [{ fact: 'Claim', as: 'c', where: { status: 'WITHDRAWN' } }],
      then: [{ delete: 'c' }] },

    { name: 'Auto-approve clean small new claim',  // lte, eq, bare-array in, notIn, matches, contains, gte, {ref} join, exists:false, exists:true ; set + insert(fields)
      when: [
        { fact: 'Claim', as: 'c', where: {
          amount: { lte: 5000 }, status: 'NEW', type: ['DEATH', 'TI'],
          region: { notIn: ['BLOCKED'] }, note: { matches: '^OK' }, tags: { contains: 'verified' }, score: { gte: 50 } } },
        { fact: 'FraudAlert', exists: false, where: { claimId: { ref: 'c.id' }, open: true } },  // no OPEN alert for THIS claim
        { fact: 'Document',   exists: true,  where: { claimId: { ref: 'c.id' } } },              // at least one doc for it
      ],
      then: [{ set: 'c', fields: { status: 'APPROVED' } }, { insert: 'AuditLog', fields: { event: 'approved' } }] },

    { name: 'Escalate high open',             // ne ; insert(fields) ; FORWARD CHAINING (reads `band` set by "High value")
      when: [{ fact: 'Claim', as: 'c', where: { band: 'HIGH', status: { ne: 'REJECTED' } } }],
      then: [{ insert: 'Escalation', fields: { level: 3 } }] },

    { name: 'VIP fast-track',                 // memberOf, notContains ; set ; forward chaining (reads `band`)
      when: [{ fact: 'Claim', as: 'c', where: { channel: { memberOf: ['WEB', 'APP'] }, tags: { notContains: 'fraud' }, band: 'HIGH' } }],
      then: [{ set: 'c', fields: { fastTrack: true } }] },
  ],
};

// noLoop demonstrated in isolation: this rule WRITES a field it READS (`status`) with a value that
// still matches -> without noLoop it re-triggers itself forever; with noLoop it fires exactly once.
export const NOLOOP_RULESET = { rules: [{
  name: 'Stamp open claim', noLoop: true,
  when: [{ fact: 'Claim', as: 'c', where: { status: 'OPEN' } }],
  then: [{ set: 'c', fields: { status: 'OPEN', stamped: true } }],
}] };

// fact schemas (for reference; the engine runs on the plain objects below)
export const TYPES = ['Claim', 'FraudAlert', 'Document', 'Escalation', 'AuditLog', 'ReviewTask'];

export const FACTS = [
  { _id: 'A', _type: 'Claim', id: 'A', amount: 250000, status: 'OPEN',      type: 'DEATH', region: 'US',      channel: 'WEB', tags: ['verified'], note: 'OK proceed', score: 80 },
  { _id: 'B', _type: 'Claim', id: 'B', amount: 3000,   status: 'NEW',       type: 'TI',    region: 'US',      channel: 'WEB', tags: ['verified'], note: 'OK small',   score: 90 },
  { _id: 'C', _type: 'Claim', id: 'C', amount: 4000,   status: 'NEW',       type: 'TI',    region: 'BLOCKED', channel: 'APP', tags: ['verified'], note: 'OK',         score: 20 },
  { _id: 'D', _type: 'Claim', id: 'D', amount: 8000,   status: 'WITHDRAWN', type: 'TI',    region: 'US',      channel: 'WEB', tags: ['verified'], note: 'n/a',        score: 70 },
  { _id: 'fa1', _type: 'FraudAlert', claimId: 'A', open: true },   // open alert — but for A (a high-value claim, not auto-approved anyway)
  { _id: 'doc1', _type: 'Document', claimId: 'B', kind: 'ID' },    // B has a document -> exists:true holds for B
];

if (isMain(import.meta.url)) {
  const calls = [];
  const helpers = { audit: (msg) => calls.push(msg) };
  printFacts('BEFORE:', FACTS, 'Claim');
  const { facts, trace } = run(RULESET, FACTS.map((f) => ({ ...f })), helpers);
  printTrace(trace, '\nFIRING TRACE (order shows priority):');
  printFacts('\nAFTER (claims):', facts, 'Claim');
  console.log('\nINSERTED facts:'); for (const f of facts.filter((f) => ['Escalation', 'AuditLog', 'ReviewTask'].includes(f._type))) console.log(' ', JSON.stringify(f));
  console.log('\ncall(audit) invocations:', calls);

  // --- noLoop, isolated: with -> fires once; without -> loops until the cycle cap throws ---
  console.log('\nnoLoop demo:');
  const one = run(NOLOOP_RULESET, [{ _id: 'X', _type: 'Claim', status: 'OPEN' }]);
  console.log('  with noLoop  ->', JSON.stringify(one.facts[0]), `(${one.trace.length} fire)`);
  const noGuard = { rules: [{ ...NOLOOP_RULESET.rules[0], noLoop: false }] };
  try { run(noGuard, [{ _id: 'X', _type: 'Claim', status: 'OPEN' }]); console.log('  without      -> (did not loop?!)'); }
  catch (e) { console.log('  without      -> throws:', e.message); }
}
