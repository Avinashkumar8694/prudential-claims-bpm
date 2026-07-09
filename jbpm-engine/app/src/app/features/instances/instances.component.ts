import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { JsonPipe, SlicePipe } from '@angular/common';
import { ApiService } from '../../core/api.service';
import { RealtimeService } from '../../core/realtime.service';
import type { Deployment, Instance } from '../../core/models';

const VISUAL: Record<string, { icon: string; color: string }> = {
  start: { icon: '▶', color: '#16a34a' }, end: { icon: '■', color: '#dc2626' }, script: { icon: '{ }', color: '#0891b2' },
  http: { icon: '🌐', color: '#0d9488' }, userTask: { icon: '👤', color: '#2563eb' }, rule: { icon: '📐', color: '#ea580c' },
  send: { icon: '📤', color: '#16a34a' }, receive: { icon: '📥', color: '#16a34a' }, manual: { icon: '✋', color: '#64748b' },
  gateway: { icon: '◇', color: '#f59e0b' }, catch: { icon: '⏱', color: '#7c3aed' }, throw: { icon: '📣', color: '#7c3aed' },
  boundary: { icon: '⚠', color: '#dc2626' }, subprocess: { icon: '▭', color: '#4f46e5' }, call: { icon: '⇥', color: '#4f46e5' }, forEach: { icon: '⇶', color: '#4f46e5' }, workItem: { icon: '⚙', color: '#0891b2' },
};
const NW = 150, NH = 52;
type Tab = 'details' | 'variables' | 'logs' | 'diagram';
const STATES: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: '', label: 'All', match: () => true },
  { key: 'active', label: 'Active', match: (s) => s === 'running' || s === 'waiting' },
  { key: 'completed', label: 'Completed', match: (s) => s === 'completed' },
  { key: 'aborted', label: 'Aborted', match: (s) => s === 'aborted' },
  { key: 'failed', label: 'Errors', match: (s) => s === 'failed' },
  { key: 'suspended', label: 'Suspended', match: (s) => s === 'suspended' },
];

