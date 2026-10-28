import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { JsonPipe } from '@angular/common';
import { OpsApiService } from '../../core/api/ops-api.service';
import { ToastService } from '../../shared/toast.service';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { IconComponent } from '../../shared/icon.component';
import type { AuditEvent } from '../../core/models';

/** Audit Log (ux_design/mockups/audit-log.html): admin-only read of the trail every service writes
 *  via ctx.audit() server-side. List + detail with a before/after diff when the event carries one. */
@Component({
  selector: 'app-audit-log',
  standalone: true,
  imports: [IconComponent, RouterLink, FormsModule, JsonPipe, BreadcrumbComponent],
  template: `
    <div class="page">
      <div class="crumbwrap"><app-breadcrumb [crumbs]="[{ label: 'Admin', link: ['/admin'] }, { label: 'Audit Log' }]" /></div>
      <header class="pagehead">
        <h1>Audit Log</h1>
        <p class="muted">Every action recorded by the engine — who did what, when, to what.</p>
      </header>

      <div class="split">
        <div class="col listcol">
          <div class="filterbar">
            <select [(ngModel)]="actorFilter" (ngModelChange)="reload()">
              <option value="">Actor: all</option>
              @for (a of facets()?.actors || []; track a) { <option [value]="a">{{ a }}</option> }
            </select>
            <select [(ngModel)]="kindFilter" (ngModelChange)="reload()">
              <option value="">Action: all</option>
              @for (k of kindOptions(); track k) { <option [value]="k">{{ k }}</option> }
            </select>
            <input placeholder="Instance id" [(ngModel)]="instanceIdFilter" (ngModelChange)="reload()" style="width:140px;" />
            <input placeholder="Task id" [(ngModel)]="taskIdFilter" (ngModelChange)="reload()" style="width:140px;" />
            <span class="spacer"></span>
            <button class="btn ghost sm" (click)="resetFilters()">Reset</button>
          </div>

          <div class="card listcard">
            @if (loading()) {
              <div class="pad"><div class="skeleton skeleton-line" style="width:60%"></div><div class="skeleton skeleton-line" style="width:80%"></div></div>
            } @else if (items().length === 0) {
              <div class="empty-state">
                <div class="es-icon"><app-icon name="list" [size]="22" /></div>
                <h3>No audit events match</h3>
                <p>Try widening the filters above.</p>
              </div>
            } @else {
              <table>
                <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>PIID</th></tr></thead>
                <tbody>
                  @for (e of items(); track e.id) {
                    <tr [class.sel]="selected()?.id === e.id" (click)="select(e)">
                      <td class="muted">{{ ago(e.at) }}</td>
                      <td>{{ e.actor }}</td>
                      <td><span class="badge">{{ e.kind }}</span></td>
                      <td>{{ entityLabel(e) }}</td>
                      <td>@if (e.instanceId) { <a class="ident" [routerLink]="['/instances', e.instanceId]" (click)="$event.stopPropagation()">{{ shortId(e.instanceId) }}</a> } @else { <span class="muted">—</span> }</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
          <div class="row pager">
            <span class="muted">Showing {{ items().length ? offset() + 1 : 0 }}–{{ offset() + items().length }} of {{ total() }}</span>
            <span class="spacer"></span>
            <span class="muted">Rows</span>
            <select [(ngModel)]="limit" (ngModelChange)="reload()" style="width:70px;"><option [ngValue]="10">10</option><option [ngValue]="20">20</option><option [ngValue]="50">50</option><option [ngValue]="100">100</option></select>
            <button class="btn sm" [disabled]="offset() === 0" (click)="prevPage()">‹ Prev</button>
            <button class="btn sm" [disabled]="offset() + items().length >= total()" (click)="nextPage()">Next ›</button>
          </div>
        </div>

        <div class="card detailcard">
          @if (selected(); as e) {
            <h2>{{ e.kind }}</h2>
            <p class="muted small">{{ e.actor }} · {{ ago(e.at) }} · {{ entityLabel(e) }}</p>

            @if (diffChanges(e); as changes) {
              @for (c of changes; track c.name) {
                <div class="section-title" style="margin-top:0;">{{ c.name }}</div>
                <div class="diffrow">
                  <pre class="diffbox before">{{ fmt(c.from) }}</pre>
                  <pre class="diffbox after">{{ fmt(c.to) }}</pre>
                </div>
              }
            } @else if (e.data) {
              <div class="section-title" style="margin-top:0;">Data</div>
              <pre class="msgbox">{{ e.data | json }}</pre>
            } @else {
              <p class="muted small">No additional data recorded for this event.</p>
            }
          } @else {
            <div class="empty-state">
              <div class="es-icon"><app-icon name="search" [size]="22" /></div>
              <h3>No event selected</h3>
              <p>Select a row to see its full detail and before/after diff.</p>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 20px 24px; height: 100%; display: flex; flex-direction: column; min-height: 0; }
    .crumbwrap { margin-bottom: 8px; }
    .pagehead { margin-bottom: 14px; }
    h1 { font-size: 19px; margin: 0; }
    .pagehead p { margin: 4px 0 0; font-size: 13px; color: var(--muted); }
    .split { display: grid; grid-template-columns: 1fr 380px; gap: 16px; flex: 1; min-height: 0; }
    .listcol { display: flex; flex-direction: column; min-height: 0; }
    .filterbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .listcard { flex: 1; overflow: auto; padding: 0; }
    tbody tr { cursor: pointer; } tbody tr:hover { background: var(--surface-2); } tr.sel td { background: var(--primary-50); }
    .ident { font-family: var(--font-mono); font-weight: 600; color: var(--primary); font-size: 12.5px; text-decoration: none; }
    .ident:hover { text-decoration: underline; }
    .pager { margin-top: 10px; font-size: 12.5px; }
    .detailcard { padding: 18px; overflow: auto; }
    h2 { font-size: 15px; margin: 0; }
    .small { font-size: 12.5px; margin: 0 0 14px; }
    .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 700; margin: 12px 0 6px; }
    .msgbox { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px; font-size: 11.5px; font-family: var(--font-mono); white-space: pre-wrap; margin: 0; max-height: 320px; overflow: auto; }
    .diffrow { display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; }
    .diffbox { font-size: 11.5px; font-family: var(--font-mono); padding: 8px 10px; border-radius: var(--radius-sm); margin: 0; white-space: pre-wrap; border: 1px solid var(--border); }
    .diffbox.before { background: var(--red-bg); color: var(--red); border-color: transparent; }
    .diffbox.after { background: var(--green-bg); color: var(--green); border-color: transparent; }
    .pad { padding: 16px; }
  `],
})
export class AuditLogComponent {
  private api = inject(OpsApiService);
  private toast = inject(ToastService);

