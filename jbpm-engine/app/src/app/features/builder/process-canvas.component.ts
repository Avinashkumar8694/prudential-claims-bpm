import { Component, ElementRef, HostListener, Input, OnChanges, SimpleChanges, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WorkflowApiService } from '../../core/api/workflow-api.service';
import { InstanceApiService } from '../../core/api/instance-api.service';
import { ToastService } from '../../shared/toast.service';
import type { CallableProcess, Catalog, NodeSpec, Problem } from '../../core/models';
import { PropertiesPanelComponent } from './properties-panel.component';
import { ProblemsPanelComponent } from './problems-panel.component';
import { IconComponent } from '../../shared/icon.component';

// A canvas node is just an engine node with x/y layout coords stored alongside (ignored by the SDK).
interface CNode { id: string; type: string; name?: string; x: number; y: number; [k: string]: any; }
interface CEdge { id: string; from: string; to: string; when?: string; lang?: string; label?: string; }

const NW = 190, NH = 48;
const COL_W = NW + 100, ROW_H = NH + 46;

// The process designer surface: palette + auto-laid-out canvas, embedded inside the Processes
// workspace (no route navigation to a separate page — see project-processes.component.ts).
//
// Layout is fully automatic (a layered/Sugiyama-style pass: column = longest-path depth from a start
// node, row = barycenter of predecessor rows) and re-runs after every structural change — add, delete,
// connect. This is deliberate: it keeps the graph always readable without the user having to tidy it,
// the way a call-flow / decision-tree builder does. Manual dragging still works between relayouts for
// ad-hoc nudging, but any add/delete/connect snaps back to the computed layout.
//
// Node/edge properties are edited via double-click → popup modal (jBPM-style), not an always-visible
// side panel, so the canvas gets the full width. Validate/Run/Build/Deploy live one level up (the
// workspace's shared toolbar), which calls into this component's public methods/signals via viewChild
// — this component only owns the live model.
@Component({
  selector: 'app-process-canvas',
  standalone: true,
  imports: [IconComponent, FormsModule, PropertiesPanelComponent, ProblemsPanelComponent],
  template: `
    <div class="builder">
      <div class="body">
        <!-- PALETTE (drag onto canvas, or click to append) -->
        <aside class="palette">
          <input class="search" placeholder="Search nodes…" [(ngModel)]="q" />
          @for (cat of cats(); track cat) {
            @if (nodesIn(cat, q).length) {
              <div class="cat-h">{{ cat }}</div>
              <div class="cat-grid">
                @for (n of nodesIn(cat, q); track n.key) {
                  <div class="ptile" draggable="true" (dragstart)="onDragStart($event, n)"
                       (click)="addFromPalette(n)" [title]="'Drag onto canvas, or click to add: ' + n.label">
                    <span class="pic" [style.background]="visual(n.engineType).color"><app-icon [name]="visual(n.engineType).icon" [size]="13" /></span>
                    <span class="plabel">{{ n.label }}</span>
                  </div>
                }
              </div>
            }
          }
        </aside>

        <!-- CANVAS -->
        <main #canvasEl class="canvas" (dragover)="$event.preventDefault()" (drop)="onDrop($event)">
          <div #scrollArea class="scrollArea" [class.panning]="panMode()" (click)="bgClick()" (pointerdown)="onCanvasPointerDown($event)">
            <div class="zoomlayer" [style.zoom]="zoom()">
              <svg class="edges">
                <defs>
                  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill="#9aa3b2" />
                  </marker>
                </defs>
                @for (e of edges(); track e.id) {
                  <path [attr.d]="edgePath(e)" class="edge" [class.sel]="selEdge()===e.id" marker-end="url(#arrow)"
                        (click)="selectEdge($event, e)" (dblclick)="$event.stopPropagation(); openEdgeEditor(e)" />
                }
                @if (linkFrom(); as lf) { <path [attr.d]="ghostPath(lf)" class="edge ghost" /> }
              </svg>

              @for (n of nodes(); track n.id) {
                <div class="node" [class.sel]="selNode()?.id===n.id" [class.linking]="linkFrom()===n.id"
                     [class.droptarget]="linkFrom() && linkFrom()!==n.id && hasIn(n.type)"
                     [class.has-err]="hasErr(n.id)" [class.has-warn]="!hasErr(n.id) && hasWarn(n.id)"
                     [class.shape-rectangle]="shapeOf(n.type)==='rectangle'" [class.shape-diamond]="shapeOf(n.type)==='diamond'"
                     [style.left.px]="n.x" [style.top.px]="n.y" [style.width.px]="NW" [title]="typeLabel(n)"
                     (pointerdown)="startDrag($event, n)" (pointerup)="onNodePointerUp($event, n)"
                     (click)="selectNode($event, n)" (dblclick)="$event.stopPropagation(); openNodeEditor(n)">
                  @if (hasErr(n.id)) { <span class="nmark err" title="Has errors">!</span> }
                  @else if (hasWarn(n.id)) { <span class="nmark warn" title="Has warnings">!</span> }
                  @if (hasIn(n.type)) { <span class="port in" title="Incoming"></span> }
                  <span class="chip" [style.background]="visual(n.type).color"><app-icon [name]="visual(n.type).icon" [size]="13" /></span>
                  <div class="ntitle">{{ n.name || labelFor(n) }}</div>
                  @if (hasOut(n.type)) { <span class="port out" title="Drag to a target node to connect" (pointerdown)="startLink($event, n)" (click)="$event.stopPropagation()"></span> }
                  @if (selNode()?.id===n.id) {
                    <button class="ndel" (pointerdown)="$event.stopPropagation()" (click)="del($event, n)" title="Delete" aria-label="Delete node"><app-icon name="trash" [size]="13" /></button>
                  }
                </div>
                @if (canAddFrom(n)) {
                  <button class="addbtn" [style.left.px]="n.x + NW + 8" [style.top.px]="n.y + NH/2 - 12"
                          (click)="openAddPopover($event, n)" title="Add next node" aria-label="Add next node">
                    <app-icon name="plus" [size]="13" />
                  </button>
                }
              }

              @for (b of numberedBranches(); track b.edge.id) {
                <div class="branchbadge" [style.left.px]="b.x" [style.top.px]="b.y" (dblclick)="openEdgeEditor(b.edge)" [title]="'Branch ' + b.text + ' — double-click to label'">{{ b.text }}</div>
              }
              @for (b of labeledBranches(); track b.edge.id) {
                <div class="branchpill" [style.left.px]="b.x" [style.top.px]="b.y" (dblclick)="openEdgeEditor(b.edge)" title="Double-click to edit">{{ b.text }}</div>
              }

              @if (nodes().length === 0) {
                <div class="empty">
                  <div class="empty-ic">＋</div>
                  <h3>Build your flow</h3>
                  <p>Drag a node from the palette onto the canvas, or click a palette entry to append one. Double-click a node to configure it.</p>
                </div>
              }
            </div>
          </div>

          @if (addPopoverFor(); as fromId) {
            <div class="addpop" [style.left.px]="addPopoverPos().x" [style.top.px]="addPopoverPos().y" (click)="$event.stopPropagation()">
              <div class="addpop-h">
                <input class="search" placeholder="Search nodes…" [(ngModel)]="addQ" />
                <button class="x" (click)="closeAddPopover()" aria-label="Close"><app-icon name="close" [size]="14" /></button>
              </div>
              <div class="addpop-body">
                @for (cat of cats(); track cat) {
                  @if (nodesIn(cat, addQ).length) {
                    <div class="cat-h">{{ cat }}</div>
                    <div class="cat-grid">
                      @for (n of nodesIn(cat, addQ); track n.key) {
                        <div class="ptile" (click)="pickAdd(n)" [title]="n.label">
                          <span class="pic" [style.background]="visual(n.engineType).color"><app-icon [name]="visual(n.engineType).icon" [size]="13" /></span>
                          <span class="plabel">{{ n.label }}</span>
                        </div>
                      }
                    </div>
                  }
                }
              </div>
            </div>
          }

          <div class="zoomctrl">
            <button (click)="zoomOut()" title="Zoom out" aria-label="Zoom out">−</button>
            <button class="zpct" (click)="zoomReset()" title="Reset zoom">{{ zoomPct() }}%</button>
            <button (click)="zoomIn()" title="Zoom in" aria-label="Zoom in">+</button>
            <button class="hand" [class.active]="panMode()" (click)="panMode.set(!panMode())" title="Pan tool" aria-label="Toggle pan tool"><app-icon name="move" [size]="13" /></button>
          </div>

          @if (linkError()) { <div class="hint-bar err"><app-icon name="error" [size]="14" /> {{ linkError() }}</div> }
          @else if (linkFrom()) { <div class="hint-bar">Release on a target node to connect (or click a node) — click empty space to cancel.</div> }
        </main>
      </div>

      <app-problems-panel [problems]="problems()" [errorCount]="errorCount()" [warnCount]="warnCount()" (pick)="pickProblem($event)"></app-problems-panel>

      @if (editingNode(); as n) {
        <div class="modal-bg" (click)="closeNodeEditor()">
          <div class="modal" (click)="$event.stopPropagation()">
            <div class="modal-h"><span class="chip sm" [style.background]="visual(n.type).color"><app-icon [name]="visual(n.type).icon" [size]="13" /></span>{{ typeLabel(n) }}<span class="spacer"></span><button class="x" (click)="closeNodeEditor()" aria-label="Close"><app-icon name="close" [size]="15" /></button></div>
            <div class="modal-body">
              <label class="fld"><span>Node ID</span><input [value]="n.id" disabled /></label>
              <app-properties-panel [node]="n" [allNodes]="nodes()" [sections]="schemaFor(n.type)" [assets]="assets" [ownVars]="procVars()" [callableProcesses]="callableProcesses()" (changed)="markDirty()"></app-properties-panel>
              <button class="btn danger full" (click)="del($event, n); closeNodeEditor()">Delete node</button>
            </div>
          </div>
        </div>
      }

      @if (editingEdge(); as e) {
        <div class="modal-bg" (click)="closeEdgeEditor()">
          <div class="modal narrow" (click)="$event.stopPropagation()">
            <div class="modal-h"><span>Connection</span><span class="spacer"></span><button class="x" (click)="closeEdgeEditor()" aria-label="Close"><app-icon name="close" [size]="15" /></button></div>
            <div class="modal-body">
              @if (siblingCount(e) > 1) {
                <label class="fld"><span>Branch label</span><input [(ngModel)]="e.label" (ngModelChange)="onEdgeChange(e)" placeholder="e.g. Open, Close, Approved…" /></label>
                <p class="hint">Shown on the canvas above this branch. Leave empty for a plain numbered branch.</p>
              }
              <label class="fld"><span>Condition (js)</span><input [(ngModel)]="e.when" (ngModelChange)="onEdgeChange(e)" placeholder="e.g. amount > 1000" /></label>
              <p class="hint">Leave empty for an unconditional / default flow.</p>
              <button class="btn danger full" (click)="delEdge(e.id); closeEdgeEditor()">Delete connection</button>
            </div>
          </div>
        </div>
      }

      @if (showVars()) {
        <div class="modal-bg" (click)="closeVars()">
          <div class="modal" (click)="$event.stopPropagation()">
            <div class="modal-h"><span>Process Variables</span><span class="spacer"></span><button class="x" (click)="closeVars()" aria-label="Close"><app-icon name="close" [size]="15" /></button></div>
            <div class="modal-body">
              <p class="hint">Typed data this process carries. Referenced from scripts (kcontext), conditions, and data mappings.</p>
              @for (v of procVars(); track $index) {
                <div class="vrow">
                  <input placeholder="name" [(ngModel)]="v.name" (ngModelChange)="markDirty()" />
                  <select [(ngModel)]="v.type" (ngModelChange)="markDirty()">
                    <option>string</option><option>int</option><option>long</option><option>double</option><option>bool</option><option>date</option><option>object</option><option>list</option><option>map</option>
                  </select>
                  <button class="x" (click)="rmVar($index)" aria-label="Remove variable"><app-icon name="close" [size]="13" /></button>
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
    .body { flex: 1; display: flex; min-height: 0; }

    .palette { width: 236px; flex-shrink: 0; background: var(--surface); border-right: 1px solid var(--border); overflow-y: auto; padding: 14px 12px; }
    .search { width: 100%; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; margin-bottom: 8px; font-size: 13px; }
    .search:focus { outline: none; border-color: var(--primary); }
    .cat-h { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; margin: 14px 2px 8px; }
    /* Compact single-column rows, not 2-up tiles. The palette carries 30+ node types across six
       categories; as large centred tiles that was ~3 screens of scrolling and pushed the canvas
       into a strip. Icon-left rows fit ~4x more per screen and scan faster. */
    .cat-grid { display: flex; flex-direction: column; gap: 2px; }
    .ptile { display: flex; flex-direction: row; align-items: center; gap: 9px; padding: 6px 8px; border: 1px solid transparent; border-radius: 8px; cursor: grab; background: transparent; text-align: left; transition: background-color .12s, border-color .12s; }
    .ptile:hover { background: var(--surface-3); border-color: var(--border); }
    .ptile:active { cursor: grabbing; }
    .pic { width: 24px; height: 24px; flex-shrink: 0; display: grid; place-items: center; border-radius: 7px; color: #fff; font-size: 12px; font-weight: 600; }
    .plabel { font-size: 12.5px; color: var(--text); line-height: 1.3; }

    .canvas { position: relative; flex: 1; overflow: hidden; }
    .scrollArea { position: absolute; inset: 0; overflow: auto; cursor: default;
      background-color: var(--canvas-bg);
      background-image: radial-gradient(circle, var(--canvas-dot) 1.1px, transparent 1.1px);
      background-size: 22px 22px; }
    .scrollArea.panning { cursor: grab; }
    .scrollArea.panning:active { cursor: grabbing; }
    .zoomlayer { position: relative; min-width: 100%; min-height: 100%; }
    .edges { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
    .edge { fill: none; stroke: var(--border-strong); stroke-width: 2; pointer-events: stroke; cursor: pointer; }
    .edge:hover { stroke: var(--muted); } .edge.sel { stroke: var(--primary); stroke-width: 2.5; }
    .edge.ghost { stroke: var(--primary); stroke-dasharray: 5 4; opacity: .7; }

    /* Compact pill nodes — icon + single-line label only, matching a call-flow / decision-tree
       builder's density rather than a BPMN-tool card. Type detail moves to the title tooltip. */
    .node { position: absolute; height: ${NH}px; background: var(--surface); border: 1px solid var(--border); border-radius: 999px;
      box-shadow: var(--shadow-card); display: flex; align-items: center; gap: 10px; padding: 0 16px; cursor: grab; user-select: none; transition: box-shadow .12s, border-color .12s; }
    .node:hover { box-shadow: var(--shadow-pop); }
    .node.sel { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(91,61,245,.18), var(--shadow-card); }
    .node.linking { border-color: var(--primary); }
    .node.droptarget { border-color: var(--green); box-shadow: 0 0 0 3px rgba(22,163,74,.18), var(--shadow-card); cursor: alias; }
    .node.has-err { border-color: #f0a5a5; } .node.has-warn { border-color: #f0cf8a; }
    /* Real BPMN 2.0 shape per engine type (see NodeDef.diagram.shape, served via /catalog/nodes):
       events stay the base pill/fully-rounded look (as close to a circle as a fixed-width, labeled
       node can get); gateways get a diamond icon-badge as the shape signal (a genuinely diamond-
       shaped CARD with an inline text label reads as broken at this aspect ratio — real BPMN
       diamonds are icon-only); tasks get a squarer, more traditional "task box" radius. */
    .node.shape-rectangle { border-radius: 12px; }
    .node.shape-diamond .chip { border-radius: 4px; transform: rotate(45deg); }
    .node.shape-diamond .chip app-icon { display: inline-flex; transform: rotate(-45deg); }
    .nmark { position: absolute; top: -9px; left: -9px; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: 12px; color: #fff; box-shadow: var(--shadow-card); z-index: 2; }
    .nmark.err { background: var(--red); } .nmark.warn { background: #d97706; }
    .node .chip { width: 26px; height: 26px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 50%; color: #fff; font-size: 13px; font-weight: 600; }
    .ntitle { min-width: 0; font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .port { position: absolute; top: 50%; width: 16px; height: 16px; border-radius: 50%; background: var(--surface); border: 2px solid var(--border-strong); transform: translateY(-50%); cursor: crosshair; z-index: 3; }
    .port:hover { border-color: var(--primary); background: #eae6ff; transform: translateY(-50%) scale(1.25); }
    .port.out { right: -9px; box-shadow: 0 0 0 3px rgba(91,61,245,.08); }
    .port.in { left: -9px; }
    .node:hover .port.out { border-color: var(--primary); }
    .ndel { position: absolute; top: -12px; right: 8px; width: 26px; height: 26px; border-radius: 7px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; box-shadow: var(--shadow-card); z-index: 4; }
    .ndel:hover { background: var(--red-bg); border-color: var(--border-strong); }

    /* Inline "+ add" button — appends (and connects) a new node right after this one; matches the
       call-flow reference's inline add affordance. Sits between a node and the next column. */
    .addbtn { position: absolute; width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--border-strong); background: var(--surface); color: var(--muted); display: grid; place-items: center; cursor: pointer; box-shadow: var(--shadow-card); z-index: 3; }
    .addbtn:hover { border-color: var(--primary); color: var(--primary); background: var(--primary-50); }

    /* Branch markers on multi-output edges: a small numbered circle by default, or a named pill once
       the user labels the branch (double-click) — e.g. "Open" / "Close" on a business-hours gateway. */
    .branchbadge { position: absolute; width: 22px; height: 22px; border-radius: 50%; background: var(--text); color: var(--surface); font-size: 11px; font-weight: 700; display: grid; place-items: center; box-shadow: var(--shadow-card); z-index: 3; cursor: pointer; }
    .branchpill { position: absolute; transform: translate(-6px, -30px); background: var(--surface); border: 1px solid var(--border-strong); border-radius: 999px; padding: 3px 12px; font-size: 11.5px; font-weight: 600; color: var(--text-secondary); box-shadow: var(--shadow-card); z-index: 3; cursor: pointer; white-space: nowrap; }

    .empty { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); text-align: center; color: var(--muted); max-width: 340px; }
    .empty-ic { width: 56px; height: 56px; margin: 0 auto 10px; border-radius: 16px; background: var(--surface); border: 1px dashed var(--border-strong); display: grid; place-items: center; font-size: 26px; color: var(--border-strong); }
    .empty h3 { margin: 6px 0; color: var(--text); }
    .hint-bar { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); background: var(--primary); color: #fff; padding: 7px 14px; border-radius: 999px; font-size: 12px; box-shadow: var(--shadow-pop); z-index: 10; }
    .hint-bar.err { background: var(--red); }

    /* Bottom-right zoom + pan control — fixed to the canvas pane, not the scrollable content. */
    .zoomctrl { position: absolute; bottom: 16px; right: 16px; display: flex; align-items: center; gap: 2px; background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 4px; box-shadow: var(--shadow-pop); z-index: 20; }
    .zoomctrl button { width: 28px; height: 28px; border: none; background: transparent; border-radius: 50%; cursor: pointer; color: var(--text-secondary); font-size: 15px; display: grid; place-items: center; }
    .zoomctrl button:hover { background: var(--surface-3); color: var(--text); }
    .zoomctrl .zpct { width: auto; padding: 0 8px; font-size: 12px; font-weight: 600; }
    .zoomctrl .hand { margin-left: 2px; border-left: 1px solid var(--border); border-radius: 0 999px 999px 0; }
    .zoomctrl .hand.active { color: var(--primary); background: var(--primary-50); }

    /* Inline "add node" popover — same tile visual as the palette, floating near the + button. */
    .addpop { position: absolute; width: 240px; max-height: 340px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow-pop); z-index: 30; display: flex; flex-direction: column; }
    .addpop-h { display: flex; align-items: center; gap: 6px; padding: 8px; border-bottom: 1px solid var(--border); }
    .addpop-h .search { margin: 0; }
    .addpop-h .x { flex-shrink: 0; border: none; background: transparent; color: var(--muted); cursor: pointer; }
    .addpop-body { overflow: auto; padding: 6px 8px; }

    .fld { display: block; margin-bottom: 12px; } .fld span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 5px; }
    .fld input, .fld select, .fld textarea { width: 100%; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; font-size: 13px; font-family: inherit; }
    .fld input:focus, .fld select:focus, .fld textarea:focus { outline: none; border-color: var(--primary); }
    .hint { font-size: 12px; color: var(--muted); line-height: 1.5; }
    .btn.full { width: 100%; justify-content: center; margin-top: 8px; }
    .btn.danger { color: var(--red); border-color: var(--border-strong); } .btn.danger:hover { background: var(--red-bg); }

    .modal-bg { position: fixed; inset: 0; background: rgba(16,24,40,.4); display: grid; place-items: center; z-index: 50; }
    .modal { background: var(--surface); border-radius: 14px; width: 480px; max-width: 92vw; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column; box-shadow: var(--shadow-pop); }
    .modal.narrow { width: 400px; }
    .modal-h { display: flex; align-items: center; gap: 8px; padding: 14px 18px; border-bottom: 1px solid var(--border); font-weight: 700; }
    .modal-h .chip.sm { width: 24px; height: 24px; border-radius: 7px; color: #fff; display: grid; place-items: center; font-size: 12px; }
    .modal-h .x { border: none; background: transparent; font-size: 16px; cursor: pointer; color: var(--muted); }
    .modal-body { padding: 16px 18px; overflow: auto; }
    .vrow { display: flex; gap: 8px; margin-bottom: 8px; }
    .vrow input { flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; }
    .vrow select { flex: 0 0 120px; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; }
    .vrow .x { flex: 0 0 auto; width: 32px; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; cursor: pointer; color: var(--muted); }
    .vrow .x:hover { background: var(--red-bg); color: var(--red); }
    .modal-body .add { border: 1px dashed var(--border); background: var(--surface); border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; color: var(--muted); margin-top: 6px; }
    .modal-body .add:hover { border-color: var(--primary); color: var(--primary); }
  `],
})
export class ProcessCanvasComponent implements OnChanges {
  private api = inject(WorkflowApiService);
  private instanceApi = inject(InstanceApiService);
  private toast = inject(ToastService);
  private canvasElRef = viewChild<ElementRef<HTMLElement>>('canvasEl');
  private scrollRef = viewChild<ElementRef<HTMLElement>>('scrollArea');

