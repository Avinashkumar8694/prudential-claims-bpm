// functions/scorecard.mjs — reusable runtime for an engine SCORE CARD (additive scoring). Start from
// the baseline; for each characteristic add the points of the FIRST bin whose matcher holds for the
// field value; write the total to the score field. Pure JS, no SDK dependency.

const OPS = { eq: (a, b) => a === b, ne: (a, b) => a !== b, gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b };

// does a band's `when` hold for a value? (same condition grammar as DRL where)
const bandMatch = (band, v) => {
  const w = band.when;
  if (w === undefined) return true;                                  // catch-all (no `when`)
  if (typeof w !== 'object') return v === w;                         // bare literal (eq)
  if ('between' in w) return v >= w.between[0] && v <= w.between[1];
  const [op, val] = Object.entries(w)[0];                            // { op: value }
  return !!OPS[op] && OPS[op](v, val);
};

// score a fact. Returns { fact: <copy with the score field set>, score, contributions: [{field,points}] }.
export function evaluateScorecard(sc, fact) {
  let score = sc.baseline || 0;
  const contributions = [];
  for (const ch of sc.characteristics) {
    const band = ch.bands.find((b) => bandMatch(b, fact[ch.field]));   // first matching band
    if (band) { score += band.points; contributions.push({ field: ch.field, points: band.points }); }
  }
  return { fact: { ...fact, [sc.score]: score }, score, contributions };
}
