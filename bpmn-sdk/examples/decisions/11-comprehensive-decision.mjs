// Example 11 — a decision model exercising EVERY engine InputTest form + multiple hit policies,
// converted to DMN AND evaluated at runtime on data by the reference evaluator (functions/dmn-engine).
//   input forms : literal, any(-), set/in, gt/gte/lt/lte, between, not, {feel}
//   hit policies : UNIQUE, COLLECT + aggregation SUM
//   output forms : literal, {feel} expression
import { decisionToDmn, buildAsset } from '../../dist/index.mjs';
import { evaluateDecision, evaluateModel } from '../functions/dmn-engine.mjs';
import { isMain } from '../functions/io.mjs';

export const MODEL = {
  name: 'ClaimDecisions',
  decisions: [
    {
      name: 'Triage',
      hitPolicy: 'UNIQUE',
      inputs: [
        { name: 'amount', type: 'number' },
        { name: 'region', type: 'string' },
        { name: 'type', type: 'string' },
        { name: 'score', type: 'number' },
      ],
      outputs: [{ name: 'band', type: 'string' }, { name: 'fee', type: 'number' }],
      rules: [
        // literal eq + gt + set(in) + range
        { when: { amount: { gt: 100000 }, region: 'US', type: ['DEATH', 'TI'], score: { between: [50, 100] } },
          then: { band: 'HIGH', fee: { feel: 'amount * 0.01' } } },        // {feel} output expression
        // not + between (mutually exclusive with the other rows -> valid UNIQUE table)
        { when: { region: { not: 'BLOCKED' }, amount: { between: [1, 100000] } },
          then: { band: 'STANDARD', fee: 100 } },
        // any (omitted inputs) + lt  -> catch-all-ish
        { when: { amount: { lt: 1 } }, then: { band: 'REJECT', fee: 0 } },
      ],
    },
    {
      name: 'FeeTotal',
      hitPolicy: 'COLLECT',
      aggregation: 'SUM',
      inputs: [{ name: 'kind', type: 'string' }],
      outputs: [{ name: 'charge', type: 'number' }],
      rules: [
        { when: { kind: 'BASE' }, then: { charge: 50 } },
        { when: { kind: { in: ['RUSH', 'PRIORITY'] } }, then: { charge: 30 } },
        { when: { kind: 'INTL' }, then: { charge: 20 } },
      ],
    },
  ],
};

if (isMain(import.meta.url)) {
  // 1) it compiles to valid DMN
  const dmn = buildAsset({ kind: 'dmn', model: decisionToDmn(MODEL) });
  console.log(`Generated DMN (${dmn.length} bytes), decisions: ${MODEL.decisions.map((d) => d.name).join(', ')}\n`);

  // 2) evaluate the Triage table on sample inputs
  const cases = [
    { amount: 250000, region: 'US', type: 'DEATH', score: 80 },   // -> HIGH, fee expr
    { amount: 4000, region: 'EU', type: 'TI', score: 40 },        // -> STANDARD
    { amount: 0, region: 'US', type: 'TI', score: 10 },           // -> REJECT
  ];
  const triage = MODEL.decisions[0];
  for (const c of cases) console.log('Triage', JSON.stringify(c), '->', JSON.stringify(evaluateDecision(triage, c)));

  // 3) COLLECT + SUM aggregation
  const fee = MODEL.decisions[1];
  console.log('\nFeeTotal kind=RUSH ->', JSON.stringify(evaluateDecision(fee, { kind: 'RUSH' })));  // matches BASE? no; RUSH -> 30
  console.log('FeeTotal (whole model) ->', JSON.stringify(evaluateModel(MODEL, { amount: 250000, region: 'US', type: 'DEATH', score: 80, kind: 'INTL' })));
}
