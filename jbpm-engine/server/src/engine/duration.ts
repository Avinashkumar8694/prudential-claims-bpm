// ISO-8601 duration / cycle parsing for timers. Deterministic (takes an explicit "now" ms).
export function parseDuration(iso: string): number {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso.trim());
  if (!m) return 0;
  const [, w, d, h, min, s] = m.map((x) => (x ? Number(x) : 0)) as number[];
  return ((((w * 7 + d) * 24 + h) * 60 + min) * 60 + s) * 1000;
}

/** ISO-8601 recurring-interval repeat count: "R3/PT1H" -> 3, "R/PT1H" (or no leading R) -> null
 *  (infinite/unbounded). Previously `computeDue` silently dropped this — every cycle repeated forever
 *  regardless of a declared count. */
export function parseCycleRepeatCount(cycle: string): number | null {
  const m = /^R(\d*)\//.exec(cycle.trim());
  if (!m) return null;
  return m[1] ? Number(m[1]) : null;
}

/** Next fire time (ISO) from a timer spec (duration | cycle | date), given now (ISO). */
export function computeDue(timer: any, nowIso: string): string {
  const nowMs = Date.parse(nowIso);
  if (typeof timer === 'string') return new Date(nowMs + parseDuration(timer)).toISOString();
  if (timer?.date) return new Date(timer.date).toISOString();
  if (timer?.duration) return new Date(nowMs + parseDuration(timer.duration)).toISOString();
  if (timer?.cycle) { const period = timer.cycle.split('/').slice(1).join('/') || timer.cycle; return new Date(nowMs + parseDuration(period)).toISOString(); }
  return new Date(nowMs).toISOString();
}