  @Input({ required: true }) workflowId!: string;
  @Input({ required: true }) processId!: string;
  /** The project's assets by kind, passed straight through to the property modal's asset-reference
   *  pickers (see properties-panel.component.ts). Owned by ProjectContextService one level up. */
  @Input() assets: Record<string, { name: string; usedBy: number }[]> = {};

  catalog = signal<Catalog | null>(null);
  callableProcesses = signal<CallableProcess[]>([]);
  private callableProcessesLoaded = false;
  nodes = signal<CNode[]>([]);
  edges = signal<CEdge[]>([]);
  selNode = signal<CNode | null>(null);
  selEdge = signal<string | null>(null);
  editingNode = signal<CNode | null>(null);
  editingEdge = signal<CEdge | null>(null);
  linkFrom = signal<string | null>(null);
  linkError = signal<string>('');
  saveState = signal<'saved' | 'saving' | 'dirty'>('saved');
  showVars = signal(false);
  procVars = signal<{ name: string; type: string }[]>([]);
  processName = signal('');
  q = '';
  addQ = '';
  zoom = signal(1);
  panMode = signal(false);
  addPopoverFor = signal<string | null>(null);
  addPopoverPos = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  NW = NW; NH = NH;
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
  zoomPct = computed(() => Math.round(this.zoom() * 100));

