import { Component, ElementRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import type { Catalog, NodeSpec, Problem, Workflow } from '../../core/models';
import { PropertiesPanelComponent } from './properties-panel.component';
import { ProblemsPanelComponent } from './problems-panel.component';

// A canvas node is just an engine node with x/y layout coords stored alongside (ignored by the SDK).
interface CNode { id: string; type: string; name?: string; x: number; y: number; [k: string]: any; }
interface CEdge { id: string; from: string; to: string; when?: string; lang?: string; }

const VISUAL: Record<string, { icon: string; color: string }> = {
  start: { icon: '▶', color: '#16a34a' }, end: { icon: '■', color: '#dc2626' },
  script: { icon: '{ }', color: '#0891b2' }, http: { icon: '🌐', color: '#0d9488' },
  userTask: { icon: '👤', color: '#2563eb' }, rule: { icon: '📐', color: '#ea580c' },
  send: { icon: '📤', color: '#16a34a' }, receive: { icon: '📥', color: '#16a34a' },
  manual: { icon: '✋', color: '#64748b' }, gateway: { icon: '◇', color: '#f59e0b' },
  catch: { icon: '⏱', color: '#7c3aed' }, throw: { icon: '📣', color: '#7c3aed' },
  boundary: { icon: '⚠', color: '#7c3aed' }, subprocess: { icon: '▭', color: '#4f46e5' },
  call: { icon: '⇥', color: '#4f46e5' }, forEach: { icon: '⇶', color: '#4f46e5' },
};
const NW = 190, NH = 66;

@Component({
  selector: 'app-builder',
  standalone: true,
  imports: [FormsModule, RouterLink, PropertiesPanelComponent, ProblemsPanelComponent],
  template: `
    <div class="builder">
      <!-- HEADER -->
      <header class="hdr">
        <a class="icon-btn" [routerLink]="['/projects', projectId]" title="Back to project">‹</a>
        <div class="titles">
          <span class="proj-chip">{{ wf()?.name }}</span><span class="sep">▸</span>
          <input class="wfname" [(ngModel)]="name" (ngModelChange)="markDirty()" placeholder="Process name *" />
        </div>
        <span class="spacer"></span>
        <span class="savestate" [class.dirty]="saveState()==='dirty'">{{ saveLabel() }}</span>
        <button class="btn" (click)="saveNow()">Update</button>
        <button class="btn ghost">User Permissions</button>
        <button class="btn ghost" (click)="openVars()">Variables ({{ procVars().length }})</button>
        <span class="divider"></span>
        <button class="icon-btn" (click)="autoLayout()" title="Auto-layout">▦</button>
        <button class="btn" (click)="run()">▷ Run</button>
        <button class="btn primary" (click)="deploy()" [disabled]="errorCount() > 0"
                [title]="errorCount() > 0 ? 'Fix ' + errorCount() + ' validation error(s) before deploying' : 'Publish + deploy to prod'">Deploy</button>
      </header>

      <div class="body">
        <!-- PALETTE -->
        <aside class="palette">
          <input class="search" placeholder="Search nodes…" [(ngModel)]="q" />
          @for (cat of cats(); track cat) {
            @if (nodesIn(cat).length) {
              <div class="cat-h">{{ cat }}</div>
              <div class="cat-grid">
                @for (n of nodesIn(cat); track n.key) {
                  <div class="ptile" draggable="true" (dragstart)="onDragStart($event, n)"
                       (click)="addFromPalette(n)" [title]="'Drag onto canvas, or click to add: ' + n.label">
                    <span class="pic" [style.background]="visual(n.engineType).color">{{ visual(n.engineType).icon }}</span>
                    <span class="plabel">{{ n.label }}</span>
                  </div>
                }
              </div>
            }
          }
        </aside>

        <!-- CANVAS -->
        <main #canvas class="canvas" (dragover)="$event.preventDefault()" (drop)="onDrop($event)" (click)="bgClick()">
          <svg class="edges">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#9aa3b2" />
              </marker>
            </defs>
            @for (e of edges(); track e.id) {
              <path [attr.d]="edgePath(e)" class="edge" [class.sel]="selEdge()===e.id" marker-end="url(#arrow)"
                    (click)="selectEdge($event, e)" />
            }
            @if (linkFrom(); as lf) { <path [attr.d]="ghostPath(lf)" class="edge ghost" /> }
          </svg>

          @for (n of nodes(); track n.id) {
            <div class="node" [class.sel]="selNode()?.id===n.id" [class.linking]="linkFrom()===n.id"
                 [class.droptarget]="linkFrom() && linkFrom()!==n.id && portsFor(n.type).in"
                 [class.has-err]="hasErr(n.id)" [class.has-warn]="!hasErr(n.id) && hasWarn(n.id)"
                 [style.left.px]="n.x" [style.top.px]="n.y" [style.width.px]="NW"
                 (pointerdown)="startDrag($event, n)" (pointerup)="onNodePointerUp($event, n)" (click)="selectNode($event, n)">
              @if (hasErr(n.id)) { <span class="nmark err" title="Has errors">!</span> }
              @else if (hasWarn(n.id)) { <span class="nmark warn" title="Has warnings">!</span> }
              @if (portsFor(n.type).in) { <span class="port in" title="Incoming"></span> }
              <span class="chip" [style.background]="visual(n.type).color">{{ visual(n.type).icon }}</span>
              <div class="ninfo">
                <div class="ntitle">{{ n.name || labelFor(n) }}</div>
                <div class="ntype">{{ typeLabel(n) }}</div>
              </div>
              @if (portsFor(n.type).out) { <span class="port out" title="Drag to a target node to connect" (pointerdown)="startLink($event, n)" (click)="$event.stopPropagation()"></span> }
              @if (selNode()?.id===n.id) {
                <button class="ndel" (pointerdown)="$event.stopPropagation()" (click)="del($event, n)" title="Delete">🗑</button>
              }
            </div>
          }

          @if (nodes().length === 0) {
            <div class="empty">
              <div class="empty-ic">＋</div>
              <h3>Build your flow</h3>
              <p>Drag a node from the palette onto the canvas, then hover a node and use its right dot to connect to another.</p>
            </div>
          }
          @if (linkError()) { <div class="hint-bar err">⛔ {{ linkError() }}</div> }
          @else if (linkFrom()) { <div class="hint-bar">Release on a target node to connect (or click a node) — click empty space to cancel.</div> }
        </main>

        <!-- PROPERTIES -->
        <aside class="props">
          @if (selNode(); as n) {
            <div class="props-h"><span class="chip sm" [style.background]="visual(n.type).color">{{ visual(n.type).icon }}</span>{{ typeLabel(n) }}</div>
            <label class="fld"><span>Node ID</span><input [value]="n.id" disabled /></label>
            <app-properties-panel [node]="n" [allNodes]="nodes()" [sections]="schemaFor(n.type)" (changed)="markDirty()"></app-properties-panel>
            <button class="btn danger full" (click)="del($event, n)">Delete node</button>
          } @else if (selEdge()) {
            <div class="props-h">Connection</div>
            @if (edgeById(selEdge()!); as e) {
              <label class="fld"><span>Condition (js)</span><input [(ngModel)]="e.when" (ngModelChange)="onEdgeChange(e)" placeholder="e.g. amount > 1000" /></label>
              <p class="hint">Leave empty for an unconditional / default flow.</p>
              <button class="btn danger full" (click)="delEdge(e.id)">Delete connection</button>
            }
          } @else {
            <div class="props-h">Properties</div>
            <p class="hint">Select a node or connection to edit it. Property forms are generated per node type.</p>
            <div class="stat"><span>{{ nodes().length }}</span> nodes · <span>{{ edges().length }}</span> connections</div>
            @if (validationMsg()) { <div class="valid" [class.ok]="validOk()">{{ validationMsg() }}</div> }
            <button class="btn full" (click)="validate()">Validate model</button>
          }
        </aside>
      </div>

      <app-problems-panel [problems]="problems()" [errorCount]="errorCount()" [warnCount]="warnCount()" (pick)="pickProblem($event)"></app-problems-panel>

      @if (showVars()) {
        <div class="modal-bg" (click)="closeVars()">
          <div class="modal" (click)="$event.stopPropagation()">
            <div class="modal-h"><span>Process Variables</span><button class="x" (click)="closeVars()">✕</button></div>
            <div class="modal-body">
              <p class="hint">Typed data this process carries. Referenced from scripts (kcontext), conditions, and data mappings.</p>
              @for (v of procVars(); track $index) {
                <div class="vrow">
                  <input placeholder="name" [(ngModel)]="v.name" (ngModelChange)="markDirty()" />
                  <select [(ngModel)]="v.type" (ngModelChange)="markDirty()">
                    <option>string</option><option>int</option><option>long</option><option>double</option><option>bool</option><option>date</option><option>object</option><option>list</option><option>map</option>
                  </select>
                  <button class="x" (click)="rmVar($index)">✕</button>
                </div>
              }
              @if (!procVars().length) { <p class="muted">No variables yet.</p> }
              <button class="add" (click)="addVar()">+ add variable</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .builder { display: flex; flex-direction: column; height: 100%; background: var(--bg); }
    .hdr { display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: var(--surface); border-bottom: 1px solid var(--border); box-shadow: 0 1px 2px rgba(16,24,40,.04); z-index: 5; }
    .icon-btn { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; border: 1px solid var(--border); background: #fff; cursor: pointer; color: var(--muted); }
    .icon-btn:hover { background: #f6f7fb; color: var(--text); }
    .titles { display: flex; align-items: center; gap: 10px; }
    .wfname { border: 1px solid transparent; border-radius: 8px; padding: 6px 8px; font-size: 15px; font-weight: 700; width: 220px; }
    .wfname:hover { border-color: var(--border); } .wfname:focus { border-color: var(--primary); outline: none; }
    .proj-chip { font-size: 13px; color: var(--muted); font-weight: 600; } .sep { color: #cbd2e0; }
    .key { font-size: 11px; color: var(--muted); background: #eef0f6; padding: 3px 8px; border-radius: 999px; }
    .divider { width: 1px; height: 22px; background: var(--border); margin: 0 4px; }
    .savestate { font-size: 12px; color: var(--muted); margin-right: 4px; } .savestate.dirty { color: var(--amber); }
    .body { flex: 1; display: flex; min-height: 0; }

    .palette { width: 236px; background: var(--surface); border-right: 1px solid var(--border); overflow-y: auto; padding: 14px 12px; }
    .search { width: 100%; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; margin-bottom: 8px; font-size: 13px; }
    .search:focus { outline: none; border-color: var(--primary); }
    .cat-h { font-size: 10.5px; font-weight: 700; color: #98a2b3; text-transform: uppercase; letter-spacing: .06em; margin: 14px 2px 8px; }
    .cat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .ptile { display: flex; flex-direction: column; align-items: center; gap: 7px; padding: 12px 6px; border: 1px solid var(--border); border-radius: 10px; cursor: grab; background: #fff; text-align: center; transition: box-shadow .12s, transform .12s, border-color .12s; }
    .ptile:hover { box-shadow: var(--shadow-card); border-color: #d7dbe7; transform: translateY(-1px); }
    .ptile:active { cursor: grabbing; }
    .pic { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 10px; color: #fff; font-size: 15px; font-weight: 600; }
    .plabel { font-size: 11px; color: var(--text); line-height: 1.2; }

    .canvas { position: relative; flex: 1; overflow: auto;
      background-color: #f7f8fb;
      background-image: radial-gradient(circle, #d9deea 1.1px, transparent 1.1px);
      background-size: 22px 22px; }
    .edges { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
    .edge { fill: none; stroke: #9aa3b2; stroke-width: 2; pointer-events: stroke; cursor: pointer; }
    .edge:hover { stroke: #6b7280; } .edge.sel { stroke: var(--primary); stroke-width: 2.5; }
    .edge.ghost { stroke: var(--primary); stroke-dasharray: 5 4; opacity: .7; }

    .node { position: absolute; min-height: ${NH}px; background: #fff; border: 1px solid var(--border); border-radius: 14px;
      box-shadow: var(--shadow-card); display: flex; align-items: center; gap: 12px; padding: 12px 14px; cursor: grab; user-select: none; transition: box-shadow .12s, border-color .12s; }
    .node:hover { box-shadow: var(--shadow-pop); }
    .node.sel { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(91,61,245,.18), var(--shadow-card); }
    .node.linking { border-color: var(--primary); }
    .node.droptarget { border-color: var(--green); box-shadow: 0 0 0 3px rgba(22,163,74,.18), var(--shadow-card); cursor: alias; }
    .node.has-err { border-color: #f0a5a5; } .node.has-warn { border-color: #f0cf8a; }
    .nmark { position: absolute; top: -9px; left: -9px; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: 12px; color: #fff; box-shadow: var(--shadow-card); z-index: 2; }
    .nmark.err { background: var(--red); } .nmark.warn { background: #d97706; }
    .node .chip { width: 40px; height: 40px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 11px; color: #fff; font-size: 16px; font-weight: 600; }
    .ninfo { min-width: 0; } .ntitle { font-weight: 600; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ntype { font-size: 11px; color: var(--muted); }
    .port { position: absolute; top: 50%; width: 16px; height: 16px; border-radius: 50%; background: #fff; border: 2px solid #b6bdca; transform: translateY(-50%); cursor: crosshair; z-index: 3; }
    .port:hover { border-color: var(--primary); background: #eae6ff; transform: translateY(-50%) scale(1.25); }
    .port.out { right: -9px; box-shadow: 0 0 0 3px rgba(91,61,245,.08); }
    .port.in { left: -9px; }
    .node:hover .port.out { border-color: var(--primary); }
    .ndel { position: absolute; top: -12px; right: 8px; width: 26px; height: 26px; border-radius: 7px; border: 1px solid var(--border); background: #fff; cursor: pointer; box-shadow: var(--shadow-card); }
    .ndel:hover { background: #fdeaea; border-color: #f3b4b4; }

    .empty { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); text-align: center; color: var(--muted); max-width: 340px; }
    .empty-ic { width: 56px; height: 56px; margin: 0 auto 10px; border-radius: 16px; background: #fff; border: 1px dashed #cbd2e0; display: grid; place-items: center; font-size: 26px; color: #b6bdca; }
    .empty h3 { margin: 6px 0; color: var(--text); }
    .hint-bar { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); background: var(--primary); color: #fff; padding: 7px 14px; border-radius: 999px; font-size: 12px; box-shadow: var(--shadow-pop); z-index: 10; }
    .hint-bar.err { background: var(--red); }

    .props { width: 320px; background: var(--surface); border-left: 1px solid var(--border); padding: 16px; overflow-y: auto; }
    .props-h { display: flex; align-items: center; gap: 8px; font-weight: 700; margin-bottom: 14px; font-size: 14px; }
    .chip.sm { width: 24px; height: 24px; border-radius: 7px; color: #fff; display: grid; place-items: center; font-size: 12px; }
    .fld { display: block; margin-bottom: 12px; } .fld span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 5px; }
    .fld input, .fld select, .fld textarea { width: 100%; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; font-size: 13px; font-family: inherit; }
    .fld input:focus, .fld select:focus, .fld textarea:focus { outline: none; border-color: var(--primary); }
    .fld textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    .hint { font-size: 12px; color: var(--muted); line-height: 1.5; }
    .stat { font-size: 13px; color: var(--muted); margin: 10px 0; } .stat span { color: var(--text); font-weight: 600; }
    .valid { font-size: 12px; padding: 8px 10px; border-radius: 8px; background: #fdeaea; color: var(--red); margin: 10px 0; }
    .valid.ok { background: #e7f7ee; color: var(--green); }
    .btn.full { width: 100%; justify-content: center; margin-top: 8px; }
    .btn.danger { color: var(--red); border-color: #f3b4b4; } .btn.danger:hover { background: #fdeaea; }

    .modal-bg { position: fixed; inset: 0; background: rgba(16,24,40,.4); display: grid; place-items: center; z-index: 50; }
    .modal { background: #fff; border-radius: 14px; width: 480px; max-width: 92vw; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column; box-shadow: var(--shadow-pop); }
    .modal-h { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border); font-weight: 700; }
    .modal-h .x { border: none; background: transparent; font-size: 16px; cursor: pointer; color: var(--muted); }
    .modal-body { padding: 16px 18px; overflow: auto; }
    .vrow { display: flex; gap: 8px; margin-bottom: 8px; }
    .vrow input { flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; }
    .vrow select { flex: 0 0 120px; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; }
    .vrow .x { flex: 0 0 auto; width: 32px; border: 1px solid var(--border); background: #fff; border-radius: 8px; cursor: pointer; color: var(--muted); }
    .vrow .x:hover { background: #fdeaea; color: var(--red); }
    .modal-body .add { border: 1px dashed var(--border); background: #fff; border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; color: var(--muted); margin-top: 6px; }
    .modal-body .add:hover { border-color: var(--primary); color: var(--primary); }
  `],
})
export class BuilderComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private canvasRef = viewChild<ElementRef<HTMLElement>>('canvas');

  wf = signal<Workflow | null>(null);
  catalog = signal<Catalog | null>(null);
  nodes = signal<CNode[]>([]);
  edges = signal<CEdge[]>([]);
  selNode = signal<CNode | null>(null);
  selEdge = signal<string | null>(null);
  linkFrom = signal<string | null>(null);
  linkError = signal<string>('');
  saveState = signal<'saved' | 'saving' | 'dirty'>('saved');
  validationMsg = signal<string>(''); validOk = signal(false);
  showVars = signal(false);
  procVars = signal<{ name: string; type: string }[]>([]);
  name = ''; q = '';
  NW = NW;
  projectId = ''; pid = '';
  private branchId = ''; private idc = 0; private saveTimer: any;
  private pointer = { x: 0, y: 0 };
  private drag: { id: string; offX: number; offY: number; moved: boolean } | null = null;
  private linkMoved = false;   // did the pointer move while linking? (drag-to-connect vs click-to-arm)

  problems = signal<Problem[]>([]);
  errorCount = computed(() => this.problems().filter((p) => p.severity === 'error').length);
  warnCount = computed(() => this.problems().filter((p) => p.severity === 'warning').length);
  private errIds = computed(() => new Set(this.problems().filter((p) => p.severity === 'error' && p.nodeId).map((p) => p.nodeId!)));
  private warnIds = computed(() => new Set(this.problems().filter((p) => p.severity === 'warning' && p.nodeId).map((p) => p.nodeId!)));
  cats = computed(() => this.catalog()?.categories ?? []);
  saveLabel = computed(() => ({ saved: 'Saved', saving: 'Saving…', dirty: 'Unsaved' }[this.saveState()]));

  hasErr(id: string) { return this.errIds().has(id); }
  hasWarn(id: string) { return this.warnIds().has(id); }
  private runValidate() {
    if (!this.wf()) return;
    this.api.validateProcess(this.buildProcess()).subscribe((r) => this.problems.set(r.problems));
  }
  pickProblem(id: string) {
    const n = this.nodes().find((x) => x.id === id);
    if (n) { this.selNode.set(n); this.selEdge.set(null); return; }
    const e = this.edges().find((x) => x.id === id);
    if (e) { this.selEdge.set(e.id); this.selNode.set(null); }
  }

  constructor() {
    this.projectId = this.route.snapshot.paramMap.get('id')!;
    this.pid = this.route.snapshot.paramMap.get('pid')!;
    this.api.catalog().subscribe((c) => this.catalog.set(c));
    this.api.getWorkflow(this.projectId).subscribe((w) => { this.wf.set(w); this.branchId = w.defaultBranchId; });
    this.api.getProcess(this.projectId, this.pid).subscribe((p) => this.loadProcess(p));
  }

  // ---- visuals / labels ----
  visual(t: string) { return VISUAL[t] || { icon: '●', color: '#64748b' }; }
  labelFor(n: CNode) { return this.catalog()?.nodes.find((s) => s.engineType === n.type)?.label || n.type; }
  typeLabel(n: CNode) {
    const map: Record<string, string> = { start: 'Start event', end: 'End event', script: 'Script task', http: 'Service task', userTask: 'User task', rule: 'Business rule', send: 'Send task', receive: 'Receive task', manual: 'Manual task', gateway: 'Gateway', catch: 'Catch event', throw: 'Throw event', boundary: 'Boundary event', subprocess: 'Sub-process', call: 'Call activity', forEach: 'Multi-instance' };
    return map[n.type] || n.type;
  }
  nodesIn(cat: string): NodeSpec[] {
    const q = this.q.trim().toLowerCase();
    return (this.catalog()?.nodes ?? []).filter((n) => n.category === cat && (!q || n.label.toLowerCase().includes(q)));
  }

  // ---- load / map (a single process within the project) ----
  private loadProcess(proc: any) {
    if (!proc) return;
    this.name = proc.name || this.pid;
    this.procVars.set([...(proc.vars || [])]);
    const cn: CNode[] = (proc.nodes || []).map((n: any, i: number) => ({
      ...n, x: n.x ?? (100 + (i % 4) * 230), y: n.y ?? (90 + Math.floor(i / 4) * 150),
    }));
    this.nodes.set(cn);
    this.edges.set((proc.flows || []).map((f: any, i: number) => ({ id: f.id || `e${i}_${f.from}_${f.to}`, from: f.from, to: f.to, when: f.when, lang: f.lang })));
    this.saveState.set('saved');
    this.runValidate();
  }

  private buildProcess() {
    return {
      id: this.pid, name: this.name, package: 'com.acme', vars: this.procVars(),
      nodes: this.nodes().map((n) => ({ ...n })),
      flows: this.edges().map((e) => ({ id: e.id, from: e.from, to: e.to, ...(e.when ? { when: e.when, lang: 'js' } : {}) })),
    };
  }

  // ---- palette drag → drop ----
  onDragStart(ev: DragEvent, spec: NodeSpec) { ev.dataTransfer?.setData('text/plain', spec.key); if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy'; }
  onDrop(ev: DragEvent) {
    ev.preventDefault();
    const key = ev.dataTransfer?.getData('text/plain');
    const spec = this.catalog()?.nodes.find((s) => s.key === key);
    if (!spec) return;
    const rect = this.canvasRef()!.nativeElement.getBoundingClientRect();
    const sc = this.canvasRef()!.nativeElement;
    const x = ev.clientX - rect.left + sc.scrollLeft - NW / 2;
    const y = ev.clientY - rect.top + sc.scrollTop - NH / 2;
    const node: CNode = { id: this.newId(spec.engineType), ...(spec.defaults as any), name: (spec.defaults as any).name || spec.label, x: Math.max(8, x), y: Math.max(8, y) };
    this.nodes.set([...this.nodes(), node]);
    this.selNode.set(node); this.selEdge.set(null);
    this.markDirty();
  }
  private newId(type: string) { return `${type}_${(this.idc++).toString(36)}${Date.now().toString(36).slice(-3)}`; }

  /** Click-to-add fallback (works even where native HTML5 drag doesn't): drops the node onto the
   *  canvas, staggered, and scrolls it into view. */
  addFromPalette(spec: NodeSpec) {
    const el = this.canvasRef()?.nativeElement;
    const count = this.nodes().length;
    const baseX = 100 + (count % 4) * 230 + (el?.scrollLeft || 0);
    const baseY = 90 + Math.floor(count / 4) * 150 + (el?.scrollTop || 0);
    const node: CNode = { id: this.newId(spec.engineType), ...(spec.defaults as any), name: (spec.defaults as any).name || spec.label, x: baseX, y: baseY };
    this.nodes.set([...this.nodes(), node]);
    this.selNode.set(node); this.selEdge.set(null);
    this.markDirty();
  }

  // ---- node drag (pointer) ----
  startDrag(ev: PointerEvent, n: CNode) {
    if ((ev.target as HTMLElement).classList.contains('port')) return;
    const rect = this.canvasRef()!.nativeElement.getBoundingClientRect();
    const sc = this.canvasRef()!.nativeElement;
    const px = ev.clientX - rect.left + sc.scrollLeft, py = ev.clientY - rect.top + sc.scrollTop;
    this.drag = { id: n.id, offX: px - n.x, offY: py - n.y, moved: false };
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
  }
  @HostListener('document:pointermove', ['$event'])
  onMove(ev: PointerEvent) {
    const el = this.canvasRef()?.nativeElement; if (!el) return;
    const rect = el.getBoundingClientRect();
    this.pointer = { x: ev.clientX - rect.left + el.scrollLeft, y: ev.clientY - rect.top + el.scrollTop };
    if (this.linkFrom()) this.linkMoved = true;   // moved while linking → treat as a drag-connect
    if (!this.drag) return;
    const n = this.nodes().find((x) => x.id === this.drag!.id); if (!n) return;
    n.x = Math.max(4, this.pointer.x - this.drag.offX); n.y = Math.max(4, this.pointer.y - this.drag.offY);
    this.drag.moved = true;
  }
  @HostListener('document:pointerup')
  onUp() {
    if (this.drag?.moved) this.markDirty();
    this.drag = null;
    // released after dragging a link but not over a valid node → cancel; a plain click stays "armed"
    if (this.linkFrom() && this.linkMoved) { this.linkFrom.set(null); this.linkMoved = false; }
  }

  // ---- selection ----
  // while linking, clicking any node completes the connection to it; otherwise it selects.
  selectNode(ev: Event, n: CNode) { ev.stopPropagation(); if (this.linkFrom()) { this.completeLink(n); return; } this.selNode.set(n); this.selEdge.set(null); }
  selectEdge(ev: Event, e: CEdge) { ev.stopPropagation(); this.selEdge.set(e.id); this.selNode.set(null); }
  bgClick() { this.linkFrom.set(null); this.linkMoved = false; this.linkError.set(''); this.selNode.set(null); this.selEdge.set(null); }
  edgeById(id: string) { return this.edges().find((e) => e.id === id); }

  // ---- connect: drag from a node's output port to a target node (jBPM sequence-flow rules) ----
  startLink(ev: PointerEvent, n: CNode) {
    ev.stopPropagation(); ev.preventDefault();   // don't start a node drag; begin a link drag
    this.linkError.set(''); this.selNode.set(null); this.linkFrom.set(n.id);
  }
  // pointer released over a node while linking → complete (ignore release on the source itself)
  onNodePointerUp(_ev: Event, n: CNode) { const f = this.linkFrom(); if (f && f !== n.id) this.completeLink(n); }
  private completeLink(to: CNode) {
    const fromId = this.linkFrom();
    const clear = () => { this.linkFrom.set(null); this.linkMoved = false; };
    if (!fromId) return;
    if (fromId === to.id) { clear(); return; }
    const from = this.nodes().find((x) => x.id === fromId);
    if (!from) { clear(); return; }
    const check = this.canConnect(from, to);
    if (!check.ok) { this.linkError.set(check.reason!); clear(); setTimeout(() => this.linkError.set(''), 3500); return; }
    this.edges.set([...this.edges(), { id: `e${this.idc++}_${fromId}_${to.id}`, from: fromId, to: to.id }]);
    clear(); this.markDirty();
  }
  // per-node config from the backend catalog (single source of truth for ports + property schema)
  portsFor(type: string) { return this.catalog()?.ports?.[type] || { in: true, out: true }; }
  schemaFor(type: string) { return this.catalog()?.schemas?.[type] || []; }

  /** Connection validity derived from each node type's declared ports (config-driven, matches backend). */
  canConnect(from: CNode, to: CNode): { ok: boolean; reason?: string } {
    if (!this.portsFor(from.type).out) return { ok: false, reason: `A ${from.type} has no outgoing connection` };
    if (!this.portsFor(to.type).in) return { ok: false, reason: `A ${to.type} has no incoming connection` };
    if (this.edges().some((e) => e.from === from.id && e.to === to.id)) return { ok: false, reason: 'That connection already exists' };
    return { ok: true };
  }
  onEdgeChange(_e: CEdge) { this.markDirty(); }

  // ---- delete ----
  del(ev: Event, n: CNode) {
    ev.stopPropagation();
    this.nodes.set(this.nodes().filter((x) => x.id !== n.id));
    this.edges.set(this.edges().filter((e) => e.from !== n.id && e.to !== n.id));
    this.selNode.set(null); this.markDirty();
  }
  delEdge(id: string) { this.edges.set(this.edges().filter((e) => e.id !== id)); this.selEdge.set(null); this.markDirty(); }

  // ---- geometry ----
  private nodeById(id: string) { return this.nodes().find((n) => n.id === id); }
  edgePath(e: CEdge) {
    const a = this.nodeById(e.from), b = this.nodeById(e.to);
    if (!a || !b) return '';
    const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2;
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }
  ghostPath(fromId: string) {
    const a = this.nodeById(fromId); if (!a) return '';
    const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = this.pointer.x, y2 = this.pointer.y;
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  // ---- process variables (this process's own variables) ----
  openVars() { this.showVars.set(true); }
  addVar() { this.procVars.set([...this.procVars(), { name: '', type: 'string' }]); this.markDirty(); }
  rmVar(i: number) { const v = [...this.procVars()]; v.splice(i, 1); this.procVars.set(v); this.markDirty(); }
  closeVars() { this.showVars.set(false); this.saveNow(); }

  autoLayout() {
    const ns = this.nodes();
    ns.forEach((n, i) => { n.x = 100 + (i % 4) * 230; n.y = 90 + Math.floor(i / 4) * 150; });
    this.nodes.set([...ns]); this.markDirty();
  }

  // ---- persistence ----
  markDirty() {
    this.saveState.set('dirty');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.save(); this.runValidate(); }, 800);
  }
  saveNow() { clearTimeout(this.saveTimer); this.save(); }
  private save() {
    if (!this.wf()) return;
    this.saveState.set('saving');
    this.api.saveProcess(this.projectId, this.pid, this.buildProcess()).subscribe({
      next: () => this.saveState.set('saved'),
      error: () => this.saveState.set('dirty'),
    });
  }
  validate() {
    this.api.validateProcess(this.buildProcess()).subscribe((r) => {
      this.problems.set(r.problems); this.validOk.set(r.ok);
      this.validationMsg.set(r.ok ? '✓ Process is valid' : `✗ ${r.errors.length} error(s)`);
    });
  }

  // ---- run / deploy (project-level) ----
  run() {
    this.saveNow();
    this.api.startInstance({ workflowId: this.projectId, processId: this.pid, environment: 'prod' }).subscribe({
      next: (i) => alert(`Instance started: ${i.id}\nStatus: ${i.status}`),
      error: (e) => alert(`Cannot run: ${e?.error?.error?.message || 'deploy the project to prod first'}`),
    });
  }
  deploy() {
    if (this.errorCount() > 0) { alert(`Fix ${this.errorCount()} validation error(s) before deploying.`); return; }
    this.saveNow();
    setTimeout(() => this.api.listVersions(this.branchId).subscribe((vs) => {
      const head = vs.filter((v) => v.state === 'draft').at(-1) || vs.at(-1);
      if (!head) return;
      this.api.publish(head.id, 'ui').subscribe({
        next: (p: any) => this.api.deploy(p.published.id, { environment: 'prod', activate: true }).subscribe(() => alert(`Deployed project v${p.published.number} to prod (active).`)),
        error: (e) => alert('Cannot deploy: ' + (e?.error?.error?.message || 'validation failed') + '\n' + ((e?.error?.error?.details || []).map((d: any) => '• ' + d.message).join('\n'))),
      });
    }), 400);
  }
}
