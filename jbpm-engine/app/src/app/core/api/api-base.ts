// Shared base for the domain-scoped API services (see workflow-api/deployment-api/instance-api/
// task-api/query-api/iam-api). Replaces the single monolithic ApiService — split by consumption
// pattern (which components actually use which calls together), not 1:1 with every backend module.
import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export const API_BASE = '/api';
export interface ApiList<T> { items: T[]; }

export abstract class ApiBase {
  protected http = inject(HttpClient);
  protected base = API_BASE;
  /** unwraps the API's consistent `{ items: T[] }` list envelope */
  protected items<T>(obs: Observable<ApiList<T>>): Observable<T[]> {
    return obs.pipe(map((r) => r.items));
  }

  /** Strips undefined/null/empty-string keys from a filter object before handing it to HttpClient's
   *  `params` option. HttpClient does NOT drop `undefined` values on its own — it stringifies them,
   *  sending a literal `?key=undefined` that servers then filter ON (never matching anything) instead
   *  of ignoring. Any optional-filter GET call must run its filter object through this first. */
  protected cleanParams(filter: object | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(filter || {}) as [string, unknown][]) {
      if (v !== undefined && v !== null && v !== '') out[k] = String(v);
    }
    return out;
  }
}
