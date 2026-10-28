// Scorecard asset — additive scoring over characteristics (SDK → .scgd).
import { type AssetKindDef } from '../types.ts';
export const def: AssetKindDef = {
  key: 'scorecards', label: 'Scorecards', nameField: 'name',
  seed: (name, fields) => ({
    name,
    package: fields?.package || 'com.acme.rules',
    fact: fields?.fact || 'Claim',
    baseline: Number(fields?.baseline ?? 100),
    target: fields?.target || 'score',
    characteristics: [
      {
        field: 'creditScore',
        attributes: [
          { match: { gte: 750 }, points: 50, reason: 'Excellent credit' },
          { match: { gte: 650 }, points: 20, reason: 'Good credit' },
          { match: { lt: 650 }, points: -30, reason: 'Subprime credit' },
        ],
      },
      {
        field: 'claimAmount',
        attributes: [
          { match: { lte: 1000 }, points: 20, reason: 'Low amount' },
          { match: { gt: 10000 }, points: -40, reason: 'High amount alert' },
        ],
      },
    ],
  }),
};