  /** Branches (multi-output edges) that the user has given an explicit name — rendered as a pill
   *  above the branch, e.g. "Open" / "Close" on a business-hours gateway. */
  labeledBranches = computed(() => {
    const out: { edge: CEdge; x: number; y: number; text: string }[] = [];
    for (const e of this.edges()) {
      if (!e.label) continue;
      if (this.siblingCount(e) <= 1) continue;
      const b = this.nodeById(e.to); if (!b) continue;
      out.push({ edge: e, x: b.x, y: b.y - 30, text: e.label });
    }
    return out;
  });
  /** Branches with no explicit label get a small numbered circle instead (1, 2, 3…), sitting on the
   *  incoming connector just before the target node. */
  numberedBranches = computed(() => {
    const out: { edge: CEdge; x: number; y: number; text: string }[] = [];
    for (const e of this.edges()) {
      if (e.label) continue;
      const siblings = this.edges().filter((x) => x.from === e.from);
      if (siblings.length <= 1) continue;
      const b = this.nodeById(e.to); if (!b) continue;
      out.push({ edge: e, x: b.x - 30, y: b.y + NH / 2 - 11, text: String(siblings.indexOf(e) + 1) });
    }
    return out;
  });
  siblingCount(e: CEdge) { return this.edges().filter((x) => x.from === e.from).length; }