  actorFilter = '';
  kindFilter = '';
  instanceIdFilter = '';
  taskIdFilter = '';
  limit = 20;
  offset = signal(0);

  items = signal<AuditEvent[]>([]);
  total = signal(0);
  loading = signal(true);
  selected = signal<AuditEvent | null>(null);
  facets = signal<{ kinds: string[]; actors: string[] } | null>(null);

  /** Exact kinds plus their dotted category prefixes ('task.', 'instance.', …) so the dropdown offers
   *  both "every task.* event" and one specific kind, matching the mockup's "Action: role.* ▾" chip. */
  kindOptions = computed(() => {
    const kinds = this.facets()?.kinds || [];
    const prefixes = new Set(kinds.map((k) => k.split('.')[0] + '.').filter((p) => p !== '.'));
    return [...new Set([...prefixes, ...kinds])].sort();
  });

  constructor() {
    this.api.auditFacets().subscribe((f) => this.facets.set(f));
    this.reload();
  }

  resetFilters() {
    this.actorFilter = ''; this.kindFilter = ''; this.instanceIdFilter = ''; this.taskIdFilter = '';
    this.offset.set(0); this.reload();
  }

  reload() {
    this.loading.set(true);
    this.api.listAudit({
      actor: this.actorFilter || undefined,
      kind: this.kindFilter || undefined,
      instanceId: this.instanceIdFilter || undefined,
      taskId: this.taskIdFilter || undefined,
      limit: this.limit, offset: this.offset(),
    }).subscribe({
      next: (r) => { this.items.set(r.items); this.total.set(r.total); this.loading.set(false); if (!this.selected() && r.items[0]) this.selected.set(r.items[0]); },
      error: (e) => { this.loading.set(false); this.toast.error(e?.error?.error?.message || 'Could not load audit log'); },
    });
  }

  nextPage() { this.offset.update((o) => o + this.limit); this.reload(); }
  prevPage() { this.offset.update((o) => Math.max(0, o - this.limit)); this.reload(); }

  select(e: AuditEvent) { this.selected.set(e); }

  entityLabel(e: AuditEvent): string {
    if (e.taskId) return `Task ${this.shortId(e.taskId)}`;
    if (e.instanceId) return `Instance ${this.shortId(e.instanceId)}`;
    if (e.deploymentId) return `Deployment ${this.shortId(e.deploymentId)}`;
    if (e.workflowId) return `Project ${this.shortId(e.workflowId)}`;
    const name = (e.data as any)?.name || (e.data as any)?.username;
    return name ? String(name) : '—';
  }

  /** Renders a before/after diff when `data` looks like {changes:[{name,from,to}]} (instance
   *  variable edits, task admin edits) — otherwise falls back to a raw JSON dump. */
  diffChanges(e: AuditEvent): Array<{ name: string; from: unknown; to: unknown }> | null {
    const changes = (e.data as any)?.changes;
    if (Array.isArray(changes) && changes.every((c) => c && typeof c === 'object' && 'name' in c)) return changes;
    return null;
  }

  fmt(v: unknown): string {
    if (v === undefined) return '(none)';
    return typeof v === 'string' ? v : JSON.stringify(v);
  }

  shortId(id: string): string { return id.length > 8 ? `…${id.slice(-7)}` : id; }
  ago(iso: string): string {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86_400)}d ago`;
  }
}
