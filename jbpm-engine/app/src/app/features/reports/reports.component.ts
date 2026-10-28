import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, JsonPipe } from '@angular/common';
import { forkJoin } from 'rxjs';
import { QueryApiService } from '../../core/api/query-api.service';
import { WorkflowAnalyticsApiService, type WorkflowInstanceSummary } from '../../core/api/workflow-analytics-api.service';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { IconComponent } from '../../shared/icon.component';
import { ToastService } from '../../shared/toast.service';
import type { ProcessAnalytics, QueryDefinition, QueryFilter, QueryOp, QueryRunResult, QueryableEntity, SavedQuery, Summary, TaskAnalytics, WorkflowTat } from '../../core/models';

type ReportsTab = 'processes' | 'tasks' | 'cases' | 'queries';

interface StatusRow { key: string; label: string; color: string; count: number; pctOfMax: number; share: number; }

const ENTITIES: QueryableEntity[] = ['workflowInstance', 'workflowInstanceAudit', 'workflowInstanceComment', 'instance', 'task'];
const OPS: QueryOp[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'];

function humanMs(ms: number): string {
  if (!ms || ms <= 0) return '0s';
  if (ms < 1000) return '<1s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

const INSTANCE_STATUSES = [
  { key: 'running', label: 'Running', color: 'var(--blue)' },
  { key: 'waiting', label: 'Waiting', color: 'var(--amber)' },
  { key: 'completed', label: 'Completed', color: 'var(--green)' },
  { key: 'suspended', label: 'Suspended', color: 'var(--purple)' },
  { key: 'failed', label: 'Failed', color: 'var(--red)' },
  { key: 'aborted', label: 'Aborted', color: 'var(--muted)' },
];
const TASK_STATUSES = [
  { key: 'created', label: 'Created', color: 'var(--amber)' },
  { key: 'reserved', label: 'Reserved', color: 'var(--purple)' },
  { key: 'inprogress', label: 'In progress', color: 'var(--blue)' },
  { key: 'error', label: 'Error', color: 'var(--red)' },
];

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [FormsModule, DecimalPipe, JsonPipe, BreadcrumbComponent, IconComponent],
  template: `
    <div class="page">
      <div class="crumbwrap">
        <app-breadcrumb [crumbs]="[{ label: 'Reports & Analytics' }, { label: tabLabel() }]" />
      </div>

      <header class="pagehead">
        <div>
          <h1>Reports &amp; Analytics</h1>
          <p class="sub">Unified operational intelligence: process throughput, human task turnaround, case metrics, and ad-hoc queries.</p>
        </div>
        <div class="spacer"></div>
        <button class="btn sm" (click)="exportCsv()" [disabled]="loading() || !!error()">
          <app-icon name="download" [size]="14" /> Export CSV
        </button>
      </header>

      <nav class="tabs" role="tablist">
        <button role="tab" [attr.aria-selected]="tab() === 'processes'" [class.active]="tab() === 'processes'" (click)="setTab('processes')">Processes</button>
        <button role="tab" [attr.aria-selected]="tab() === 'tasks'" [class.active]="tab() === 'tasks'" (click)="setTab('tasks')">Tasks</button>
        <button role="tab" [attr.aria-selected]="tab() === 'cases'" [class.active]="tab() === 'cases'" (click)="setTab('cases')">Cases &amp; Workflows</button>
        <button role="tab" [attr.aria-selected]="tab() === 'queries'" [class.active]="tab() === 'queries'" (click)="setTab('queries')">Ad-Hoc Query Engine</button>
      </nav>

      @if (loading()) {
        <div class="kpis">@for (i of [1, 2, 3, 4, 5, 6]; track i) { <div class="skeleton kpi-skel"></div> }</div>
        <div class="chartgrid"><div class="skeleton skeleton-card tall"></div><div class="skeleton skeleton-card tall"></div></div>
        <div class="skeleton skeleton-card"></div>
      } @else if (error()) {
        <div class="card">
          <div class="empty-state">
            <div class="es-icon"><app-icon name="warning" [size]="24" /></div>
            <h3>Analytics unavailable</h3>
            <p>{{ error() }}</p>
            <button class="btn" (click)="load()"><app-icon name="refresh" [size]="14" /> Retry</button>
          </div>
        </div>
      } @else if (tab() === 'processes') {
        <!-- ============================== Processes tab ============================== -->
        <div class="kpis">
          @for (k of kpis(); track k.label) {
            <div class="card kpi">
              <div class="kv tnum" [style.color]="k.color || null">{{ k.value }}</div>
              <div class="kl">{{ k.label }}</div>
            </div>
          }
        </div>

        <div class="chartgrid">
          <section class="card chart">
            <div class="row charthead">
              <h3>Instances by status</h3>
              <div class="spacer"></div>
              <span class="muted small tnum">{{ instTotal() }} total</span>
            </div>
            <p class="chartsub">every instance ever started, grouped by its current state</p>
            @if (instTotal() > 0) {
              <div class="barlist">
                @for (r of instStatusRows(); track r.key) {
                  <div class="barrow">
                    <div class="row lab">
                      <span class="dot" [style.background]="r.color"></span>
                      <span>{{ r.label }}</span>
                      <div class="spacer"></div>
                      <span class="tnum muted">{{ r.count }}</span>
                    </div>
                    <div class="track"><span [style.width.%]="r.pctOfMax" [style.background]="r.color"></span></div>
                  </div>
                }
              </div>
            } @else {
              <p class="nodata">No instances yet — start one from a deployment to populate analytics.</p>
            }
          </section>

          <section class="card chart donutcard">
            <div class="row charthead"><h3>Completed vs. running mix</h3></div>
            @if (instTotal() > 0) {
              <div class="donutwrap">
                <div class="donut" [style.background]="instDonut()" role="img" aria-label="Instance status distribution">
                  <div class="hole"><span class="tnum">{{ instTotal() }}</span></div>
                </div>
                <div class="legend">
                  @for (r of nonZero(instStatusRows()); track r.key) {
                    <div class="li"><span class="sw" [style.background]="r.color"></span> {{ r.label }} · {{ r.share }}%</div>
                  }
                </div>
              </div>
            } @else {
              <p class="nodata">Nothing to chart yet.</p>
            }
          </section>
        </div>

        <section class="card tablecard">
          <div class="row cardhead">
            <h3>Duration by process</h3>
            <div class="spacer"></div>
            <span class="muted small">completed instances only</span>
          </div>
          @if (byProcess().length) {
            <table>
              <thead><tr><th>Process</th><th class="num">Count</th><th class="num">Avg duration</th><th class="num">Min</th><th class="num">Max</th></tr></thead>
              <tbody>
                @for (p of byProcess(); track p.processId) {
                  <tr>
                    <td><b>{{ p.processId }}</b></td>
                    <td class="num tnum">{{ p.count }}</td>
                    <td class="num">
                      <span class="avgcell">
                        <span class="avgbar"><span [style.width.%]="pctOf(p.avgMs, maxProcAvg())"></span></span>
                        <span class="tnum">{{ ms(p.avgMs) }}</span>
                      </span>
                    </td>
                    <td class="num tnum muted">{{ ms(p.minMs) }}</td>
                    <td class="num tnum muted">{{ ms(p.maxMs) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <p class="nodata pad">No completed instances yet.</p>
          }
        </section>

      } @else if (tab() === 'tasks') {
        <!-- ============================== Tasks tab ============================== -->
        <div class="kpis">
          @for (k of taskKpis(); track k.label) {
            <div class="card kpi">
              <div class="kv tnum" [style.color]="k.color || null">{{ k.value }}</div>
              <div class="kl">{{ k.label }}</div>
            </div>
          }
        </div>

        <div class="chartgrid">
          <section class="card chart">
            <div class="row charthead">
              <h3>Open tasks by status</h3>
              <div class="spacer"></div>
              <span class="muted small tnum">{{ openTotal() }} open</span>
            </div>
            <p class="chartsub">current queue across all groups and assignees</p>
            @if (openTotal() > 0) {
              <div class="barlist">
                @for (r of taskStatusRows(); track r.key) {
                  <div class="barrow">
                    <div class="row lab">
                      <span class="dot" [style.background]="r.color"></span>
                      <span>{{ r.label }}</span>
                      <div class="spacer"></div>
                      <span class="tnum muted">{{ r.count }}</span>
                    </div>
                    <div class="track"><span [style.width.%]="r.pctOfMax" [style.background]="r.color"></span></div>
                  </div>
                }
              </div>
            } @else {
              <p class="nodata">No open tasks right now — all work is completed.</p>
            }
          </section>

          <section class="card chart donutcard">
            <div class="row charthead"><h3>Task state mix</h3></div>
            @if (openTotal() > 0) {
              <div class="donutwrap">
                <div class="donut" [style.background]="taskDonut()" role="img" aria-label="Open task status distribution">
                  <div class="hole"><span class="tnum">{{ openTotal() }}</span></div>
                </div>
                <div class="legend">
                  @for (r of nonZero(taskStatusRows()); track r.key) {
                    <div class="li"><span class="sw" [style.background]="r.color"></span> {{ r.label }} · {{ r.share }}%</div>
                  }
                </div>
              </div>
            } @else {
              <p class="nodata">Nothing to chart yet.</p>
            }
          </section>
        </div>

        <div class="two-col">
          <section class="card tablecard">
            <div class="row cardhead"><h3>Open tasks by assignee</h3></div>
            @if (byAssignee().length) {
              <table>
                <thead><tr><th>Assignee</th><th class="num">Open tasks</th><th style="width: 120px;">Load ratio</th></tr></thead>
                <tbody>
                  @for (a of byAssignee(); track a.user) {
                    <tr>
                      <td><b>{{ a.user || '(unassigned)' }}</b></td>
                      <td class="num tnum">{{ a.count }}</td>
                      <td>
                        <span class="avgcell">
                          <span class="avgbar"><span [style.width.%]="loadRatio(a.count) * 100" [style.background]="loadColor(a.count)"></span></span>
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            } @else {
              <p class="nodata pad">No assigned tasks right now.</p>
            }
          </section>

          <section class="card tablecard">
            <div class="row cardhead">
              <h3>Duration by user task</h3>
              <div class="spacer"></div>
              <span class="muted small">completed tasks only</span>
            </div>
            @if (byTask().length) {
              <table>
                <thead><tr><th>Task</th><th class="num">Count</th><th class="num">Avg completion</th></tr></thead>
                <tbody>
                  @for (t of byTask(); track t.name) {
                    <tr>
                      <td><b>{{ t.name }}</b></td>
                      <td class="num tnum">{{ t.count }}</td>
                      <td class="num">
                        <span class="avgcell">
                          <span class="avgbar"><span [style.width.%]="pctOf(t.avgMs, maxTaskAvg())"></span></span>
                          <span class="tnum">{{ ms(t.avgMs) }}</span>
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            } @else {
              <p class="nodata pad">No completed human tasks yet.</p>
            }
          </section>
        </div>

      } @else if (tab() === 'cases') {
        <!-- ============================== Cases tab ============================== -->
        <div class="grid" style="margin-bottom: 20px;">
          <div class="card">
            <h3>Cases by status</h3>
            @if (caseSummary(); as s) {
              <p class="big">{{ s.total }}</p>
              @for (kv of statusEntries(s.byStatus); track kv[0]) {
                <div class="kvrow"><span>{{ kv[0] }}</span><span class="tnum font-bold">{{ kv[1] }}</span></div>
              }
              @if (s.withoutPiid) { <p class="muted sm" style="margin-top:8px;">{{ s.withoutPiid }} initiated without BPM instance</p> }
            } @else { <p class="muted">Loading case summary…</p> }
          </div>
          <div class="card">
            <h3>TAT by Workflow Definition (Case Level)</h3>
            @if (tat(); as t) {
              @for (r of t.byWorkflowName; track r.workflowName) {
                <div class="kvrow">
                  <span>{{ r.workflowName }}</span>
                  <span class="tnum">{{ ms(r.avgMs) }} avg ({{ r.count }})</span>
                </div>
              }
              @if (!t.byWorkflowName.length) { <p class="muted sm">No completed cases yet.</p> }
            } @else { <p class="muted">Loading TAT…</p> }
          </div>
          <div class="card">
            <h3>TAT by User (Task Execution)</h3>
            @if (tat(); as t) {
              @for (r of t.byUser; track r.user) {
                <div class="kvrow">
                  <span>{{ r.user }}</span>
                  <span class="tnum">{{ ms(r.avgMs) }} avg ({{ r.count }})</span>
                </div>
              }
              @if (!t.byUser.length) { <p class="muted sm">No completed tasks yet.</p> }
            } @else { <p class="muted">Loading TAT…</p> }
          </div>
        </div>

      } @else if (tab() === 'queries') {
        <!-- ============================== Queries tab ============================== -->
        <h2 class="section-h">Custom Ad-Hoc Query</h2>
        <div class="card pad" style="margin-bottom: 20px;">
          <div class="row" style="flex-wrap: wrap; gap: 12px; margin-bottom: 12px;">
            <label class="fld"><span>Entity</span>
              <select [(ngModel)]="entity">@for (e of entities; track e) { <option [value]="e">{{ e }}</option> }</select>
            </label>
            <label class="fld"><span>Group by (optional)</span>
              <input [(ngModel)]="groupBy" placeholder="e.g. status, data.amount" />
            </label>
            <label class="fld"><span>Metric</span>
              <select [(ngModel)]="metric">
                <option value="">(none — list rows)</option>
                <option value="count">count</option>
                <option value="avgDurationMs">avgDurationMs</option>
              </select>
            </label>
            @if (metric === 'avgDurationMs') {
              <label class="fld"><span>Duration from field</span><input [(ngModel)]="durationFrom" placeholder="createdAt" /></label>
              <label class="fld"><span>Duration to field</span><input [(ngModel)]="durationTo" placeholder="updatedAt" /></label>
            }
          </div>

          <div class="section-title">Filters</div>
          @for (f of filters; track f) {
            <div class="fieldrow">
              <input class="fkey" [(ngModel)]="f.field" placeholder="field, e.g. data.amount" />
              <select [(ngModel)]="f.op">@for (o of ops; track o) { <option [value]="o">{{ o }}</option> }</select>
              <input [(ngModel)]="f.value" placeholder="value" />
              <button class="btn sm danger" (click)="removeFilter(f)"><app-icon name="trash" [size]="12" /></button>
            </div>
          }
          <div style="margin-bottom: 14px;">
            <button class="btn sm" (click)="addFilter()"><app-icon name="plus" [size]="12" /> Add filter</button>
          </div>

          <div class="row actionrow">
            <button class="btn primary sm" (click)="runQuery()"><app-icon name="play" [size]="12" /> Run Query</button>
            <input class="save-name" [(ngModel)]="saveName" placeholder="Save as…" style="max-width: 200px;" />
            <label class="reqlbl"><input type="checkbox" [(ngModel)]="saveShared" /> Shared</label>
            <button class="btn sm" (click)="saveQuery()">Save Query</button>
          </div>
          @if (queryError()) { <p class="err">{{ queryError() }}</p> }

          @if (queryResult(); as r) {
            <div style="margin-top: 16px;">
              <div class="section-title">Query Results</div>
              @if (r.groups) {
                <table class="restbl"><thead><tr><th>Key</th><th>Count</th>@if (metric==='avgDurationMs') { <th>Avg ms</th> }</tr></thead>
                  <tbody>@for (g of r.groups; track g.key) { <tr><td>{{ g.key }}</td><td>{{ g.count }}</td>@if (metric==='avgDurationMs') { <td>{{ g.avgDurationMs }}</td> }</tr> }</tbody>
                </table>
              } @else {
                <pre class="mono sm restext">{{ r.rows | json }}</pre>
              }
            </div>
          }
        </div>

        <h2 class="section-h">Saved Queries</h2>
        <div class="card pad">
          @if (savedQueries().length === 0) {
            <p class="muted sm">No saved queries yet. Configure a query above and save it to access it anytime.</p>
          } @else {
            @for (sq of savedQueries(); track sq.id) {
              <div class="sqrow">
                <div>
                  <strong>{{ sq.name }}</strong>
                  <span class="muted sm"> · {{ sq.definition.entity }} · by {{ sq.createdBy }}</span>
                </div>
                <div class="row" style="gap: 6px;">
                  <button class="btn sm" (click)="loadSavedQuery(sq)">Load</button>
                  <button class="btn sm danger" (click)="deleteSavedQuery(sq)"><app-icon name="trash" [size]="12" /></button>
                </div>
              </div>
            }
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 20px 24px; max-width: 1200px; }
    .crumbwrap { margin-bottom: 10px; }
    .pagehead { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
    h1 { font-size: 20px; margin: 0; }
    .sub { margin: 2px 0 0; font-size: 13px; color: var(--muted); }
    .spacer { flex: 1; }
    .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 18px; }
    .tabs button { border: none; background: transparent; padding: 10px 14px; font-size: 13.5px; font-weight: 600; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; }
    .tabs button.active { color: var(--primary); border-bottom-color: var(--primary); }

    /* KPIs */
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .kpi { padding: 14px 16px; }
    .kv { font-size: 24px; font-weight: 700; line-height: 1.1; margin-bottom: 4px; }
    .kl { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
    .tnum { font-variant-numeric: tabular-nums; }
    .font-bold { font-weight: 700; }
    .kpi-skel { height: 76px; }

    /* Charts */
    .chartgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px; }
    @media (max-width: 860px) { .chartgrid { grid-template-columns: 1fr; } }
    .chart { padding: 16px; }
    .charthead { display: flex; align-items: center; margin-bottom: 2px; }
    .charthead h3 { font-size: 14px; margin: 0; }
    .chartsub { font-size: 12px; color: var(--muted); margin: 0 0 14px; }
    .barlist { display: flex; flex-direction: column; gap: 10px; }
    .lab { font-size: 12.5px; margin-bottom: 3px; display: flex; align-items: center; gap: 6px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .track { width: 100%; height: 6px; background: var(--surface-3); border-radius: var(--radius-pill); overflow: hidden; }
    .track span { display: block; height: 100%; border-radius: var(--radius-pill); transition: width .3s ease; }
    .nodata { color: var(--muted); font-size: 12.5px; padding: 20px 0; text-align: center; }

    /* Donut */
    .donutcard .donutwrap { display: flex; align-items: center; gap: 24px; padding: 10px 0; }
    .donut { width: 120px; height: 120px; border-radius: 50%; display: grid; place-items: center; flex-shrink: 0; }
    .hole { width: 76px; height: 76px; border-radius: 50%; background: var(--surface); display: grid; place-items: center; font-weight: 650; font-size: 18px; }
    .legend { display: flex; flex-direction: column; gap: 8px; font-size: 12.5px; color: var(--text-secondary); }
    .legend .li { display: flex; align-items: center; gap: 7px; }
    .sw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; flex-shrink: 0; }

    /* Duration tables */
    .tablecard { overflow: hidden; margin-bottom: 18px; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 860px) { .two-col { grid-template-columns: 1fr; } }
    .cardhead { padding: 14px 16px 10px; display: flex; align-items: center; }
    .cardhead h3 { font-size: 14px; margin: 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 9px 14px; font-size: 12.5px; border-bottom: 1px solid var(--border); }
    th.num, td.num { text-align: right; }
    .avgcell { display: inline-flex; align-items: center; gap: 8px; }
    .avgbar { width: 64px; height: 6px; background: var(--surface-3); border-radius: var(--radius-pill); overflow: hidden; flex-shrink: 0; }
    .avgbar span { display: block; height: 100%; border-radius: var(--radius-pill); background: var(--grad-brand); }
    .pad { padding: 16px; }
    .small { font-size: 11.5px; }

    /* Case metrics */
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
    .grid .card { padding: 16px; }
    .big { font-size: 32px; font-weight: 700; margin: 4px 0 12px; }
    .kvrow { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px; }

    /* Query builder */
    .section-h { font-size: 15px; margin: 20px 0 10px; }
    .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 700; margin: 12px 0 6px; }
    .fld { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
    .fld input, .fld select { border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-size: 13px; background: var(--surface); color: inherit; }
    .fieldrow { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
    .fieldrow input, .fieldrow select { border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-size: 13px; background: var(--surface); color: inherit; }
    .fieldrow .fkey { width: 180px; }
    .actionrow { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
    .reqlbl { font-size: 12.5px; display: inline-flex; align-items: center; gap: 4px; }
    .restbl { width: 100%; margin-top: 8px; }
    .restext { background: var(--surface-2); padding: 12px; border-radius: 8px; max-height: 280px; overflow: auto; font-family: var(--font-mono); font-size: 12px; }
    .sqrow { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border); }
    .sqrow:last-child { border-bottom: none; }
    .err { color: var(--red); font-size: 12px; margin-top: 6px; }
    .btn.danger { color: var(--red); }
  `],
})
export class ReportsComponent {
  private api = inject(QueryApiService);
  private analyticsApi = inject(WorkflowAnalyticsApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(ToastService);

  tab = signal<ReportsTab>('processes');
  loading = signal(true);
  error = signal<string | null>(null);

  summary = signal<Summary | null>(null);
  procs = signal<ProcessAnalytics | null>(null);
  tasks = signal<TaskAnalytics | null>(null);

  // Cases analytics
  caseSummary = signal<WorkflowInstanceSummary | null>(null);
  tat = signal<WorkflowTat | null>(null);

  // Custom Query
  entities = ENTITIES;
  ops = OPS;
  entity: QueryableEntity = 'workflowInstance';
  groupBy = '';
  metric: 'count' | 'avgDurationMs' | '' = '';
  durationFrom = '';
  durationTo = '';
  filters: QueryFilter[] = [];
  queryResult = signal<QueryRunResult | null>(null);
  queryError = signal('');
  saveName = '';
  saveShared = false;
  savedQueries = signal<SavedQuery[]>([]);

  tabLabel = computed(() => {
    switch (this.tab()) {
      case 'tasks': return 'Tasks';
      case 'cases': return 'Cases & Workflows';
      case 'queries': return 'Ad-Hoc Queries';
      default: return 'Processes';
    }
  });

  constructor() {
    this.route.queryParamMap.subscribe((m) => {
      const t = m.get('tab') as ReportsTab;
      if (t && ['processes', 'tasks', 'cases', 'queries'].includes(t)) {
        this.tab.set(t);
      } else {
        this.tab.set('processes');
      }
    });
    this.load();
    this.loadCaseAnalytics();
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    forkJoin({
      summary: this.api.analyticsSummary(),
      procs: this.api.analyticsProcesses(),
      tasks: this.api.analyticsTasks(),
    }).subscribe({
      next: ({ summary, procs, tasks }) => {
        this.summary.set(summary); this.procs.set(procs); this.tasks.set(tasks);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(e?.error?.error?.message || 'Could not load analytics from the server.');
        this.loading.set(false);
      },
    });
  }

  loadCaseAnalytics() {
    this.analyticsApi.summary().subscribe({ next: (s) => this.caseSummary.set(s), error: () => {} });
    this.analyticsApi.tat().subscribe({ next: (t) => this.tat.set(t), error: () => {} });
    this.analyticsApi.listSavedQueries().subscribe({ next: (q: SavedQuery[]) => this.savedQueries.set(q), error: () => {} });
  }

  setTab(t: ReportsTab) {
    this.router.navigate([], { relativeTo: this.route, queryParams: { tab: t }, queryParamsHandling: 'merge' });
  }

  // ---- Processes Tab ----
  kpis = computed(() => {
    const s = this.summary();
    if (!s) return [];
    return [
      { label: 'Total instances', value: s.instances.total, color: '' },
      { label: 'Running', value: s.instances.byStatus['running'] ?? 0, color: 'var(--blue)' },
      { label: 'Completed', value: s.instances.byStatus['completed'] ?? 0, color: 'var(--green)' },
      { label: 'Failed', value: s.instances.byStatus['failed'] ?? 0, color: 'var(--red)' },
      { label: 'Active deployments', value: s.deployments.active, color: 'var(--purple)' },
      { label: 'Scheduled jobs', value: s.jobs.scheduled, color: 'var(--amber)' },
    ];
  });

  instStatusRows = computed<StatusRow[]>(() => this.statusRows(this.procs()?.byStatus, INSTANCE_STATUSES));
  instTotal = computed(() => this.instStatusRows().reduce((a, r) => a + r.count, 0));
  instDonut = computed(() => this.donutGradient(this.instStatusRows()));
  byProcess = computed(() => [...(this.procs()?.byProcess ?? [])].sort((a, b) => b.count - a.count));
  maxProcAvg = computed(() => Math.max(...this.byProcess().map((p) => p.avgMs), 1));

  // ---- Tasks Tab ----
  taskKpis = computed(() => {
    const s = this.summary();
    if (!s) return [];
    return [
      { label: 'Total tasks', value: s.tasks.total, color: '' },
      { label: 'In Progress', value: s.tasks.byStatus['inprogress'] ?? 0, color: 'var(--blue)' },
      { label: 'Reserved / Claimed', value: s.tasks.byStatus['reserved'] ?? 0, color: 'var(--purple)' },
      { label: 'Created / Queue', value: s.tasks.byStatus['created'] ?? 0, color: 'var(--amber)' },
      { label: 'Error', value: s.tasks.byStatus['error'] ?? 0, color: 'var(--red)' },
      { label: 'Active Process Trees', value: s.instances.byStatus['running'] ?? 0, color: '' },
    ];
  });

  taskStatusRows = computed<StatusRow[]>(() => this.statusRows(this.tasks()?.openByStatus, TASK_STATUSES));
  openTotal = computed(() => this.taskStatusRows().reduce((a, r) => a + r.count, 0));
  taskDonut = computed(() => this.donutGradient(this.taskStatusRows()));
  byAssignee = computed(() => [...(this.tasks()?.byAssignee ?? [])].sort((a, b) => b.count - a.count));
  maxAssigneeCount = computed(() => Math.max(...this.byAssignee().map((w) => w.count), 1));
  byTask = computed(() => [...(this.tasks()?.byTask ?? [])].sort((a, b) => b.count - a.count));
  maxTaskAvg = computed(() => Math.max(...this.byTask().map((t) => t.avgMs), 1));

  // ---- Cases Tab Helpers ----
  statusEntries(byStatus: Record<string, number>): [string, number][] {
    return Object.entries(byStatus || {});
  }

  // ---- Custom Queries ----
  addFilter() { this.filters.push({ field: '', op: 'eq', value: '' }); }
  removeFilter(f: QueryFilter) { this.filters = this.filters.filter((x) => x !== f); }

  private buildDef(): QueryDefinition {
    const d: QueryDefinition = { entity: this.entity };
    const validFilters = this.filters.filter((f) => f.field.trim());
    if (validFilters.length) d.filters = validFilters;
    if (this.groupBy.trim()) d.groupBy = this.groupBy.trim();
    if (this.metric) {
      d.metric = this.metric;
      if (this.metric === 'avgDurationMs') {
        d.durationFrom = this.durationFrom.trim() || undefined;
        d.durationTo = this.durationTo.trim() || undefined;
      }
    }
    return d;
  }

  runQuery() {
    this.queryError.set('');
    this.analyticsApi.runQuery(this.buildDef()).subscribe({
      next: (res) => this.queryResult.set(res),
      error: (e) => this.queryError.set(e?.error?.error?.message || 'Query failed'),
    });
  }

  saveQuery() {
    if (!this.saveName.trim()) { this.queryError.set('Name is required to save'); return; }
    this.analyticsApi.saveQuery(this.saveName.trim(), this.buildDef(), this.saveShared).subscribe({
      next: () => {
        this.toast.success('Query saved');
        this.saveName = '';
        this.loadCaseAnalytics();
      },
      error: (e) => this.queryError.set(e?.error?.error?.message || 'Failed to save query'),
    });
  }

  loadSavedQuery(sq: SavedQuery) {
    this.entity = sq.definition.entity;
    this.groupBy = sq.definition.groupBy || '';
    this.metric = sq.definition.metric || '';
    this.durationFrom = sq.definition.durationFrom || '';
    this.durationTo = sq.definition.durationTo || '';
    this.filters = sq.definition.filters ? [...sq.definition.filters] : [];
    this.runQuery();
  }

  deleteSavedQuery(sq: SavedQuery) {
    this.analyticsApi.deleteSavedQuery(sq.id).subscribe({
      next: () => {
        this.toast.success('Query deleted');
        this.savedQueries.update((l) => l.filter((x) => x.id !== sq.id));
      },
      error: (e: any) => this.toast.error(e?.error?.error?.message || 'Delete failed'),
    });
  }

  // ---- General Helpers ----
  ms = humanMs;
  pctOf(v: number, max: number): number { return max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0; }
  nonZero(rows: StatusRow[]): StatusRow[] { return rows.filter((r) => r.count > 0); }
  loadRatio(count: number): number { return count / this.maxAssigneeCount(); }
  loadColor(count: number): string {
    const r = this.loadRatio(count);
    return r > 0.75 ? 'var(--red)' : r > 0.4 ? 'var(--amber)' : 'var(--green)';
  }

  private statusRows(byStatus: Record<string, number> | undefined, meta: { key: string; label: string; color: string }[]): StatusRow[] {
    if (!byStatus) return [];
    const known = meta.map((m) => ({ ...m, count: byStatus[m.key] ?? 0 }));
    const extra = Object.keys(byStatus)
      .filter((k) => !meta.some((m) => m.key === k) && byStatus[k] > 0)
      .map((k) => ({ key: k, label: k, color: 'var(--muted)', count: byStatus[k] }));
    const rows = [...known, ...extra];
    const total = rows.reduce((a, r) => a + r.count, 0);
    const max = Math.max(...rows.map((r) => r.count), 1);
    return rows.map((r) => ({
      ...r,
      pctOfMax: (r.count / max) * 100,
      share: total ? Math.round((r.count / total) * 100) : 0,
    }));
  }

  private donutGradient(rows: StatusRow[]): string {
    const active = rows.filter((r) => r.count > 0);
    const total = active.reduce((a, r) => a + r.count, 0);
    if (!total) return 'var(--surface-3)';
    let acc = 0;
    const stops = active.map((r) => {
      const from = (acc / total) * 100;
      acc += r.count;
      const to = (acc / total) * 100;
      return `${r.color} ${from.toFixed(2)}% ${to.toFixed(2)}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }

  exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    let header: string[]; let rows: unknown[][]; let name: string;
    if (this.tab() === 'processes') {
      header = ['Process', 'Count', 'Avg (ms)', 'Min (ms)', 'Max (ms)'];
      rows = this.byProcess().map((p) => [p.processId, p.count, p.avgMs, p.minMs, p.maxMs]);
      name = 'reports-processes.csv';
    } else if (this.tab() === 'tasks') {
      header = ['Task', 'Count', 'Avg (ms)', 'Min (ms)', 'Max (ms)'];
      rows = this.byTask().map((t) => [t.name, t.count, t.avgMs, t.minMs, t.maxMs]);
      name = 'reports-tasks.csv';
    } else {
      header = ['Workflow', 'Count', 'Avg (ms)'];
      rows = (this.tat()?.byWorkflowName || []).map((w) => [w.workflowName, w.count, w.avgMs]);
      name = 'reports-cases.csv';
    }
    const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }
}