@Component({
  selector: 'app-instances',
  standalone: true,
  imports: [RouterLink, FormsModule, JsonPipe, SlicePipe],
  template: `
    <div class="page">
      <header class="pagehead">
        <a class="icon-btn" [routerLink]="wfId ? ['/projects', wfId] : ['/projects']" title="Back">‹</a>
        <h1>Process Instances</h1>
        <span class="spacer"></span>
        <button class="btn" (click)="reload()">↻ Refresh</button>
      </header>

      <div class="split">
        <!-- LIST -->
        <div class="list card">
          <div class="filters">
            @for (st of states; track st.key) {
              <button class="fchip" [class.on]="stateFilter === st.key" (click)="setFilter(st.key)">{{ st.label }} <span class="ct">{{ countFor(st) }}</span></button>
            }
          </div>
          <table>
            <thead><tr><th>Id</th><th>Process</th><th>Version</th><th>Last update</th><th>Errors</th><th></th></tr></thead>
            <tbody>
              @for (i of filtered(); track i.id) {
                <tr (click)="open(i.id)" [class.sel]="sel()?.id === i.id">
                  <td class="mono">{{ i.id | slice:0:8 }}</td>
                  <td>{{ procName(i) }}<div class="st"><span class="dot" [style.background]="statusColor(i.status)"></span>{{ i.status }}</div></td>
                  <td class="muted">{{ version(i) }}</td>
                  <td class="muted">{{ (i.endedAt || i.startedAt) | slice:0:19 }}</td>
                  <td><span class="err-badge" [class.has]="i.status === 'failed'">{{ i.status === 'failed' ? 1 : 0 }}</span></td>
                  <td><button class="kebab" (click)="$event.stopPropagation(); open(i.id)">⋮</button></td>
                </tr>
              }
              @if (filtered().length === 0) { <tr><td colspan="6" class="muted pad">No instances match this filter.</td></tr> }
            </tbody>
          </table>
        </div>

        <!-- DETAIL -->
        @if (sel(); as s) {
          <div class="detail card">
            <div class="d-head">
              <div><b>{{ s.id | slice:0:8 }}</b> · {{ procName(s) }}
                <span class="badge" [style.color]="statusColor(s.status)">{{ s.status }}</span></div>
              <span class="spacer"></span>
              @if (s.status !== 'completed' && s.status !== 'aborted') {
                <button class="btn" (click)="suspendResume(s)">{{ s.status === 'suspended' ? 'Resume' : 'Suspend' }}</button>
                <button class="btn danger" (click)="abort(s)">Abort</button>
              }
            </div>
            @if (s.error) { <div class="err-box">⚠ {{ s.error.nodeId }}: {{ s.error.message }}</div> }

            <nav class="tabs">
              @for (t of tabs; track t.key) { <button [class.active]="tab() === t.key" (click)="tab.set(t.key)">{{ t.label }}</button> }
            </nav>

            <div class="tabbody">
              @switch (tab()) {
                @case ('diagram') {
                  <div class="diagram-wrap">
                    <aside class="rel">
                      <div class="rel-h">Parent instance</div>
                      @if (parent()) { <button class="chip-btn" (click)="open(parent()!.id)">⬆ {{ parent()!.id | slice:0:8 }}</button> } @else { <div class="muted sm">None</div> }
                      <div class="rel-h">Sub-process instances</div>
                      @if (children().length) { @for (c of children(); track c.id) { <button class="chip-btn" (click)="open(c.id)">⬇ {{ c.id | slice:0:8 }} <span class="badge" [style.color]="statusColor(c.status)">{{ c.status }}</span></button> } } @else { <div class="muted sm">None</div> }
                    </aside>
                    <div class="dcanvas">
                      <div class="legend">Node badges show <b>execution count</b>. <span class="lg active"></span> active · <span class="lg visited"></span> visited</div>
                      <div class="dwrap" [style.height.px]="dh()" [style.width.px]="dw()">
                        <svg class="edges" [attr.width]="dw()" [attr.height]="dh()">
                          <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#c2c8d4"/></marker></defs>
                          @for (e of graph().flows; track $index) { <path [attr.d]="edge(e)" class="ge" marker-end="url(#ar)" /> }
                        </svg>
                        @for (n of laid(); track n.id) {
                          <div class="gn" [style.left.px]="n.x" [style.top.px]="n.y" [style.width.px]="NW"
                               [class.active]="isActive(n.id)" [class.visited]="count(n.id) > 0" [class.picked]="picked() === n.id" (click)="picked.set(n.id)">
                            <span class="gc" [style.background]="visual(n.type).color">{{ visual(n.type).icon }}</span>
                            <span class="gnm">{{ n.name || n.id }}</span>
                            @if (count(n.id) > 0) { <span class="bc" title="executed {{ count(n.id) }}×">{{ count(n.id) }}</span> }
                          </div>
                        }
                      </div>
                    </div>
                  </div>
                  <div class="ops">
                    <div class="op"><label>Signal / message</label><div class="row"><input placeholder="signal name" [(ngModel)]="sigName" /><button class="btn primary" [disabled]="!sigName" (click)="sendSignal(s)">Send</button></div></div>
                    <div class="op"><label>Re-trigger node {{ picked() ? '(' + picked() + ')' : '' }}</label><div class="row"><button class="btn" [disabled]="!picked()" (click)="retry(s)">Re-trigger selected node</button><span class="muted sm">Works after completion too — replays the node.</span></div></div>
                  </div>
                }
                @case ('variables') {
                  @if (varRows(s).length) { <table class="kv"><tbody>@for (kv of varRows(s); track kv[0]) { <tr><td class="k">{{ kv[0] }}</td><td class="v">{{ kv[1] }}</td></tr> }</tbody></table> } @else { <p class="muted pad">No variables.</p> }
                }
                @case ('logs') {
                  <table class="logs"><thead><tr><th>#</th><th>Node</th><th>Type</th><th>Entered</th><th>Exited</th><th>Outcome</th></tr></thead>
                    <tbody>@for (h of s.history; track $index) { <tr><td class="muted">{{ $index + 1 }}</td><td><b>{{ nodeName(h.nodeId) }}</b></td><td class="muted">{{ h.type }}</td><td class="muted mono">{{ h.enteredAt | slice:11:19 }}</td><td class="muted mono">{{ h.exitedAt | slice:11:19 }}</td><td>{{ h.outcome }}</td></tr> }</tbody></table>
                  @if (!s.history.length) { <p class="muted pad">No log entries.</p> }
                }
                @default {
                  <table class="kv"><tbody>
                    <tr><td class="k">Status</td><td><span class="badge" [style.color]="statusColor(s.status)">{{ s.status }}</span></td></tr>
                    <tr><td class="k">Process</td><td>{{ procName(s) }}</td></tr>
                    <tr><td class="k">Version</td><td>{{ version(s) }}</td></tr>
                    <tr><td class="k">Started</td><td class="mono">{{ s.startedAt | slice:0:19 }}</td></tr>
                    <tr><td class="k">Ended</td><td class="mono">{{ (s.endedAt || '—') | slice:0:19 }}</td></tr>
                    <tr><td class="k">Correlation</td><td>{{ s.correlationKey || '—' }}</td></tr>
                    <tr><td class="k">Nodes executed</td><td>{{ s.history.length }}</td></tr>
                  </tbody></table>
                }
              }
            </div>
          </div>
        } @else { <div class="detail card empty"><p class="muted">Select a process instance.</p></div> }
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 20px 24px; }
    .pagehead { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .icon-btn { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; border: 1px solid var(--border); background: #fff; color: var(--muted); }
    h1 { font-size: 19px; margin: 0; }
    .split { display: grid; grid-template-columns: minmax(420px, 560px) 1fr; gap: 16px; align-items: start; }
    .filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 14px; border-bottom: 1px solid var(--border); }
    .fchip { border: 1px solid var(--border); background: #fff; border-radius: 999px; padding: 4px 12px; font-size: 12px; cursor: pointer; color: var(--muted); }
    .fchip.on { background: var(--primary); border-color: var(--primary); color: #fff; }
    .fchip .ct { opacity: .7; margin-left: 4px; }
    .list table, .detail table { width: 100%; border-collapse: collapse; }
    .list th, .list td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--border); font-size: 13px; }
    .list tr { cursor: pointer; } .list tbody tr:hover { background: #f8f9fc; } .list tr.sel td { background: #f2f0ff; }
    .st { font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 5px; margin-top: 2px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .mono { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
    .err-badge { display: inline-grid; place-items: center; min-width: 22px; height: 20px; border-radius: 5px; background: #eef0f6; color: var(--muted); font-size: 12px; }
    .err-badge.has { background: #fdeaea; color: var(--red); font-weight: 700; }
    .kebab { border: none; background: transparent; cursor: pointer; color: var(--muted); font-size: 16px; }
    .pad { padding: 16px; }
    .detail.empty { padding: 40px; text-align: center; }
    .d-head { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
    .badge { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; margin-left: 6px; }
    .err-box { margin: 12px 16px 0; background: #fdeaea; color: var(--red); padding: 8px 12px; border-radius: 8px; font-size: 13px; }
    .tabs { display: flex; gap: 4px; padding: 0 16px; border-bottom: 1px solid var(--border); }
    .tabs button { border: none; background: transparent; padding: 11px 12px; font-size: 13px; font-weight: 600; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; }
    .tabs button.active { color: var(--primary); border-bottom-color: var(--primary); }
    .tabbody { padding: 14px 16px; }
    .diagram-wrap { display: grid; grid-template-columns: 170px 1fr; gap: 14px; }
    .rel-h { font-size: 11px; font-weight: 700; color: #98a2b3; text-transform: uppercase; margin: 10px 0 6px; }
    .chip-btn { display: block; width: 100%; text-align: left; border: 1px solid var(--border); background: #fff; border-radius: 8px; padding: 6px 10px; cursor: pointer; font-size: 12px; margin-bottom: 6px; }
    .chip-btn:hover { background: #f6f7fb; }
    .legend { font-size: 11px; color: var(--muted); margin-bottom: 8px; } .lg { width: 10px; height: 10px; border-radius: 3px; display: inline-block; vertical-align: middle; }
    .lg.active { background: var(--primary); } .lg.visited { background: #cbd2e0; }
    .dcanvas { min-width: 0; }
    .dwrap { position: relative; overflow: auto; background-color: #fafbfd; background-image: radial-gradient(circle, #e5e9f2 1px, transparent 1px); background-size: 20px 20px; border: 1px solid var(--border); border-radius: 10px; }
    .edges { position: absolute; inset: 0; pointer-events: none; } .ge { fill: none; stroke: #c2c8d4; stroke-width: 2; }
    .gn { position: absolute; height: ${NH}px; background: #fff; border: 1px solid var(--border); border-radius: 10px; display: flex; align-items: center; gap: 8px; padding: 8px 10px; box-shadow: var(--shadow-card); cursor: pointer; opacity: .5; }
    .gn.visited { opacity: 1; } .gn.active { opacity: 1; border-color: var(--primary); box-shadow: 0 0 0 3px rgba(91,61,245,.2); }
    .gn.picked { outline: 2px dashed var(--amber); }
    .gc { width: 28px; height: 28px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 8px; color: #fff; font-size: 12px; }
    .gnm { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bc { position: absolute; bottom: -9px; left: 50%; transform: translateX(-50%); min-width: 18px; height: 18px; border-radius: 9px; background: #1f2430; color: #fff; font-size: 11px; font-weight: 700; display: grid; place-items: center; padding: 0 5px; box-shadow: var(--shadow-card); }
    .ops { margin-top: 16px; display: flex; flex-direction: column; gap: 14px; }
    .op label { display: block; font-size: 12px; color: var(--muted); font-weight: 600; margin-bottom: 6px; } .op .row { display: flex; gap: 8px; align-items: center; }
    .op input { border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; }
    .kv { width: 100%; } .kv td { padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 13px; vertical-align: top; } .kv .k { color: var(--muted); width: 34%; }
    .kv .v { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
    .logs th, .logs td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--border); font-size: 12px; } .logs th { color: var(--muted); }
    .sm { font-size: 11px; }
    .btn.danger { color: var(--red); border-color: #f3b4b4; } .btn.danger:hover { background: #fdeaea; }
  `],
})
export class InstancesComponent {
  private api = inject(ApiService);
  private realtime = inject(RealtimeService);
  private unsub?: () => void;
  private route = inject(ActivatedRoute);
  wfId = this.route.snapshot.paramMap.get('id');
  instances = signal<Instance[]>([]);
  deployments = signal<Record<string, Deployment>>({});
  sel = signal<Instance | null>(null);
  graph = signal<{ nodes: any[]; flows: any[]; diagram: { activeNodeIds: string[] }; counts: Record<string, number> }>({ nodes: [], flows: [], diagram: { activeNodeIds: [] }, counts: {} });
  parent = signal<Instance | null>(null);
  children = signal<Instance[]>([]);
  picked = signal<string | null>(null);
  tab = signal<Tab>('diagram');
  stateFilter = 'active'; sigName = '';
  states = STATES; NW = NW;
  tabs: { key: Tab; label: string }[] = [{ key: 'details', label: 'Instance Details' }, { key: 'variables', label: 'Process Variables' }, { key: 'logs', label: 'Logs' }, { key: 'diagram', label: 'Diagram' }];

