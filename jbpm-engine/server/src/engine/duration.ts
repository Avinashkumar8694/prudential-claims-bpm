// ISO-8601 duration/date/cycle parsing shared by timers (catch/boundary/start) and User Task due dates.
export interface TimerSpec { duration?: string; cycle?: string; date?: string; }

const DURATION_RE = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/** Parse a bare ISO-8601 duration ("PT1H30M", "P1D") into milliseconds. Returns 0 for anything that
 *  doesn't match (callers treat 0 as "fires immediately" — a clear, loud symptom of a bad string,
 *  never a silent no-op). */
export function parseDuration(iso: string): number {
  const m = DURATION_RE.exec(iso.trim());
  if (!m) return 0;
  const [, y, mo, w, d, h, mi, s] = m;
  const days = (Number(y || 0) * 365) + (Number(mo || 0) * 30) + (Number(w || 0) * 7) + Number(d || 0);
  return days * 86400000 + Number(h || 0) * 3600000 + Number(mi || 0) * 60000 + Number(s || 0) * 1000;
}

/** Recurring cycle "R[n]/<duration>" (n omitted = unlimited). Returns { count, ms } — count is
 *  undefined for unlimited. */
export function parseCycle(cycle: string): { count?: number; ms: number } {
  const m = /^R(\d*)\/(.+)$/.exec(cycle.trim());
  if (!m) return { ms: 0 };
  const [, n, dur] = m;
  return { count: n ? Number(n) : undefined, ms: parseDuration(dur!) };
}

/** Compute the next due timestamp (ISO string) for a timer/dueDate spec, relative to `now`. Accepts
 *  the object shape ({duration|cycle|date}) or a bare string — a bare "R.../..." cycle string, or a
 *  plain ISO duration string, or (best-effort) an absolute date string. */
export function computeDue(spec: TimerSpec | string, now: string): string {
  const base = Date.parse(now);
  if (typeof spec === 'string') {
    if (spec.startsWith('R')) return new Date(base + parseCycle(spec).ms).toISOString();
    const asDate = Date.parse(spec);
    if (!Number.isNaN(asDate) && /^\d{4}-\d{2}-\d{2}/.test(spec)) return new Date(asDate).toISOString();
    return new Date(base + parseDuration(spec)).toISOString();
  }
  if (spec.date) { const d = Date.parse(spec.date); return new Date(Number.isNaN(d) ? base : d).toISOString(); }
  if (spec.cycle) return new Date(base + parseCycle(spec.cycle).ms).toISOString();
  if (spec.duration) return new Date(base + parseDuration(spec.duration)).toISOString();
  return new Date(base).toISOString();
}
