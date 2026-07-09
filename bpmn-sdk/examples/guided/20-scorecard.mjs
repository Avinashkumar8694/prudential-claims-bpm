// Example 20 — author a SCORE CARD in the engine model (baseline + per-field bins), generate the
// Business Central .scgd, and compute scores at runtime. Engine model + runtime scorer are fully
// verified; the .scgd XML is best-effort. See docs/bpm-assets/score-card/.
import { fromEngineProject, writeProject } from '../../dist/index.mjs';
import { evaluateScorecard } from '../functions/scorecard.mjs';
import { isMain, outDir } from '../functions/io.mjs';
import { printWritten } from '../functions/report.mjs';

export const SCORECARD = {
  name: 'Claim risk',
  fact: 'Claim',
  score: 'riskScore',
  baseline: 100,
  characteristics: [
    { field: 'amount', bands: [
      { when: { lt: 1000 }, points: 0 },
      { when: { between: [1000, 100000] }, points: 10 },
      { when: { gte: 100000 }, points: 30 },
    ] },
    { field: 'region', bands: [
      { when: 'US', points: 5 },
      { when: 'BLOCKED', points: 50 },
      { points: 20 },   // no `when` = catch-all (any other region)
    ] },
  ],
};

export function buildScorecardProject(dir) {
  const engine = {
    types: [{ name: 'Claim', fields: [{ name: 'amount', type: 'double' }, { name: 'region', type: 'string' }, { name: 'riskScore', type: 'int' }] }],
    scorecards: [SCORECARD],
    processes: [{ id: 'p', name: 'p', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }],
  };
  const project = fromEngineProject(engine);
  const written = writeProject(project, dir);
  return { project, written };
}

if (isMain(import.meta.url)) {
  const dir = outDir(import.meta.url, 'scorecard');
  const { project, written } = buildScorecardProject(dir);
  printWritten('scorecard project', dir, written);
  const scgdPath = Object.keys(project.descriptor.files).find((f) => f.endsWith('.scgd'));
  console.log(`\nGenerated ${scgdPath} (${project.descriptor.files[scgdPath].length} bytes)\n`);

  for (const claim of [
    { amount: 250000, region: 'US' },
    { amount: 5000, region: 'EU' },
    { amount: 500, region: 'BLOCKED' },
  ]) {
    const { score, contributions } = evaluateScorecard(SCORECARD, claim);
    console.log(`${JSON.stringify(claim)} -> riskScore ${score}  (100 + ${contributions.map((c) => `${c.field}:${c.points}`).join(' + ')})`);
  }
}