  filtered = computed(() => { const f = STATES.find((s) => s.key === this.stateFilter)!; return this.instances().filter((i) => f.match(i.status)); });
  laid = computed(() => this.graph().nodes.map((n: any, i: number) => ({ ...n, x: n.x ?? (30 + (i % 5) * 175), y: n.y ?? (30 + Math.floor(i / 5) * 96) })));
  dw = computed(() => Math.max(560, ...this.laid().map((n: any) => n.x + NW + 40)));
  dh = computed(() => Math.max(220, ...this.laid().map((n: any) => n.y + NH + 40)));

  constructor() { this.reload(); }
  reload() {
    if (!this.wfId) return;
    this.api.listInstances(this.wfId).subscribe((is) => { this.instances.set(is); if (this.sel()) this.open(this.sel()!.id); });
    this.api.listDeployments(this.wfId).subscribe((ds) => this.deployments.set(Object.fromEntries(ds.map((d) => [d.id, d]))));
  }
  setFilter(k: string) { this.stateFilter = k; }
  countFor(st: { match: (s: string) => boolean }) { return this.instances().filter((i) => st.match(i.status)).length; }
  open(id: string) {
    this.picked.set(null);
    this.refresh(id);
    // Live redraw: refresh the open diagram as tokens move (node enter/exit, instance updates).
    this.unsub?.();
    this.unsub = this.realtime.subscribe(`instance:${id}`, () => { this.refresh(id); this.reload(); });
  }
  private refresh(id: string) {
    this.api.getInstance(id).subscribe((i) => this.sel.set(i));
    this.api.instanceGraph(id).subscribe((g) => this.graph.set(g as any));
    this.api.relatedInstances(id).subscribe((r) => { this.parent.set(r.parent); this.children.set(r.children); });
  }
  ngOnDestroy() { this.unsub?.(); }

