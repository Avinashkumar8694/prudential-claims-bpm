import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';
import type { NodeCatalog } from '../models/engine';

// Fetched once and cached for the session — the catalog is static server config (the node factory's
// own registered defs), not per-request data. shareReplay(1) means every load() call after the first
// gets the same cached emission instead of re-requesting.
@Injectable({ providedIn: 'root' })
export class NodeCatalogService {
  private cached$: Observable<NodeCatalog> | null = null;

  constructor(private http: HttpClient) {}

  load(): Observable<NodeCatalog> {
    if (!this.cached$) this.cached$ = this.http.get<NodeCatalog>('/api/node-defs').pipe(shareReplay(1));
    return this.cached$;
  }
}
