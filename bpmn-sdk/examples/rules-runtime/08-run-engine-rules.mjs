// 08-run-engine-rules.mjs
// Minimal scenario for the reusable reference rule engine (../functions/rule-engine.mjs): a 2-rule
// ruleset over plain objects, showing match, join (`ref`), negation (`exists:false`), priority, and
// `set` applied to DATA. The engine itself lives in functions/ so your own Node engine can import it.
import { run } from '../functions/rule-engine.mjs';
import { isMain } from '../functions/io.mjs';
import { printFacts, printTrace } from '../functions/report.mjs';

export { run };  // re-exported for convenience (and tests)

export const RULESET = {
  rules: [
    { name: 'Flag high value', priority: 10,
      when: [{ fact: 'Claim', as: 'claim', where: { amount: { gt: 100000 } } }],
      then: [{ set: 'claim', fields: { priority: 'HIGH' } }] },
    { name: 'Auto-approve small new claims when no open fraud alert for the claim',
      when: [
        { fact: 'Claim', as: 'claim', where: { amount: { lte: 5000 }, status: 'NEW' } },
        { fact: 'FraudAlert', exists: false, where: { claimId: { ref: 'claim.id' }, open: true } },
      ],
      then: [{ set: 'claim', fields: { status: 'APPROVED' } }] },
  ],
};
export const FACTS = [
  { _id: 'c1', _type: 'Claim', id: 'c1', amount: 150000, status: 'OPEN', type: 'DEATH' },
  { _id: 'c2', _type: 'Claim', id: 'c2', amount: 3000, status: 'NEW', type: 'TI' },
  { _id: 'a1', _type: 'FraudAlert', claimId: 'c1', open: true },   // an OPEN fraud alert, but for c1 (not c2)
];

if (isMain(import.meta.url)) {
  printFacts('BEFORE:', FACTS);
  const { facts, trace } = run(RULESET, FACTS.map((f) => ({ ...f })));
  printTrace(trace);
  printFacts('\nAFTER:', facts);
}
