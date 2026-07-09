import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { JsonPipe, SlicePipe } from '@angular/common';
import { ApiService } from '../../core/api.service';
import type { Instance } from '../../core/models';

const VISUAL: Record<string, { icon: string; color: string }> = {
  start: { icon: '▶', color: '#16a34a' }, end: { icon: '■', color: '#dc2626' }, script: { icon: '{ }', color: '#0891b2' },
  http: { icon: '🌐', color: '#0d9488' }, userTask: { icon: '👤', color: '#2563eb' }, rule: { icon: '📐', color: '#ea580c' },
  send: { icon: '📤', color: '#16a34a' }, receive: { icon: '📥', color: '#16a34a' }, manual: { icon: '✋', color: '#64748b' },
  gateway: { icon: '◇', color: '#f59e0b' }, catch: { icon: '⏱', color: '#7c3aed' }, throw: { icon: '📣', color: '#7c3aed' },
  boundary: { icon: '⚠', color: '#7c3aed' }, subprocess: { icon: '▭', color: '#4f46e5' }, call: { icon: '⇥', color: '#4f46e5' }, forEach: { icon: '⇶', color: '#4f46e5' },
};
const NW = 168, NH = 56;

@Component({
  selector: 'app-instances',
  standalone: true,
  imports: [RouterLink, FormsModule, JsonPipe, SlicePipe],
  template: `
    <div class="page">
      <header class="pagehead">
        <a class="icon-btn" routerLink="/workflows" title="Apps">‹</a>
        <h1>Process Instances</h1>
        <span class="spacer"></span>
        <button class="btn" (click)="reload()">↻ Refresh</button>
      </header>

      <div class="split">
        <!-- LIST -->
        <div class="list card">
          <div class="list-head">
            <span>{{ instances().length }} instances</span>
            <select [(ngModel)]="statusFilter" (ngModelChange)="applyFilter()">
              <option value="">All statuses</option><option>running</option><option>waiting</option>
              <option>completed</option><option>failed</option><option>aborted</option><option>suspended</option>
            </select>
          </div>
          <div class="rows">
            @for (i of filtered(); track i.id) {
              <div class="ir" [class.sel]="sel()?.id === i.id" (click)="open(i.id)">
                <span class="dot" [style.background]="statusColor(i.status)"></span>
                <div class="ir-main">
                  <div class="ir-id">{{ i.id | slice:0:12 }}…</div>
                  <div class="ir-sub muted">{{ i.startedAt | slice:0:19 }} · {{ i.history.length }} steps</div>
                </div>
                <span class="badge" [style.color]="statusColor(i.status)">{{ i.status }}</span>
              </div>
            }
            @if (filtered().length === 0) { <p class="muted pad">No instances.</p> }
          </div>
        </div>

        <!-- DETAIL -->
        @if (sel(); as s) {
          <div class="detail">
            <div class="d-head card">
              <div class="row">
                <span class="dot lg" [style.background]="statusColor(s.status)"></span>
                <div>
                  <div class="d-title">Instance {{ s.id | slice:0:12 }}…</div>
                  <div class="muted">{{ s.status }} · started {{ s.startedAt | slice:0:19 }}</div>
                </div>
                <span class="spacer"></span>
                @if (s.status !== 'completed' && s.status !== 'aborted') {
                  <button class="btn" (click)="suspendResume(s)">{{ s.status === 'suspended' ? 'Resume' : 'Suspend' }}</button>
                  <button class="btn danger" (click)="abort(s)">Abort</button>
                }
              </div>
              @if (s.error) { <div class="err-box">⚠ {{ s.error.nodeId }}: {{ s.error.message }}</div> }
            </div>

            <!-- DIAGRAM -->
            <div class="card diagram">
              <div class="card-h">Execution diagram</div>
              <div class="dwrap" [style.height.px]="diagramH()">
                <svg class="edges" [attr.width]="diagramW()" [attr.height]="diagramH()">
                  <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#c2c8d4"/></marker></defs>
                  @for (e of graph().flows; track $index) { <path [attr.d]="edgePath(e)" class="edge" marker-end="url(#arr)" /> }
                </svg>
                @for (n of laidOut(); track n.id) {
                  <div class="gnode" [style.left.px]="n.x" [style.top.px]="n.y" [style.width.px]="NW"
                       [class.active]="isActive(n.id)" [class.visited]="isVisited(n.id)" (click)="pickNode(n.id)"
                       [class.picked]="pickedNode() === n.id">
                    <span class="gchip" [style.background]="visual(n.type).color">{{ visual(n.type).icon }}</span>
                    <span class="gname">{{ n.name || n.type }}</span>
                    @if (isActive(n.id)) { <span class="pulse"></span> }
                  </div>
                }
              </div>
              <div class="legend"><span class="lg-active"></span> active <span class="lg-visited"></span> visited</div>
            </div>

            <div class="cols">
              <!-- VARIABLES -->
              <div class="card">
                <div class="card-h">Variables</div>
                @if (varRows(s).length) {
                  <table class="vtab"><tbody>
                    @for (kv of varRows(s); track kv[0]) { <tr><td class="k">{{ kv[0] }}</td><td class="v">{{ kv[1] }}</td></tr> }
                  </tbody></table>
                } @else { <p class="muted pad">No variables set.</p> }
              </div>

              <!-- HISTORY -->
              <div class="card">
                <div class="card-h">History</div>
                <ol class="timeline">
                  @for (h of s.history; track $index) {
                    <li><span class="tdot" [style.background]="visual(h.type).color"></span>
                      <b>{{ nodeName(h.nodeId) }}</b> <span class="muted">{{ h.type }}</span>
                      <span class="out">{{ h.outcome }}</span></li>
                  }
                </ol>
              </div>
            </div>

            <!-- OPERATIONS -->
            <div class="card">
              <div class="card-h">Operations</div>
              <div class="ops">
                <div class="op">
                  <label>Trigger signal / message</label>
                  <div class="row">
                    <input placeholder="signal name (e.g. Approve)" [(ngModel)]="signalName" />
                    <input placeholder="payload (optional)" [(ngModel)]="signalPayload" />
                    <button class="btn primary" [disabled]="!signalName" (click)="sendSignal(s)">Send</button>
                  </div>
                </div>
                <div class="op">
                  <label>Re-trigger a node</label>
                  <div class="row">
                    <select [(ngModel)]="retryNodeId">
                      <option value="">{{ pickedNode() ? nodeName(pickedNode()!) : 'select a node (or click one above)' }}</option>
                      @for (n of graph().nodes; track n.id) { <option [value]="n.id">{{ n.name || n.id }}</option> }
                    </select>
                    <button class="btn" [disabled]="!(retryNodeId || pickedNode())" (click)="doRetry(s)">Re-trigger</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- RELATED -->
            <div class="card">
              <div class="card-h">Related instances</div>
              @if (parent()) {
                <div class="rel"><span class="rel-l">Parent</span>
                  <button class="chip-btn" (click)="open(parent()!.id)">⬆ {{ parent()!.id | slice:0:10 }}… <span class="badge" [style.color]="statusColor(parent()!.status)">{{ parent()!.status }}</span></button>
                </div>
              }
              @if (children().length) {
                <div class="rel"><span class="rel-l">Children ({{ children().length }})</span>
                  <div class="chips">
                    @for (c of children(); track c.id) {
                      <button class="chip-btn" (click)="open(c.id)">⬇ {{ c.id | slice:0:10 }}… <span class="badge" [style.color]="statusColor(c.status)">{{ c.status }}</span></button>
                    }
                  </div>
                </div>
              }
              @if (!parent() && !children().length) { <p class="muted pad">No related instances (no call activities).</p> }
            </div>
          </div>
        } @else {
          <div class="detail empty card"><p class="muted">Select an instance to see its diagram, variables, history and operations.</p></div>
        }
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 20px 24px; }
    .pagehead { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .icon-btn { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; border: 1px solid var(--border); background: #fff; color: var(--muted); }
    h1 { font-size: 19px; margin: 0; }
    .split { display: grid; grid-template-columns: 320px 1fr; gap: 16px; align-items: start; }
    .list { overflow: hidden; }
    .list-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--border); font-size: 13px; color: var(--muted); }
    .list-head select { border: 1px solid var(--border); border-radius: 7px; padding: 4px 8px; font-size: 12px; }
    .rows { max-height: calc(100vh - 180px); overflow: auto; }
    .ir { display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-bottom: 1px solid var(--border); cursor: pointer; }
    .ir:hover { background: #f8f9fc; } .ir.sel { background: #f2f0ff; }
    .ir-main { flex: 1; min-width: 0; } .ir-id { font-weight: 600; font-size: 13px; } .ir-sub { font-size: 11px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; } .dot.lg { width: 12px; height: 12px; }
    .pad { padding: 14px; }

    .detail { display: flex; flex-direction: column; gap: 14px; } .detail.empty { padding: 40px; text-align: center; }
    .d-head { padding: 14px 16px; } .d-title { font-weight: 700; }
    .err-box { margin-top: 10px; background: #fdeaea; color: var(--red); padding: 8px 12px; border-radius: 8px; font-size: 13px; }
    .card-h { font-weight: 700; font-size: 13px; padding: 12px 16px; border-bottom: 1px solid var(--border); }

    .diagram .dwrap { position: relative; overflow: auto; background-color: #fafbfd;
      background-image: radial-gradient(circle, #e5e9f2 1px, transparent 1px); background-size: 20px 20px; }
    .edges { position: absolute; inset: 0; pointer-events: none; } .edge { fill: none; stroke: #c2c8d4; stroke-width: 2; }
    .gnode { position: absolute; height: ${NH}px; background: #fff; border: 1px solid var(--border); border-radius: 11px; display: flex; align-items: center; gap: 9px; padding: 9px 11px; box-shadow: var(--shadow-card); cursor: pointer; opacity: .55; }
    .gnode.visited { opacity: 1; } .gnode.active { opacity: 1; border-color: var(--primary); box-shadow: 0 0 0 3px rgba(91,61,245,.2); }
    .gnode.picked { outline: 2px dashed var(--amber); }
    .gchip { width: 30px; height: 30px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 8px; color: #fff; font-size: 13px; }
    .gname { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pulse { position: absolute; top: -5px; right: -5px; width: 11px; height: 11px; border-radius: 50%; background: var(--primary); box-shadow: 0 0 0 0 rgba(91,61,245,.5); animation: pulse 1.4s infinite; }
    @keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(91,61,245,.5)} 70%{box-shadow:0 0 0 9px rgba(91,61,245,0)} 100%{box-shadow:0 0 0 0 rgba(91,61,245,0)} }
    .legend { display: flex; align-items: center; gap: 8px; padding: 8px 16px; font-size: 11px; color: var(--muted); }
    .lg-active, .lg-visited { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .lg-active { background: var(--primary); } .lg-visited { background: #cbd2e0; margin-left: 8px; }

    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .vtab { width: 100%; } .vtab td { padding: 7px 16px; border-bottom: 1px solid var(--border); font-size: 13px; }
    .vtab .k { color: var(--muted); width: 40%; } .vtab .v { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
    .timeline { list-style: none; margin: 0; padding: 10px 16px; } .timeline li { position: relative; padding: 5px 0 5px 18px; font-size: 13px; }
    .tdot { position: absolute; left: 0; top: 9px; width: 9px; height: 9px; border-radius: 50%; } .out { color: var(--muted); font-size: 11px; margin-left: 6px; }

    .ops { padding: 14px 16px; display: flex; flex-direction: column; gap: 16px; }
    .op label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px; font-weight: 600; }
    .op .row { display: flex; gap: 8px; } .op input, .op select { flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; font-size: 13px; }
    .op .btn { flex: 0 0 auto; }

    .rel { padding: 10px 16px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--border); }
    .rel-l { font-size: 12px; color: var(--muted); width: 90px; font-weight: 600; } .chips { display: flex; gap: 8px; flex-wrap: wrap; }
    .chip-btn { border: 1px solid var(--border); background: #fff; border-radius: 999px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
    .chip-btn:hover { background: #f6f7fb; }
    .btn.danger { color: var(--red); border-color: #f3b4b4; } .btn.danger:hover { background: #fdeaea; }
    .badge { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
  `],
})
export class InstancesComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  wfId = this.route.snapshot.paramMap.get('id');
  instances = signal<Instance[]>([]);
  filtered = signal<Instance[]>([]);
  sel = signal<Instance | null>(null);
  graph = signal<{ nodes: any[]; flows: any[]; diagram: { activeNodeIds: string[]; visitedNodeIds: string[]; status: string } }>({ nodes: [], flows: [], diagram: { activeNodeIds: [], visitedNodeIds: [], status: '' } });
  parent = signal<Instance | null>(null);
  children = signal<Instance[]>([]);
  pickedNode = signal<string | null>(null);
  statusFilter = ''; signalName = ''; signalPayload = ''; retryNodeId = '';
  NW = NW;

  laidOut = computed(() => {
    const gn = this.graph().nodes;
    return gn.map((n: any, i: number) => ({ ...n, x: n.x ?? (30 + (i % 5) * 190), y: n.y ?? (24 + Math.floor(i / 5) * 96) }));
  });
  diagramW = computed(() => Math.max(600, ...this.laidOut().map((n: any) => n.x + NW + 40)));
  diagramH = computed(() => Math.max(220, ...this.laidOut().map((n: any) => n.y + NH + 40)));

  constructor() { this.reload(); }

  reload() {
    if (!this.wfId) return;
    this.api.listInstances(this.wfId).subscribe((is) => { this.instances.set(is); this.applyFilter(); if (this.sel()) this.open(this.sel()!.id); });
  }
  applyFilter() { this.filtered.set(this.instances().filter((i) => !this.statusFilter || i.status === this.statusFilter)); }

  open(id: string) {
    this.pickedNode.set(null); this.retryNodeId = '';
    this.api.getInstance(id).subscribe((i) => this.sel.set(i));
    this.api.instanceGraph(id).subscribe((g) => this.graph.set(g));
    this.api.relatedInstances(id).subscribe((r) => { this.parent.set(r.parent); this.children.set(r.children); });
  }

  // visuals
  visual(t: string) { return VISUAL[t] || { icon: '●', color: '#64748b' }; }
  statusColor(s: string) { return ({ running: '#2563eb', waiting: '#f59e0b', completed: '#16a34a', failed: '#dc2626', aborted: '#6b7280', suspended: '#7c3aed' } as any)[s] || '#6b7280'; }
  nodeName(id: string) { return this.graph().nodes.find((n: any) => n.id === id)?.name || id; }
  isActive(id: string) { return this.graph().diagram.activeNodeIds.includes(id); }
  isVisited(id: string) { return this.graph().diagram.visitedNodeIds.includes(id); }
  varRows(s: Instance) { return Object.entries(s.variables || {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)] as [string, string]); }
  pickNode(id: string) { this.pickedNode.set(id); this.retryNodeId = id; }

  // geometry
  private laid(id: string) { return this.laidOut().find((n: any) => n.id === id); }
  edgePath(e: any) {
    const a = this.laid(e.from), b = this.laid(e.to);
    if (!a || !b) return '';
    const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, dx = Math.max(30, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  // operations
  sendSignal(s: Instance) {
    let payload: unknown = this.signalPayload || undefined;
    try { if (this.signalPayload) payload = JSON.parse(this.signalPayload); } catch { /* keep string */ }
    this.api.signalInstance(s.id, this.signalName, payload).subscribe(() => { this.signalName = ''; this.signalPayload = ''; this.open(s.id); this.reload(); });
  }
  doRetry(s: Instance) {
    const node = this.retryNodeId || this.pickedNode(); if (!node) return;
    this.api.retryNode(s.id, node).subscribe(() => { this.open(s.id); this.reload(); });
  }
  suspendResume(s: Instance) {
    const call = s.status === 'suspended' ? this.api.resumeInstance(s.id) : this.api.suspendInstance(s.id);
    call.subscribe(() => { this.open(s.id); this.reload(); });
  }
  abort(s: Instance) { this.api.abort(s.id).subscribe(() => { this.open(s.id); this.reload(); }); }
}
