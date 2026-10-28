// Shared, pure query-evaluation semantics for the generic ad-hoc query engine — used identically by
// the in-memory/file-backed store (filters+groupBy+metric run entirely here), the Postgres-backed
// store (SQL does the tenant-scoped WHERE fetch; groupBy/metric still run here afterward, on the
// already-tenant-scoped result set, so the two backends can never silently diverge in behavior), and
// query-engine-service.ts's instance/task path (which always evaluates in memory, since the existing
// generic blob store only ever supports JS-predicate queries — see store/repository.ts). Nothing in
// this file ever sees or needs a tenantId: callers are responsible for having already scoped `rows`
// to one tenant before calling in — this module has no way to violate that even if it wanted to.
import type { QueryDefinition, QueryFilter, QueryOp } from './domain.ts';

/** Dotted-path read, e.g. getPath(row, 'data.claimAmount') — the same "$var"-adjacent convention as
 *  every other dotted-field-path idiom in this codebase (see engine/nodes/http/handler.ts's jsonPath). */
export function getPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  return path.split('.').reduce((c: any, p) => (c == null ? undefined : c[p]), obj);
}

function matchesOp(actual: unknown, op: QueryOp, expected: unknown): boolean {
  switch (op) {
    case 'eq': return actual === expected;
    case 'ne': return actual !== expected;
    case 'gt': return actual != null && expected != null && actual > (expected as any);
    case 'gte': return actual != null && expected != null && actual >= (expected as any);
    case 'lt': return actual != null && expected != null && actual < (expected as any);
    case 'lte': return actual != null && expected != null && actual <= (expected as any);
    case 'in': return Array.isArray(expected) && expected.includes(actual as any);
    case 'contains': return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
    default: return false;
  }
}

export function matchesAllFilters(row: unknown, filters: QueryFilter[] | undefined): boolean {
  if (!filters?.length) return true;
  return filters.every((f) => matchesOp(getPath(row, f.field), f.op, f.value));
}

export interface QueryRunResult {
  rows?: Record<string, unknown>[];
  groups?: { key: string; count: number; avgDurationMs?: number }[];
}

/** Applies filters, then either returns the (optionally sorted/limited) row set, or — when `groupBy`
 *  is set — buckets by that field and computes `metric` per bucket. `avgDurationMs` needs both
 *  `durationFrom`/`durationTo` field paths to resolve to parseable timestamps on a given row; rows
 *  where either side is missing/unparseable are excluded from that bucket's average, not treated as 0. */
export function evaluateQuery(rows: Record<string, unknown>[], def: QueryDefinition): QueryRunResult {
  let filtered = rows.filter((r) => matchesAllFilters(r, def.filters));

  if (def.groupBy) {
    const buckets = new Map<string, { count: number; durations: number[] }>();
    for (const r of filtered) {
      const key = String(getPath(r, def.groupBy!) ?? '(none)');
      let b = buckets.get(key);
      if (!b) { b = { count: 0, durations: [] }; buckets.set(key, b); }
      b.count += 1;
      if (def.metric === 'avgDurationMs' && def.durationFrom && def.durationTo) {
        const from = Date.parse(String(getPath(r, def.durationFrom) ?? ''));
        const to = Date.parse(String(getPath(r, def.durationTo) ?? ''));
        if (!Number.isNaN(from) && !Number.isNaN(to)) b.durations.push(Math.max(0, to - from));
      }
    }
    const groups = [...buckets].map(([key, b]) => ({
      key, count: b.count,
      ...(def.metric === 'avgDurationMs' ? { avgDurationMs: b.durations.length ? Math.round(b.durations.reduce((a, x) => a + x, 0) / b.durations.length) : 0 } : {}),
    }));
    return { groups };
  }

  if (def.sort) {
    const { field, dir } = def.sort;
    filtered = [...filtered].sort((a, b) => {
      const av = getPath(a, field), bv = getPath(b, field);
      const cmp = av == null ? -1 : bv == null ? 1 : av < bv ? -1 : av > bv ? 1 : 0;
      return dir === 'desc' ? -cmp : cmp;
    });
  }
  if (def.limit != null) filtered = filtered.slice(0, def.limit);
  return { rows: filtered };
}