  hasErr(id: string) { return this.errIds().has(id); }
  hasWarn(id: string) { return this.warnIds().has(id); }
  private runValidate() {
    this.api.validateProcess(this.buildProcess()).subscribe((r) => this.problems.set(r.problems));
  }
  pickProblem(id: string) {
    const n = this.nodes().find((x) => x.id === id);
    if (n) { this.selNode.set(n); this.selEdge.set(null); return; }
    const e = this.edges().find((x) => x.id === id);
    if (e) { this.selEdge.set(e.id); this.selNode.set(null); }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['processId'] || changes['workflowId']) {
      this.selNode.set(null); this.selEdge.set(null); this.editingNode.set(null); this.editingEdge.set(null);
      this.zoom.set(1); this.panMode.set(false); this.addPopoverFor.set(null);
      if (!this.catalog()) this.api.catalog().subscribe((c) => this.catalog.set(c));
      if (!this.callableProcessesLoaded) { this.callableProcessesLoaded = true; this.api.callableProcesses().subscribe((ps) => this.callableProcesses.set(ps)); }
      this.api.getProcess(this.workflowId, this.processId).subscribe((p) => this.loadProcess(p));
      this.api.getWorkflow(this.workflowId).subscribe((w) => { this.branchId = w.defaultBranchId; });
    }
  }

  // ---- visuals / labels ----
  visual(t: string) { return this.catalog()?.diagram?.[t] || { icon: 'info', color: '#64748b', shape: 'rectangle' as const }; }
  shapeOf(t: string) { return this.visual(t).shape; }
  labelFor(n: CNode) { return this.catalog()?.nodes.find((s) => s.engineType === n.type)?.label || n.type; }
  typeLabel(n: CNode) { return this.catalog()?.typeLabels?.[n.type] || n.type; }
  nodesIn(cat: string, query: string): NodeSpec[] {
    const q = query.trim().toLowerCase();
    return (this.catalog()?.nodes ?? []).filter((n) => n.category === cat && (!q || n.label.toLowerCase().includes(q)));
  }

  // ---- load / map (a single process within the project) ----
  private loadProcess(proc: any) {
    if (!proc) return;
    this.processName.set(proc.name || this.processId);
    this.procVars.set([...(proc.vars || [])]);
    const cn: CNode[] = (proc.nodes || []).map((n: any, i: number) => ({
      ...n, x: n.x ?? (100 + (i % 4) * 230), y: n.y ?? (90 + Math.floor(i / 4) * 150),
    }));
    this.nodes.set(cn);
    this.edges.set((proc.flows || []).map((f: any, i: number) => ({ id: f.id || `e${i}_${f.from}_${f.to}`, from: f.from, to: f.to, when: f.when, lang: f.lang, label: f.label })));
    this.applyAutoLayout();
    this.saveState.set('saved');
    this.runValidate();
  }

  private buildProcess() {
    return {
      id: this.processId, name: this.processName(), package: 'com.acme', vars: this.procVars(),
      nodes: this.nodes().map((n) => ({ ...n })),
      flows: this.edges().map((e) => ({ id: e.id, from: e.from, to: e.to, ...(e.when ? { when: e.when, lang: 'js' } : {}), ...(e.label ? { label: e.label } : {}) })),
    };
  }

  // ---- palette drag → drop (position is transient — applyAutoLayout() snaps it into place) ----
  onDragStart(ev: DragEvent, spec: NodeSpec) { ev.dataTransfer?.setData('text/plain', spec.key); if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy'; }
  onDrop(ev: DragEvent) {
    ev.preventDefault();
    const key = ev.dataTransfer?.getData('text/plain');
    const spec = this.catalog()?.nodes.find((s) => s.key === key);
    if (!spec) return;
    const node: CNode = { id: this.newId(spec.engineType), ...(spec.defaults as any), name: (spec.defaults as any).name || spec.label, x: 40, y: 40 };
    this.nodes.set([...this.nodes(), node]);
    this.selNode.set(node); this.selEdge.set(null);
    this.applyAutoLayout(); this.markDirty();
  }
  private newId(type: string) { return `${type}_${(this.idc++).toString(36)}${Date.now().toString(36).slice(-3)}`; }

  /** Click-to-add fallback (works even where native HTML5 drag doesn't). */
  addFromPalette(spec: NodeSpec) {
    const node: CNode = { id: this.newId(spec.engineType), ...(spec.defaults as any), name: (spec.defaults as any).name || spec.label, x: 40, y: 40 };
    this.nodes.set([...this.nodes(), node]);
    this.selNode.set(node); this.selEdge.set(null);
    this.applyAutoLayout(); this.markDirty();
  }

  // ---- inline "+" add: append (and connect) a node straight from an existing one ----
  canAddFrom(n: CNode): boolean {
    if (!this.hasOut(n.type)) return false;
    const p = this.portsFor(n.type);
    const outCount = this.edges().filter((e) => e.from === n.id).length;
    return p.maxOut == null || outCount < p.maxOut;
  }
  openAddPopover(ev: Event, n: CNode) {
    ev.stopPropagation();
    const btn = ev.currentTarget as HTMLElement;
    const canvasEl = this.canvasElRef()?.nativeElement; if (!canvasEl) return;
    const br = btn.getBoundingClientRect(), cr = canvasEl.getBoundingClientRect();
    this.addPopoverPos.set({ x: Math.min(br.left - cr.left + 30, cr.width - 250), y: Math.min(Math.max(0, br.top - cr.top - 40), cr.height - 340) });
    this.addPopoverFor.set(n.id);
    this.addQ = '';
  }
  closeAddPopover() { this.addPopoverFor.set(null); }
  pickAdd(spec: NodeSpec) {
    const fromId = this.addPopoverFor(); if (!fromId) return;
    const from = this.nodes().find((x) => x.id === fromId);
    this.addPopoverFor.set(null);
    if (!from) return;
    const node: CNode = { id: this.newId(spec.engineType), ...(spec.defaults as any), name: (spec.defaults as any).name || spec.label, x: from.x + COL_W, y: from.y };
    const check = this.canConnect(from, node);
    this.nodes.set([...this.nodes(), node]);
    if (check.ok) this.edges.set([...this.edges(), { id: `e${this.idc++}_${fromId}_${node.id}`, from: fromId, to: node.id }]);
    else this.toast.error(check.reason || 'Added the node, but could not auto-connect it');
    this.selNode.set(node); this.selEdge.set(null);
    this.applyAutoLayout(); this.markDirty();
  }

  // ---- node drag (pointer) — free nudge between auto-layout passes ----
  startDrag(ev: PointerEvent, n: CNode) {
    if ((ev.target as HTMLElement).classList.contains('port')) return;
    const { x: px, y: py } = this.toLocal(ev.clientX, ev.clientY);
    this.drag = { id: n.id, offX: px - n.x, offY: py - n.y, moved: false };
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
  }
  @HostListener('document:pointermove', ['$event'])
  onMove(ev: PointerEvent) {
    const el = this.scrollRef()?.nativeElement; if (!el) return;
    this.pointer = this.toLocal(ev.clientX, ev.clientY);
    if (this.linkFrom()) this.linkMoved = true;   // moved while linking → treat as a drag-connect
    if (!this.drag) return;
    const n = this.nodes().find((x) => x.id === this.drag!.id); if (!n) return;
    n.x = Math.max(4, this.pointer.x - this.drag.offX); n.y = Math.max(4, this.pointer.y - this.drag.offY);
    this.drag.moved = true;
  }
  @HostListener('document:pointerup')
  onUp() {
    this.drag = null;
    // released after dragging a link but not over a valid node → cancel; a plain click stays "armed"
    if (this.linkFrom() && this.linkMoved) { this.linkFrom.set(null); this.linkMoved = false; }
  }

  /** Screen (clientX/Y) → logical canvas coordinates, correcting for the CSS `zoom` on `.zoomlayer`
   *  (zoom rescales rendered/hit-tested size, so raw client-space deltas must be divided back down). */
  private toLocal(clientX: number, clientY: number): { x: number; y: number } {
    const el = this.scrollRef()!.nativeElement;
    const rect = el.getBoundingClientRect();
    const z = this.zoom();
    return { x: (clientX - rect.left + el.scrollLeft) / z, y: (clientY - rect.top + el.scrollTop) / z };
  }

  // ---- selection (single click highlights; double-click opens the property modal) ----
  selectNode(ev: Event, n: CNode) { ev.stopPropagation(); if (this.linkFrom()) { this.completeLink(n); return; } this.selNode.set(n); this.selEdge.set(null); }
  selectEdge(ev: Event, e: CEdge) { ev.stopPropagation(); this.selEdge.set(e.id); this.selNode.set(null); }
  bgClick() { this.linkFrom.set(null); this.linkMoved = false; this.linkError.set(''); this.selNode.set(null); this.selEdge.set(null); this.addPopoverFor.set(null); }
  openNodeEditor(n: CNode) { this.selNode.set(n); this.selEdge.set(null); this.editingNode.set(n); }
  closeNodeEditor() { this.editingNode.set(null); }
  openEdgeEditor(e: CEdge) { this.selEdge.set(e.id); this.selNode.set(null); this.editingEdge.set(e); }
  closeEdgeEditor() { this.editingEdge.set(null); }

  // ---- pan tool: drag the background to scroll (toggled via the zoom control's hand button) ----
  onCanvasPointerDown(ev: PointerEvent) {
    if (!this.panMode()) return;
    if ((ev.target as HTMLElement).closest('.node, .addbtn, .branchpill, .branchbadge')) return;
    const el = this.scrollRef()!.nativeElement;
    const startX = ev.clientX, startY = ev.clientY, startLeft = el.scrollLeft, startTop = el.scrollTop;
    const move = (e: PointerEvent) => { el.scrollLeft = startLeft - (e.clientX - startX); el.scrollTop = startTop - (e.clientY - startY); };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }

  // ---- zoom ----
  zoomIn() { this.zoom.set(Math.min(1.5, Math.round((this.zoom() + 0.1) * 10) / 10)); }
  zoomOut() { this.zoom.set(Math.max(0.5, Math.round((this.zoom() - 0.1) * 10) / 10)); }
  zoomReset() { this.zoom.set(1); }

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
    clear(); this.applyAutoLayout(); this.markDirty();
  }
  // per-node config from the backend catalog (single source of truth for ports + property schema)
  portsFor(type: string) { return this.catalog()?.ports?.[type] || {}; }
  hasIn(type: string) { return this.portsFor(type).maxIn !== 0; }    // input port unless maxIn is 0
  hasOut(type: string) { return this.portsFor(type).maxOut !== 0; }  // output port unless maxOut is 0
  schemaFor(type: string) { return this.catalog()?.schemas?.[type] || []; }

  /** Connection validity from each node type's declared ports + cardinality (matches the backend). */
  canConnect(from: CNode, to: CNode): { ok: boolean; reason?: string } {
    const fp = this.portsFor(from.type), tp = this.portsFor(to.type);
    if (fp.maxOut === 0) return { ok: false, reason: `A ${from.type} has no outgoing connection` };
    if (tp.maxIn === 0) return { ok: false, reason: `A ${to.type} has no incoming connection` };
    if (this.edges().some((e) => e.from === from.id && e.to === to.id)) return { ok: false, reason: 'That connection already exists' };
    const outCount = this.edges().filter((e) => e.from === from.id).length;
    const inCount = this.edges().filter((e) => e.to === to.id).length;
    if (fp.maxOut != null && outCount >= fp.maxOut) return { ok: false, reason: `A ${from.type} allows only ${fp.maxOut} outgoing connection${fp.maxOut === 1 ? '' : 's'}` };
    if (tp.maxIn != null && inCount >= tp.maxIn) return { ok: false, reason: `A ${to.type} allows only ${tp.maxIn} incoming connection${tp.maxIn === 1 ? '' : 's'}` };
    // a gateway is diverging (1→many) OR converging (many→1), never both (mixed)
    if (from.type === 'gateway' && this.edges().filter((e) => e.to === from.id).length > 1 && outCount >= 1)
      return { ok: false, reason: 'A converging gateway (many→1) cannot also branch out — use a separate gateway' };
    if (to.type === 'gateway' && this.edges().filter((e) => e.from === to.id).length > 1 && inCount >= 1)
      return { ok: false, reason: 'A diverging gateway (1→many) cannot also merge in — use a separate gateway' };
    return { ok: true };
  }
  /** `e` is the same object living inside the `edges` signal's array — mutating a field on it in
   *  place does NOT change the array's reference, so `computed()`s that depend on `edges()` (the
   *  branch-badge/pill lists) would never re-run without this explicit re-set. */
  onEdgeChange(_e: CEdge) { this.edges.set([...this.edges()]); this.markDirty(); }

  // ---- delete ----
  del(ev: Event, n: CNode) {
    ev.stopPropagation();
    this.nodes.set(this.nodes().filter((x) => x.id !== n.id));
    this.edges.set(this.edges().filter((e) => e.from !== n.id && e.to !== n.id));
    this.selNode.set(null); this.applyAutoLayout(); this.markDirty();
  }
  delEdge(id: string) { this.edges.set(this.edges().filter((e) => e.id !== id)); this.selEdge.set(null); this.applyAutoLayout(); this.markDirty(); }

  // ---- geometry ----
  private nodeById(id: string) { return this.nodes().find((n) => n.id === id); }

  /**
   * Orthogonal ("Manhattan") sequence-flow routing — horizontal/vertical segments only, with
   * rounded corners.
   *
   * This is not a style preference: BPMN 2.0 renders sequence flows as right-angled polylines, and
   * every BPMN tool in the category (bpmn-js — which Camunda's modelers are built on — and jBPM's
   * own Stunner designer) routes this way. Curved bezier edges are the convention for generic DAG
   * editors (React Flow's default), not for BPMN, and read as visually wrong to anyone who has used
   * a real BPMN modeller.
   */
  private orthPath(x1: number, y1: number, x2: number, y2: number): string {
    const R = 8; // corner radius
    // Same row (within a node-height's tolerance): a straight horizontal run.
    if (Math.abs(y2 - y1) < 2) return `M ${x1} ${y1} L ${x2} ${y2}`;

    // Otherwise: out horizontally, turn vertically at the midpoint, turn back in horizontally.
    const midX = x1 + Math.max(24, (x2 - x1) / 2);
    const down = y2 > y1;
    const r = Math.min(R, Math.abs(y2 - y1) / 2, Math.abs(midX - x1), Math.abs(x2 - midX));
    const vSign = down ? 1 : -1;
    return [
      `M ${x1} ${y1}`,
      `L ${midX - r} ${y1}`,
      `Q ${midX} ${y1} ${midX} ${y1 + r * vSign}`,     // corner 1
      `L ${midX} ${y2 - r * vSign}`,
      `Q ${midX} ${y2} ${midX + r} ${y2}`,             // corner 2
      `L ${x2} ${y2}`,
    ].join(' ');
  }

  edgePath(e: CEdge) {
    const a = this.nodeById(e.from), b = this.nodeById(e.to);
    if (!a || !b) return '';
    return this.orthPath(a.x + NW, a.y + NH / 2, b.x, b.y + NH / 2);
  }
  ghostPath(fromId: string) {
    const a = this.nodeById(fromId); if (!a) return '';
    return this.orthPath(a.x + NW, a.y + NH / 2, this.pointer.x, this.pointer.y);
  }

  // ---- process variables (this process's own variables) ----
  openVars() { this.showVars.set(true); }
  addVar() { this.procVars.set([...this.procVars(), { name: '', type: 'string' }]); this.markDirty(); }
  rmVar(i: number) { const v = [...this.procVars()]; v.splice(i, 1); this.procVars.set(v); this.markDirty(); }
  closeVars() { this.showVars.set(false); this.saveNow(); }

  /**
   * Layered ("Sugiyama-style") auto-layout, re-run after every structural change (add/delete/connect)
   * so the graph always reads cleanly without manual tidying:
   *  - column = each node's longest-path depth from a start node (relaxed over a few passes, which
   *    also tolerates loop-back edges — they just stop improving once the acyclic part is settled).
   *  - row within a column = barycenter (average) of its predecessors' rows, then resolved to
   *    integer ranks — the standard cheap approximation for minimising edge crossings.
   */
  private computeLayeredPositions(): Map<string, { x: number; y: number }> {
    const ns = this.nodes(), es = this.edges();
    const ids = ns.map((n) => n.id);
    const col = new Map<string, number>();
    const roots = ns.filter((n) => n.type === 'start' || !es.some((e) => e.to === n.id));
    const rootIds = (roots.length ? roots : ns.slice(0, 1)).map((n) => n.id);
    for (const id of rootIds) col.set(id, 0);
    for (let pass = 0; pass < ns.length + 1; pass++) {
      let changed = false;
      for (const e of es) {
        if (!col.has(e.from)) continue;
        const c = col.get(e.from)! + 1;
        if (!col.has(e.to) || col.get(e.to)! < c) { col.set(e.to, c); changed = true; }
      }
      if (!changed) break;
    }
    let maxCol = Math.max(0, ...[...col.values()]);
    for (const id of ids) if (!col.has(id)) { maxCol += 1; col.set(id, maxCol); }

    const byCol = new Map<number, string[]>();
    for (const n of ns) { const c = col.get(n.id)!; (byCol.get(c) || byCol.set(c, []).get(c)!).push(n.id); }

    const row = new Map<string, number>();
    const cols = [...byCol.keys()].sort((a, b) => a - b);
    for (const c of cols) {
      const idsInCol = byCol.get(c)!;
      if (c === 0) { idsInCol.forEach((id, i) => row.set(id, i)); continue; }
      const scored = idsInCol.map((id) => {
        const preds = es.filter((e) => e.to === id && row.has(e.from)).map((e) => row.get(e.from)!);
        const score = preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : idsInCol.indexOf(id);
        return { id, score };
      });
      scored.sort((a, b) => a.score - b.score);
      scored.forEach((s, i) => row.set(s.id, i));
    }

    const out = new Map<string, { x: number; y: number }>();
    for (const n of ns) out.set(n.id, { x: 40 + col.get(n.id)! * COL_W, y: 40 + row.get(n.id)! * ROW_H });
    return out;
  }

  applyAutoLayout() {
    const pos = this.computeLayeredPositions();
    const ns = this.nodes();
    for (const n of ns) { const p = pos.get(n.id); if (p) { n.x = p.x; n.y = p.y; } }
    this.nodes.set([...ns]);
  }
  /** Public re-snap, wired to the workspace toolbar's "Auto-layout" button. */
  autoLayout() { this.applyAutoLayout(); this.markDirty(); }

  // ---- persistence ----
  markDirty() {
    this.saveState.set('dirty');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.save(); this.runValidate(); }, 800);
  }
  saveNow() { clearTimeout(this.saveTimer); this.save(); }
  private save() {
    this.saveState.set('saving');
    this.api.saveProcess(this.workflowId, this.processId, this.buildProcess()).subscribe({
      next: () => this.saveState.set('saved'),
      error: () => this.saveState.set('dirty'),
    });
  }
  validate() {
    this.api.validateProcess(this.buildProcess()).subscribe((r) => {
      this.problems.set(r.problems);
      this.toast[r.ok ? 'success' : 'error'](r.ok ? 'Process is valid' : `${r.errors.length} error(s) — see the problems panel`);
    });
  }

  // ---- run (starts an instance of this process) ----
  run() {
    this.saveNow();
    this.instanceApi.startInstance({ workflowId: this.workflowId, processId: this.processId, environment: 'prod' }).subscribe({
      next: (i) => this.toast.success(`Instance started: ${i.id}\nStatus: ${i.status}`),
      error: (e) => this.toast.error(`Cannot run: ${e?.error?.error?.message || 'deploy the project to prod first'}`),
    });
  }
}