  visual(t: string) { return VISUAL[t] || { icon: '●', color: '#64748b' }; }
  statusColor(s: string) { return ({ running: '#2563eb', waiting: '#f59e0b', completed: '#16a34a', failed: '#dc2626', aborted: '#6b7280', suspended: '#7c3aed' } as any)[s] || '#6b7280'; }
  procName(i: Instance) { return (i.processId || i.workflowId || '').split('.').pop() || i.workflowId; }
  version(i: Instance) { const d = this.deployments()[i.deploymentId]; return d ? (d.versionLabel || ('v' + (d.versionNumber ?? '?'))) + ' · ' + d.environment : '—'; }
  count(id: string) { return this.graph().counts?.[id] || 0; }
  isActive(id: string) { return (this.graph().diagram?.activeNodeIds || []).includes(id); }
  nodeName(id: string) { return this.graph().nodes.find((n: any) => n.id === id)?.name || id; }
  varRows(s: Instance) { return Object.entries(s.variables || {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)] as [string, string]); }
  private byId(id: string) { return this.laid().find((n: any) => n.id === id); }
  edge(e: any) { const a = this.byId(e.from), b = this.byId(e.to); if (!a || !b) return ''; const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, dx = Math.max(30, Math.abs(x2 - x1) / 2); return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`; }

  sendSignal(s: Instance) { let p: any = this.sigName; try { p = JSON.parse(this.sigName); } catch {} this.api.signalInstance(s.id, this.sigName, undefined).subscribe(() => { this.sigName = ''; this.open(s.id); this.reload(); }); }
  retry(s: Instance) { const n = this.picked(); if (n) this.api.retryNode(s.id, n).subscribe(() => { this.open(s.id); this.reload(); }); }
  suspendResume(s: Instance) { (s.status === 'suspended' ? this.api.resumeInstance(s.id) : this.api.suspendInstance(s.id)).subscribe(() => { this.open(s.id); this.reload(); }); }
  abort(s: Instance) { this.api.abort(s.id).subscribe(() => { this.open(s.id); this.reload(); }); }
}
