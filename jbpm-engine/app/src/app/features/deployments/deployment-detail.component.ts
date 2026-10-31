import { Component, computed, inject, signal, OnInit, HostListener } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SlicePipe, JsonPipe } from '@angular/common';
import { DeploymentApiService } from '../../core/api/deployment-api.service';
import { InstanceApiService } from '../../core/api/instance-api.service';
import { WorkflowApiService } from '../../core/api/workflow-api.service';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ToastService } from '../../shared/toast.service';
import { ModalService } from '../../shared/modal.service';
import type { Catalog, Deployment, DeploymentProcessDef, Workflow } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';

const NW = 180, NH = 56;
const COL_W = NW + 100, ROW_H = NH + 46;

type DeploymentTab = 'diagram' | 'definitions' | 'config';

@Component({
  selector: 'app-deployment-detail',
  standalone: true,
  imports: [IconComponent, SlicePipe, JsonPipe, RouterLink, FormsModule, BreadcrumbComponent],
  template: `
    <div class="page">
      <div class="crumbwrap">
        <app-breadcrumb [crumbs]="[
          { label: 'Deployments', link: ['/deployments'] },
          { label: deployment() ? projectName(deployment()!.workflowId) + ' (' + (deployment()!.versionLabel || ('v' + (deployment()!.versionNumber ?? '?'))) + ')' : 'Deployment' }
        ]" />
      </div>

      @if (loading()) {
        <div class="card pad">
          <div class="skeleton skeleton-line" style="width:40%"></div>
          <div class="skeleton skeleton-line" style="width:70%"></div>
          <div class="skeleton skeleton-card" style="height:380px; margin-top:20px;"></div>
        </div>
      } @else if (!deployment()) {
        <div class="card empty-state">
          <div class="es-icon"><app-icon name="warning" [size]="24" /></div>
          <h3>Deployment not found</h3>
          <p>The requested deployment could not be loaded or was deleted.</p>
          <a class="btn primary" [routerLink]="['/deployments']">Back to Deployments</a>
        </div>
      } @else {
        @let d = deployment()!;

        <!-- HEADER BANNER -->
        <header class="detail-head card">
          <div class="head-top">
            <div class="head-title-wrap">
              <a class="back-link" [routerLink]="['/deployments']" title="Back to Deployments">
                <app-icon name="arrowLeft" [size]="16" />
              </a>
              <div class="title-col">
                <div class="title-row">
                  <h1>{{ projectName(d.workflowId) }}</h1>
                  <span class="d-env-pill">{{ d.environment }}</span>
                  <span class="d-ver-pill">{{ d.versionLabel || ('v' + (d.versionNumber ?? '?')) }}</span>
                  <span class="badge" [class.active]="d.status==='active'" [class.inactive]="d.status==='inactive'" [class.archived]="d.status==='archived'">{{ d.status }}</span>
                  <span class="badge freeze" title="This deployment is an immutable snapshot freeze"><app-icon name="lock" [size]="11" /> Frozen Snapshot</span>
                </div>
                <div class="meta-row">
                  <span class="meta-item"><span class="lbl">ID:</span> <code class="mono">{{ d.id }}</code></span>
                  <span class="meta-item"><span class="lbl">Deployed:</span> {{ d.deployedAt | slice:0:19 }}</span>
                  <span class="meta-item"><span class="lbl">By:</span> {{ d.deployedBy }}</span>
                  @if (d.snapshot?.frozenAt) {
                    <span class="meta-item"><span class="lbl">Frozen:</span> {{ d.snapshot?.frozenAt | slice:0:19 }}</span>
                  }
                </div>
              </div>
            </div>

            <div class="head-actions">
              <button class="btn sm" (click)="downloadSnapshot(d)" title="Download complete self-contained deployment snapshot (.json)">
                <app-icon name="download" [size]="13" /> Download Snapshot
              </button>
              <button class="btn sm" (click)="confirmRestore(d)" title="Restore this deployment snapshot into the project as a new draft">
                <app-icon name="undo" [size]="13" /> Restore to Project
              </button>
              @if (d.status !== 'active') { <button class="btn sm primary" (click)="activate(d)">Activate</button> }
              @if (d.status === 'active') { <button class="btn sm" (click)="undeploy(d)">Undeploy</button> }
              @if (d.status !== 'archived') { <button class="btn sm danger" (click)="archive(d)">Archive</button> }
            </div>
          </div>

          <!-- TABS -->
          <div class="tab-strip">
            <button [class.active]="activeTab() === 'diagram'" (click)="activeTab.set('diagram')">
              <app-icon name="projects" [size]="13" /> Diagram Snapshot
            </button>
            <button [class.active]="activeTab() === 'definitions'" (click)="activeTab.set('definitions')">
              <app-icon name="list" [size]="13" /> Process Definitions ({{ defs().length }})
            </button>
            <button [class.active]="activeTab() === 'config'" (click)="activeTab.set('config')">
              <app-icon name="settings" [size]="13" /> Configuration & Rollback
            </button>
          </div>
        </header>

        <!-- TAB 1: READ-ONLY DIAGRAM SNAPSHOT WITH PROCESS SWITCHER -->
        @if (activeTab() === 'diagram') {
          <div class="card diagram-workspace">
            <!-- LEFT: Process switcher rail (Parent vs Child processes) -->
            <aside class="proc-rail">
              <div class="proc-rail-h">
                <span>Processes in Container</span>
                <span class="p-count">{{ processes().length }}</span>
              </div>

              @if (parentProcesses().length) {
                <div class="proc-group-label">Parent / Root Processes</div>
                @for (p of parentProcesses(); track p.id) {
                  <button class="proc-btn" [class.sel]="activeProcess()?.id === p.id" (click)="selectedProcessId.set(p.id); selectedNode.set(null)">
                    <span class="proc-ic-pill parent"><app-icon name="play" [size]="12" /></span>
                    <div class="proc-txt">
                      <span class="proc-name" [title]="p.name || p.id">{{ p.name || p.id }}</span>
                      <span class="proc-id mono">{{ p.id }}</span>
                    </div>
                    <span class="proc-nodes-badge" title="{{ (p.nodes || []).length }} nodes">{{ (p.nodes || []).length }}</span>
                  </button>
                }
              }

              @if (childProcesses().length) {
                <div class="proc-group-label">Child / Sub-processes</div>
                @for (p of childProcesses(); track p.id) {
                  <button class="proc-btn" [class.sel]="activeProcess()?.id === p.id" (click)="selectedProcessId.set(p.id); selectedNode.set(null)">
                    <span class="proc-ic-pill child"><app-icon name="cornerDownRight" [size]="12" /></span>
                    <div class="proc-txt">
                      <span class="proc-name" [title]="p.name || p.id">{{ p.name || p.id }}</span>
                      <span class="proc-id mono">{{ p.id }}</span>
                    </div>
                    <span class="proc-nodes-badge" title="{{ (p.nodes || []).length }} nodes">{{ (p.nodes || []).length }}</span>
                  </button>
                }
              }

              @if (processes().length === 0) {
                <div class="empty-processes">No processes in snapshot</div>
              }
            </aside>

            <!-- MAIN: Read-only BPMN Canvas -->
            <main class="canvas-viewport">
              <div class="canvas-topbar">
                <div class="active-proc-title">
                  <span class="lbl">Active Process:</span>
                  <b>{{ activeProcess()?.name || activeProcess()?.id || '—' }}</b>
                  <code class="mono muted">({{ activeProcess()?.id }})</code>
                </div>
                <div class="proc-stats-pill">
                  <span>{{ (activeProcess()?.nodes || []).length }} nodes</span>
                  <span>·</span>
                  <span>{{ (activeProcess()?.flows || []).length }} flows</span>
                </div>
              </div>

              <div class="dwrap" (click)="selectedNode.set(null)">
                <div class="zoomlayer" [style.zoom]="zoom()" [style.height.px]="dh()" [style.width.px]="dw()">
                  <svg class="edges" [attr.width]="dw()" [attr.height]="dh()" [style.width.px]="dw()" [style.height.px]="dh()">
                    <defs>
                      <marker id="ar-snap" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                        <path d="M0,0 L10,5 L0,10 z" fill="var(--border-strong)"/>
                      </marker>
                    </defs>
                    @for (e of laidEdges(); track e.id || $index) {
                      <path [attr.d]="edge(e)" class="ge" marker-end="url(#ar-snap)" />
                    }
                  </svg>

                  @for (n of laidNodes(); track n.id) {
                    <div class="node" [attr.id]="'node-' + n.id"
                         [class.node-circle]="isCircle(n.type)"
                         [class.node-diamond]="isDiamond(n.type)"
                         [class.node-rectangle]="isRectangle(n.type)"
                         [class.node-call]="n.type === 'call'"
                         [class.node-start]="n.type === 'start'"
                         [class.node-end]="n.type === 'end'"
                         [class.sel]="selectedNode()?.id === n.id"
                         [style.left.px]="n.x" [style.top.px]="n.y"
                         [style.width.px]="nodeDims(n.type).w" [style.height.px]="nodeDims(n.type).h"
                         [title]="n.name || n.id"
                         (click)="$event.stopPropagation(); selectedNode.set(n)">

                      @if (isCircle(n.type)) {
                        <div class="circle-inner" [style.background]="n.type==='start' ? '#f0fdf4' : n.type==='end' ? '#fef2f2' : '#f5f3ff'">
                          <app-icon [name]="visual(n.type).icon" [size]="16" [style.color]="visual(n.type).color" />
                        </div>
                        <div class="ntitle circle-label">{{ n.name || n.id }}</div>
                      } @else if (isDiamond(n.type)) {
                        <div class="diamond-body">
                          <span class="diamond-marker">{{ gatewayMarker(n) }}</span>
                        </div>
                        <div class="ntitle diamond-label">{{ n.name || n.id }}</div>
                      } @else {
                        <span class="chip" [style.background]="visual(n.type).color"><app-icon [name]="visual(n.type).icon" [size]="13" /></span>
                        <div class="ntitle">{{ n.name || n.id }}</div>
                        @if (n.type === 'call') { <span class="call-badge" title="Call Activity / Sub-process">[+]</span> }
                      }
                    </div>
                  }

                  @for (b of numberedBranches(); track b.edge.id || $index) {
                    <div class="branchbadge" [style.left.px]="b.x" [style.top.px]="b.y" [title]="'Branch ' + b.text">{{ b.text }}</div>
                  }
                  @for (b of labeledBranches(); track b.edge.id || $index) {
                    <div class="branchpill" [style.left.px]="b.x" [style.top.px]="b.y" [title]="b.text">{{ b.text }}</div>
                  }

                  <!-- CONTEXTUAL NODE INSPECTOR POPOVER ANCHORED AT CLICKED NODE -->
                  @if (selectedNode(); as sn) {
                    @if (popoverPos(); as pos) {
                      <div class="node-inspector-popover"
                           [style.left.px]="pos.x"
                           [style.top.px]="pos.y"
                           [class.pos-above]="pos.placement === 'above'"
                           [class.pos-below]="pos.placement === 'below'"
                           (click)="$event.stopPropagation()">
                        <div class="popover-arrow" [style.left.px]="pos.arrowLeft"></div>
                        <div class="ni-header">
                          <span class="ni-title">
                            <span class="ni-chip" [style.background]="visual(sn.type).color"><app-icon [name]="visual(sn.type).icon" [size]="12" /></span>
                            <b>{{ sn.name || sn.id }}</b>
                          </span>
                          <button class="ni-close" (click)="selectedNode.set(null)" aria-label="Close">×</button>
                        </div>
                        <div class="ni-body">
                          <div class="ni-row"><span class="k">Type:</span> <span class="v mono">{{ sn.type }}</span></div>
                          <div class="ni-row"><span class="k">Node ID:</span> <span class="v mono">{{ sn.id }}</span></div>
                          @if (sn.type === 'call') {
                            <div class="ni-call-box">
                              <div class="ni-call-label">Sub-process Reference:</div>
                              <div class="ni-call-target mono">{{ sn.calledProcessId || sn.processId || sn.calledElement || '—' }}</div>
                              @if (findProcess(sn.calledProcessId || sn.processId || sn.calledElement); as cp) {
                                <button class="btn sm primary ni-jump" (click)="selectedProcessId.set(cp.id); selectedNode.set(null)">
                                  <app-icon name="cornerDownRight" [size]="12" /> Switch to Sub-process
                                </button>
                              }
                            </div>
                          }
                          @if (sn.ruleflowGroup) {
                            <div class="ni-row"><span class="k">Ruleflow Group:</span> <span class="v mono">{{ sn.ruleflowGroup }}</span></div>
                          }
                          @if (sn.dmn) {
                            <div class="ni-row"><span class="k">DMN Model:</span> <span class="v mono">{{ sn.dmn.model || sn.dmn }}</span></div>
                          }
                          @if (sn.guidedTable) {
                            <div class="ni-row"><span class="k">Guided Table:</span> <span class="v mono">{{ sn.guidedTable }}</span></div>
                          }
                          @if (sn.scorecard) {
                            <div class="ni-row"><span class="k">Scorecard:</span> <span class="v mono">{{ sn.scorecard }}</span></div>
                          }
                          @if (sn.decisionTree) {
                            <div class="ni-row"><span class="k">Decision Tree:</span> <span class="v mono">{{ sn.decisionTree }}</span></div>
                          }
                          @if (sn.form) {
                            <div class="ni-row"><span class="k">Form:</span> <span class="v mono">{{ sn.form }}</span></div>
                          }
                          @if (sn.group) {
                            <div class="ni-row"><span class="k">User Group:</span> <span class="v mono">{{ sn.group }}</span></div>
                          }
                          @if (sn.handler) {
                            <div class="ni-row"><span class="k">Work Handler:</span> <span class="v mono">{{ sn.handler }}</span></div>
                          }
                          @if (sn.code) {
                            <div class="ni-code-block"><label>Script ({{ sn.lang || 'js' }}):</label><pre class="mono sm">{{ sn.code }}</pre></div>
                          }
                        </div>
                      </div>
                    }
                  }
                </div>

                <div class="zoomctrl">
                  <button (click)="zoomOut()" title="Zoom out" aria-label="Zoom out">−</button>
                  <span class="zpct" (click)="zoomReset()" title="Reset zoom">{{ zoomPct() }}%</span>
                  <button (click)="zoomIn()" title="Zoom in" aria-label="Zoom in">+</button>
                  <button (click)="zoomReset()" title="Fit view">⤢</button>
                </div>
              </div>
            </main>
          </div>
        }

        <!-- TAB 2: PROCESS DEFINITIONS & START INSTANCE -->
        @if (activeTab() === 'definitions') {
          <div class="card tabbody">
            <h3 class="sec-h">Process definitions in this container</h3>
            @if (defsLoading()) {
              <div class="skeleton skeleton-line" style="width:100%"></div>
            } @else if (defs().length === 0) {
              <p class="muted pad">No process definitions found in this deployment.</p>
            } @else {
              <table>
                <thead><tr><th>Id</th><th>Name</th><th>Nodes</th><th></th></tr></thead>
                <tbody>
                  @for (pd of defs(); track pd.id) {
                    <tr>
                      <td class="mono">{{ pd.id }}</td><td>{{ pd.name }}</td><td class="muted">{{ pd.nodes }}</td>
                      <td class="ta-r">
                        @if (pd.startable && d.status === 'active') {
                          <button class="btn sm primary" (click)="startInstance(d, pd)" title="Start a new instance of this process">
                            <app-icon name="play" [size]="12" /> Start
                          </button>
                        } @else {
                          <span class="muted sm">{{ pd.startable ? 'deployment inactive' : 'not startable' }}</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
        }

        <!-- TAB 3: CONFIGURATION & ROLLBACK -->
        @if (activeTab() === 'config') {
          <div class="card tabbody">
            <table class="kv"><tbody>
              <tr><td class="k">Deployed</td><td class="mono">{{ d.deployedAt | slice:0:19 }} by {{ d.deployedBy }}</td></tr>
              <tr><td class="k">Tags</td><td>@for (t of d.tags; track t) { <span class="badge">{{ t }}</span> } @if (!d.tags.length) { <span class="muted">—</span> }</td></tr>
              <tr><td class="k">Environment Variables</td><td><pre class="mono sm">{{ d.env ? (d.env | json) : 'None' }}</pre></td></tr>
              @if (d.snapshot) {
                <tr><td class="k">Snapshot Status</td><td><span class="badge active">Frozen at {{ d.snapshot.frozenAt | slice:0:19 }}</span></td></tr>
              }
            </tbody></table>

            <h3 class="sec-h">Rollback</h3>
            @if (rollbackTargets().length === 0) {
              <p class="muted">No other deployment in "{{ d.environment }}" to roll back to.</p>
            } @else {
              <div class="row" style="gap:10px;">
                <select #rb style="max-width:320px;">
                  @for (t of rollbackTargets(); track t.id) { <option [value]="t.id">{{ t.versionLabel || ('v' + (t.versionNumber ?? '?')) }} · {{ t.deployedAt | slice:0:10 }}</option> }
                </select>
                <button class="btn" (click)="rollback(d, rb.value)">Rollback to selected</button>
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px; max-width: 1600px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
    .crumbwrap { margin-bottom: 2px; }

    /* HEADER BANNER */
    .detail-head {
      padding: 20px 24px 0 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .head-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 20px;
      flex-wrap: wrap;
    }
    .head-title-wrap {
      display: flex;
      align-items: flex-start;
      gap: 16px;
    }
    .back-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      transition: all .15s;
      margin-top: 2px;
    }
    .back-link:hover {
      background: var(--surface-hover);
      border-color: var(--border-strong);
    }
    .title-col {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .title-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .title-row h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -.02em;
    }
    .d-env-pill {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .06em;
      padding: 3px 10px;
      border-radius: 999px;
      background: rgba(91, 61, 245, 0.1);
      color: var(--primary);
    }
    .d-ver-pill {
      font-size: 11.5px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 6px;
      background: var(--border);
      color: var(--text-secondary);
    }
    .badge.freeze {
      background: #eff6ff;
      color: #2563eb;
      border: 1px solid #bfdbfe;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-weight: 600;
    }
    .meta-row {
      display: flex;
      align-items: center;
      gap: 18px;
      font-size: 12.5px;
      color: var(--muted);
      flex-wrap: wrap;
    }
    .meta-item .lbl {
      color: var(--text-secondary);
      font-weight: 500;
      margin-right: 4px;
    }
    .head-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    /* TABS */
    .tab-strip {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid var(--border);
      margin-top: 4px;
    }
    .tab-strip button {
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      padding: 10px 16px;
      font-size: 13.5px;
      font-weight: 600;
      color: var(--muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all .15s;
    }
    .tab-strip button:hover {
      color: var(--text);
    }
    .tab-strip button.active {
      color: var(--primary);
      border-bottom-color: var(--primary);
    }

    /* DIAGRAM WORKSPACE */
    .diagram-workspace {
      display: flex;
      height: calc(100vh - 220px);
      min-height: 600px;
      padding: 0;
      overflow: hidden;
    }

    /* PROCESS SWITCHER RAIL */
    .proc-rail {
      width: 280px;
      flex-shrink: 0;
      border-right: 1px solid var(--border);
      background: var(--surface-soft, rgba(0,0,0,0.01));
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 14px 12px;
      gap: 6px;
    }
    .proc-rail-h {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 6px 10px 6px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .06em;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
      margin-bottom: 6px;
    }
    .p-count {
      font-size: 11px;
      background: var(--border);
      padding: 1px 6px;
      border-radius: 999px;
      color: var(--text-secondary);
    }
    .proc-group-label {
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .05em;
      color: var(--muted);
      padding: 8px 6px 4px 6px;
    }
    .proc-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      border: 1px solid transparent;
      background: transparent;
      text-align: left;
      cursor: pointer;
      transition: all .12s;
    }
    .proc-btn:hover {
      background: var(--surface);
      border-color: var(--border);
    }
    .proc-btn.sel {
      background: var(--surface);
      border-color: var(--primary);
      box-shadow: 0 1px 3px rgba(91,61,245,.1);
    }
    .proc-ic-pill {
      width: 26px;
      height: 26px;
      border-radius: 7px;
      display: grid;
      place-items: center;
      flex-shrink: 0;
    }
    .proc-ic-pill.parent {
      background: #eff6ff;
      color: #2563eb;
    }
    .proc-ic-pill.child {
      background: #faf5ff;
      color: #9333ea;
    }
    .proc-txt {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .proc-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .proc-id {
      font-size: 10.5px;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .proc-nodes-badge {
      font-size: 10.5px;
      background: var(--border);
      color: var(--muted);
      padding: 2px 6px;
      border-radius: 999px;
      font-weight: 600;
    }
    .empty-processes {
      padding: 24px 12px;
      text-align: center;
      color: var(--muted);
      font-size: 12.5px;
    }

    /* CANVAS VIEWPORT */
    .canvas-viewport {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      position: relative;
      background: var(--canvas-bg, #fcfcfd);
    }
    .canvas-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 18px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      font-size: 13px;
    }
    .active-proc-title {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .active-proc-title .lbl { color: var(--muted); font-size: 12px; }
    .proc-stats-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
    }
    .dwrap {
      flex: 1;
      position: relative;
      overflow: auto;
      background-image: radial-gradient(circle, var(--border) 1px, transparent 1px);
      background-size: 20px 20px;
    }
    .zoomlayer {
      position: relative;
      transform-origin: 0 0;
    }
    .edges {
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
    }
    .ge {
      fill: none;
      stroke: var(--border-strong);
      stroke-width: 1.8;
      stroke-linejoin: round;
      stroke-linecap: round;
    }

    /* BPMN 2.0 SHAPES */
    .node {
      position: absolute;
      background: var(--surface);
      border: 1.5px solid var(--border-strong);
      border-radius: 10px;
      box-shadow: var(--shadow-card);
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 12px;
      cursor: pointer;
      user-select: none;
      transition: border-color .15s, box-shadow .15s;
      z-index: 2;
    }
    .node:hover {
      border-color: var(--primary);
      box-shadow: var(--shadow-pop);
    }
    .node.sel {
      border-color: var(--primary) !important;
      box-shadow: 0 0 0 3px rgba(91,61,245,.2), var(--shadow-pop);
    }
    .node.node-call {
      border-width: 2px;
    }
    .call-badge {
      font-size: 10.5px;
      font-weight: 800;
      color: #9333ea;
      margin-left: auto;
      padding: 1px 4px;
      background: #faf5ff;
      border-radius: 4px;
    }

    /* CIRCLE */
    .node.node-circle {
      border-radius: 50%;
      padding: 0;
      display: grid;
      place-items: center;
      box-shadow: var(--shadow-card);
    }
    .node.node-start {
      border: 2.5px solid #16a34a;
    }
    .node.node-end {
      border: 3.5px solid #dc2626;
    }
    .circle-inner {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      display: grid;
      place-items: center;
    }
    .circle-label {
      position: absolute;
      top: 48px;
      left: 50%;
      transform: translateX(-50%);
      width: 130px;
      text-align: center;
      white-space: normal;
      line-height: 1.2;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--text-secondary);
      pointer-events: none;
    }

    /* GATEWAY DIAMOND */
    .node.node-diamond {
      background: transparent;
      border: none;
      box-shadow: none;
    }
    .diamond-body {
      width: 52px;
      height: 52px;
      transform: rotate(45deg);
      border-radius: 9px;
      border: 2px solid #d97706;
      background: var(--surface);
      box-shadow: var(--shadow-card);
      display: grid;
      place-items: center;
      transition: border-color .12s, box-shadow .12s;
    }
    .node.node-diamond:hover .diamond-body {
      box-shadow: var(--shadow-pop);
    }
    .node.node-diamond.sel .diamond-body {
      border-color: var(--primary) !important;
      box-shadow: 0 0 0 3px rgba(91,61,245,.2), var(--shadow-card);
    }
    .diamond-marker {
      transform: rotate(-45deg);
      font-size: 16px;
      font-weight: 900;
      color: #b45309;
      line-height: 1;
    }
    .diamond-label {
      position: absolute;
      top: 58px;
      left: 50%;
      transform: translateX(-50%);
      width: 130px;
      text-align: center;
      white-space: normal;
      line-height: 1.2;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--text-secondary);
      pointer-events: none;
    }

    /* BRANCH LABELS & BADGES */
    .branchbadge {
      position: absolute;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--text);
      color: var(--surface);
      font-size: 11px;
      font-weight: 700;
      display: grid;
      place-items: center;
      box-shadow: var(--shadow-card);
      z-index: 3;
    }
    .branchpill {
      position: absolute;
      transform: translate(-6px, -30px);
      background: var(--surface);
      border: 1px solid var(--border-strong);
      border-radius: 999px;
      padding: 3px 12px;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--text);
      box-shadow: var(--shadow-card);
      z-index: 3;
      white-space: nowrap;
    }

    .chip {
      width: 28px;
      height: 28px;
      border-radius: 7px;
      display: grid;
      place-items: center;
      color: #fff;
      flex-shrink: 0;
    }
    .ntitle {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }

    /* ZOOM CONTROLS */
    .zoomctrl {
      position: absolute;
      bottom: 20px;
      right: 20px;
      display: flex;
      align-items: center;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow-card);
      z-index: 10;
      overflow: hidden;
    }
    .zoomctrl button {
      background: transparent;
      border: none;
      padding: 8px 12px;
      font-size: 15px;
      color: var(--text);
      cursor: pointer;
    }
    .zoomctrl button:hover { background: var(--surface-hover); }
    .zpct {
      font-size: 12px;
      font-weight: 600;
      padding: 0 6px;
      cursor: pointer;
      user-select: none;
    }

    /* CONTEXTUAL NODE INSPECTOR POPOVER (ANCHORED TO CLICKED NODE) */
    .node-inspector-popover {
      position: absolute;
      width: 320px;
      max-height: 420px;
      border-radius: var(--radius-md);
      border: 1px solid var(--border-strong);
      background: rgba(255, 255, 255, 0.98);
      backdrop-filter: blur(16px);
      box-shadow: 0 12px 36px -6px rgba(0, 0, 0, 0.22), 0 4px 12px -2px rgba(0, 0, 0, 0.1);
      z-index: 100;
      display: flex;
      flex-direction: column;
      animation: popoverFadeIn .14s cubic-bezier(0.16, 1, 0.3, 1);
    }
    :host-context([data-theme='dark']) .node-inspector-popover {
      background: rgba(24, 24, 28, 0.98);
      border-color: var(--border-strong);
    }
    @keyframes popoverFadeIn {
      from { opacity: 0; transform: translateY(-4px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .popover-arrow {
      position: absolute;
      width: 14px;
      height: 14px;
      background: var(--surface);
      border: 1px solid var(--border-strong);
      transform: translateX(-50%) rotate(45deg);
      z-index: 101;
    }
    .pos-below .popover-arrow {
      top: -7px;
      border-bottom: none;
      border-right: none;
    }
    .pos-above .popover-arrow {
      bottom: -7px;
      border-top: none;
      border-left: none;
    }
    .ni-header {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .ni-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13.5px;
      font-weight: 600;
      min-width: 0;
    }
    .ni-title b {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ni-chip {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      display: grid;
      place-items: center;
      color: #fff;
      flex-shrink: 0;
    }
    .ni-close {
      background: transparent;
      border: none;
      font-size: 18px;
      line-height: 1;
      color: var(--muted);
      cursor: pointer;
    }
    .ni-body {
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      overflow-y: auto;
      font-size: 12.5px;
    }
    .ni-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
    }
    .ni-row .k { color: var(--muted); }
    .ni-call-box {
      background: #faf5ff;
      border: 1px solid #e9d5ff;
      border-radius: var(--radius-sm);
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    :host-context([data-theme='dark']) .ni-call-box {
      background: rgba(147, 51, 234, 0.1);
      border-color: rgba(147, 51, 234, 0.3);
    }
    .ni-call-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .05em;
      color: #9333ea;
    }
    .ni-call-target { font-weight: 600; }
    .ni-jump {
      margin-top: 4px;
      justify-content: center;
    }
    .ni-code-block pre {
      margin: 4px 0 0 0;
      padding: 8px;
      background: var(--surface-soft);
      border-radius: var(--radius-sm);
      overflow-x: auto;
    }

    /* TAB 2 & 3 BODIES */
    .tabbody {
      padding: 24px;
    }
    .sec-h {
      font-size: 14px;
      font-weight: 700;
      margin: 0 0 14px 0;
    }
    .ta-r { text-align: right; }
    .kv { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    .kv td { padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 13px; }
    .kv td.k { width: 220px; color: var(--muted); font-weight: 500; }
    pre { margin: 0; font-family: monospace; }
  `],
})
export class DeploymentDetailComponent implements OnInit {
  private api = inject(DeploymentApiService);
  private wfApi = inject(WorkflowApiService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private instApi = inject(InstanceApiService);
  private router = inject(Router);
  private modal = inject(ModalService);

  deploymentId = signal<string>(this.route.snapshot.paramMap.get('id') || '');
  deployment = signal<Deployment | null>(null);
  allDeployments = signal<Deployment[]>([]);
  workflows = signal<Workflow[]>([]);
  catalog = signal<Catalog | null>(null);
  loading = signal(true);
  defs = signal<DeploymentProcessDef[]>([]);
  defsLoading = signal(false);

  activeTab = signal<DeploymentTab>('diagram');
  selectedProcessId = signal<string | null>(null);
  selectedNode = signal<any | null>(null);
  zoom = signal(1);
  zoomPct = computed(() => Math.round(this.zoom() * 100));

  @HostListener('document:keydown.escape')
  onEscape() {
    this.selectedNode.set(null);
  }

  popoverPos = computed(() => {
    const sn = this.selectedNode();
    if (!sn) return null;
    const dims = this.nodeDims(sn.type);
    const popW = 320;
    const popH = 260;

    // Center horizontally over the node
    const nodeCenterX = sn.x + (dims.w / 2);
    let x = nodeCenterX - (popW / 2);

    // Clamp X so the popover remains within canvas boundaries
    const minX = 16;
    const maxX = Math.max(minX, this.dw() - popW - 16);
    x = Math.max(minX, Math.min(maxX, x));

    // Calculate arrow position relative to the popover's left edge
    const arrowLeft = Math.max(24, Math.min(popW - 24, nodeCenterX - x));

    // Vertical placement: default below the node
    const isCircleOrDiamond = this.isCircle(sn.type) || this.isDiamond(sn.type);
    const labelExtra = isCircleOrDiamond ? 44 : 12;
    const belowY = sn.y + dims.h + labelExtra;

    let y = belowY;
    let placement: 'above' | 'below' = 'below';

    // If placing below exceeds the canvas height and there is room above, place above
    if (belowY + popH > this.dh() && sn.y > popH + 20) {
      y = Math.max(16, sn.y - popH - 14);
      placement = 'above';
    }

    return { x, y, placement, arrowLeft };
  });

  private wfNames = computed(() => new Map(this.workflows().map((w) => [w.id, w.name])));
  projectName(id: string) { return this.wfNames().get(id) || id; }

  rollbackTargets = computed(() => {
    const d = this.deployment();
    if (!d) return [];
    return this.allDeployments().filter((x) => x.environment === d.environment && x.workflowId === d.workflowId && x.id !== d.id);
  });

  // All processes in this deployment container
  processes = computed(() => {
    const d = this.deployment();
    return (d?.engine?.processes || []) as any[];
  });

  // Set of process IDs called as sub-processes
  calledProcessIds = computed(() => {
    const called = new Set<string>();
    for (const p of this.processes()) {
      for (const n of p.nodes || []) {
        if (n.type === 'call') {
          const target = n['calledProcessId'] || n['processId'] || n['process'] || n['calledElement'];
          if (target) called.add(target);
        }
      }
    }
    return called;
  });

  // Parent / Root processes
  parentProcesses = computed(() => {
    const called = this.calledProcessIds();
    const ps = this.processes();
    const roots = ps.filter((p) => !called.has(p.id));
    return roots.length ? roots : ps.slice(0, 1);
  });

  // Child / Sub-processes
  childProcesses = computed(() => {
    const called = this.calledProcessIds();
    return this.processes().filter((p) => called.has(p.id));
  });

  // The active process to display on the canvas
  activeProcess = computed(() => {
    const pid = this.selectedProcessId();
    const ps = this.processes();
    if (pid) {
      const match = ps.find((p) => p.id === pid);
      if (match) return match;
    }
    return this.parentProcesses()[0] || ps[0] || null;
  });

  findProcess(id?: string) {
    if (!id) return null;
    return this.processes().find((p) => p.id === id) || null;
  }

  // Laid out nodes for the active process
  laidNodes = computed(() => {
    const proc = this.activeProcess();
    if (!proc) return [];
    const auto = this.computeLayeredPositions(proc.nodes || [], proc.flows || []);
    return (proc.nodes || []).map((n: any) => {
      const p = auto.get(n.id);
      return { ...n, x: n.x ?? p?.x ?? 40, y: n.y ?? p?.y ?? 40 };
    });
  });

  laidEdges = computed(() => {
    return this.activeProcess()?.flows || [];
  });

  private byId(id: string) { return this.laidNodes().find((n: any) => n.id === id); }

  dw = computed(() => {
    let maxX = 800;
    for (const n of this.laidNodes()) {
      const d = this.nodeDims(n.type);
      const right = n.x + d.w + 60;
      if (right > maxX) maxX = right;
    }
    return maxX + 80;
  });

  dh = computed(() => {
    let maxY = 400;
    for (const n of this.laidNodes()) {
      const d = this.nodeDims(n.type);
      const extra = this.isCircle(n.type) || this.isDiamond(n.type) ? 55 : 0;
      const bottom = n.y + d.h + extra + 40;
      if (bottom > maxY) maxY = bottom;
    }
    return maxY + 50;
  });

  labeledBranches = computed(() => {
    const out: { edge: any; x: number; y: number; text: string }[] = [];
    const flows = this.laidEdges();
    for (const e of flows) {
      if (!e.label && !e.when) continue;
      const text = e.label || e.when;
      const b = this.byId(e.to); if (!b) continue;
      out.push({ edge: e, x: b.x, y: b.y - 28, text });
    }
    return out;
  });

  numberedBranches = computed(() => {
    const out: { edge: any; x: number; y: number; text: string }[] = [];
    const flows = this.laidEdges();
    for (const e of flows) {
      if (e.label || e.when) continue;
      const siblings = flows.filter((x: any) => x.from === e.from);
      if (siblings.length <= 1) continue;
      const b = this.byId(e.to); if (!b) continue;
      out.push({ edge: e, x: b.x - 26, y: b.y + this.nodeDims(b.type).h / 2 - 11, text: String(siblings.indexOf(e) + 1) });
    }
    return out;
  });

  ngOnInit() {
    this.wfApi.listWorkflows().subscribe((ws) => this.workflows.set(ws));
    this.wfApi.catalog().subscribe((c) => this.catalog.set(c));
    this.loadDeployment();
  }

  loadDeployment() {
    const id = this.deploymentId();
    if (!id) return;
    this.loading.set(true);
    this.api.getDeployment(id).subscribe({
      next: (d) => {
        this.deployment.set(d);
        this.loading.set(false);
        this.api.definitions(d.id).subscribe((defs) => this.defs.set(defs));
        this.api.listDeploymentsGlobal({ workflowId: d.workflowId }).subscribe((all) => this.allDeployments.set(all));
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Failed to load deployment');
      },
    });
  }

  downloadSnapshot(d: Deployment) {
    this.api.exportSnapshot(d.id).subscribe({
      next: (pkg) => {
        const json = JSON.stringify(pkg, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const env = d.environment.toLowerCase();
        const ver = d.versionLabel || ('v' + (d.versionNumber ?? '1'));
        a.href = url;
        a.download = `deployment-snapshot-${d.id}-${env}-${ver}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.toast.success(`Deployment snapshot exported (${(blob.size / 1024).toFixed(1)} KB)`);
      },
      error: (e) => this.toast.error('Failed to export snapshot: ' + (e?.error?.message || e.message)),
    });
  }

  confirmRestore(d: Deployment) {
    const projName = this.projectName(d.workflowId);
    const ver = d.versionLabel || ('v' + (d.versionNumber ?? '?'));
    const confirmed = confirm(
      `Restore Deployment to Project?\n\n` +
      `This will restore the complete frozen snapshot of deployment "${d.id}" (${projName} ${ver}) into your project as a fresh working draft.\n\n` +
      `Are you sure you want to proceed?`
    );
    if (!confirmed) return;

    this.api.restoreToProject(d.id).subscribe({
      next: (res) => {
        this.toast.success(`Restored deployment snapshot into project "${projName}"!`);
        this.router.navigate(['/projects', res.workflowId, 'processes']);
      },
      error: (e) => this.toast.error('Failed to restore snapshot: ' + (e?.error?.message || e.message)),
    });
  }

  activate(d: Deployment) {
    this.api.activate(d.id).subscribe({
      next: () => { this.toast.success('Activated deployment'); this.loadDeployment(); },
      error: (e) => this.toast.error(e?.error?.message || 'Activation failed'),
    });
  }

  undeploy(d: Deployment) {
    this.api.undeploy(d.id).subscribe({
      next: () => { this.toast.info('Undeployed'); this.loadDeployment(); },
      error: (e) => this.toast.error(e?.error?.message || 'Undeploy failed'),
    });
  }

  archive(d: Deployment) {
    this.api.archive(d.id).subscribe({
      next: () => { this.toast.info('Archived deployment'); this.loadDeployment(); },
      error: (e) => this.toast.error(e?.error?.message || 'Archive failed'),
    });
  }

  rollback(d: Deployment, toId: string) {
    if (!toId) return;
    this.api.rollback(d.id, { environment: d.environment, toDeploymentId: toId }).subscribe({
      next: () => { this.toast.success('Rolled back'); this.loadDeployment(); },
      error: (e) => this.toast.error(e?.error?.message || 'Rollback failed'),
    });
  }

  startInstance(d: Deployment, pd: DeploymentProcessDef) {
    this.instApi.startInstance({ workflowId: d.workflowId, processId: pd.id, deploymentId: d.id }).subscribe({
      next: (inst: any) => {
        this.toast.success(`Instance ${inst.id.slice(-6)} started`);
        this.router.navigate(['/instances', inst.id]);
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to start instance'),
    });
  }

  // --- Zoom Controls ---
  zoomIn() { this.zoom.update((z) => Math.min(2, +(z + 0.15).toFixed(2))); }
  zoomOut() { this.zoom.update((z) => Math.max(0.4, +(z - 0.15).toFixed(2))); }
  zoomReset() { this.zoom.set(1); }

  // --- BPMN Visual helpers ---
  isCircle(t: string): boolean {
    return t === 'start' || t === 'end' || t === 'intermediateCatch' || t === 'boundary';
  }

  isDiamond(t: string): boolean {
    return t === 'gateway' || t === 'inclusiveGateway' || t === 'parallelGateway' || t === 'eventGateway';
  }

  isRectangle(t: string): boolean {
    return !this.isCircle(t) && !this.isDiamond(t);
  }

  nodeDims(t: string): { w: number; h: number } {
    if (this.isCircle(t)) return { w: 44, h: 44 };
    if (this.isDiamond(t)) return { w: 52, h: 52 };
    return { w: NW, h: NH };
  }

  visual(type: string): { icon: string; color: string } {
    const d = (this.catalog()?.nodes as any[])?.find((x: any) => x.type === type)?.diagram;
    if (d) return { icon: d.icon || 'nodes', color: d.color || '#64748b' };
    const fallback: Record<string, { icon: string; color: string }> = {
      start: { icon: 'play', color: '#16a34a' },
      end: { icon: 'check', color: '#dc2626' },
      gateway: { icon: 'gitBranch', color: '#d97706' },
      inclusiveGateway: { icon: 'gitBranch', color: '#d97706' },
      parallelGateway: { icon: 'gitBranch', color: '#d97706' },
      userTask: { icon: 'user', color: '#2563eb' },
      serviceTask: { icon: 'zap', color: '#0891b2' },
      scriptTask: { icon: 'terminal', color: '#7c3aed' },
      businessRuleTask: { icon: 'table', color: '#9333ea' },
      call: { icon: 'cornerDownRight', color: '#7c3aed' },
    };
    return fallback[type] || { icon: 'zap', color: '#64748b' };
  }

  gatewayMarker(n: any): string {
    const t = n.gatewayType || n.type;
    if (t === 'parallelGateway' || t === 'parallel') return '+';
    if (t === 'inclusiveGateway' || t === 'inclusive') return '○';
    if (t === 'eventGateway') return '⬠';
    return '✕';
  }

  edge(f: any): string {
    const from = this.byId(f.from);
    const to = this.byId(f.to);
    if (!from || !to) return '';
    const fromDims = this.nodeDims(from.type);
    const toDims = this.nodeDims(to.type);

    const x1 = from.x + fromDims.w;
    const y1 = from.y + fromDims.h / 2;
    const x2 = to.x;
    const y2 = to.y + toDims.h / 2;

    if (Math.abs(y1 - y2) < 3) return `M ${x1} ${y1} L ${x2} ${y2}`;
    const mx = x1 + Math.max(28, (x2 - x1) / 2);
    return `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`;
  }

  private computeLayeredPositions(nodes: any[], flows: any[]): Map<string, { x: number; y: number }> {
    const pos = new Map<string, { x: number; y: number }>();
    if (!nodes.length) return pos;

    const inDeg = new Map<string, number>();
    const succ = new Map<string, string[]>();
    for (const n of nodes) { inDeg.set(n.id, 0); succ.set(n.id, []); }
    for (const f of flows) {
      if (inDeg.has(f.to)) inDeg.set(f.to, (inDeg.get(f.to) || 0) + 1);
      if (succ.has(f.from)) succ.get(f.from)!.push(f.to);
    }

    const rank = new Map<string, number>();
    let q: string[] = nodes.filter((n) => (inDeg.get(n.id) || 0) === 0).map((n) => n.id);
    if (!q.length && nodes[0]) q = [nodes[0].id];
    for (const id of q) rank.set(id, 0);

    const visited = new Set<string>();
    while (q.length) {
      const cur = q.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const r = rank.get(cur) || 0;
      for (const nxt of succ.get(cur) || []) {
        rank.set(nxt, Math.max(rank.get(nxt) || 0, r + 1));
        q.push(nxt);
      }
    }

    for (const n of nodes) if (!rank.has(n.id)) rank.set(n.id, 0);

    const byRank = new Map<number, string[]>();
    for (const [id, r] of rank.entries()) {
      if (!byRank.has(r)) byRank.set(r, []);
      byRank.get(r)!.push(id);
    }

    const MARGIN_LEFT = 60, MARGIN_TOP = 80;
    const sortedRanks = [...byRank.keys()].sort((a, b) => a - b);
    for (const r of sortedRanks) {
      const ids = byRank.get(r)!;
      ids.forEach((id, rowIdx) => {
        const node = nodes.find((n) => n.id === id);
        const dims = this.nodeDims(node?.type || '');
        const alignOffset = (NH - dims.h) / 2;
        pos.set(id, {
          x: MARGIN_LEFT + r * COL_W,
          y: MARGIN_TOP + rowIdx * ROW_H + alignOffset,
        });
      });
    }
    return pos;
  }
}
