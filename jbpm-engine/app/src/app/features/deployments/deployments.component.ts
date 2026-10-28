import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SlicePipe, JsonPipe } from '@angular/common';
import { DeploymentApiService } from '../../core/api/deployment-api.service';
import { InstanceApiService } from '../../core/api/instance-api.service';
import { WorkflowApiService } from '../../core/api/workflow-api.service';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ToastService } from '../../shared/toast.service';
import type { Catalog, Deployment, DeploymentProcessDef, Workflow } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';

const NW = 180, NH = 56;
const COL_W = NW + 100, ROW_H = NH + 46;

type DeploymentTab = 'diagram' | 'definitions' | 'config';

@Component({
  selector: 'app-deployments',
  standalone: true,
  imports: [IconComponent, SlicePipe, JsonPipe, RouterLink, FormsModule, BreadcrumbComponent],
  template: `
    <div class="page">
      <div class="crumbwrap"><app-breadcrumb [crumbs]="[{ label: 'Deployments' }]" /></div>
      <header class="pagehead">
        <h1>Deployments</h1>
        <span class="spacer"></span>
        <select class="proj-filter" [ngModel]="projectFilter()" (ngModelChange)="setProjectFilter($event)">
          <option value="">All projects</option>
          @for (w of workflows(); track w.id) { <option [value]="w.id">{{ w.name }}</option> }
        </select>
        <button class="btn" (click)="openImportModal()"><app-icon name="upload" [size]="14" /> Import Deployment</button>
        <button class="btn" (click)="reload()"><app-icon name="refresh" [size]="14" /> Refresh</button>
      </header>

      @if (loading()) {
        <div class="split">
          <div class="card"><div class="skeleton skeleton-line" style="width:60%"></div><div class="skeleton skeleton-line" style="width:80%"></div><div class="skeleton skeleton-line" style="width:40%"></div></div>
          <div class="card"><div class="skeleton skeleton-card"></div></div>
        </div>
      } @else if (deployments().length === 0) {
        <div class="empty-state">
          <div class="es-icon"><app-icon name="deployments" [size]="24" /></div>
          <h3>No deployments yet</h3>
          <p>{{ projectFilter() ? 'This project has no deployments yet.' : "Publish a version and deploy it from a project's builder to see it here." }}</p>
        </div>
      } @else {
        <div class="split">
          <!-- LEFT: Deployments List Grouped by Environment -->
          <div class="list card">
            @for (grp of grouped(); track grp.env) {
              <div class="env-h">{{ grp.env }} <span class="count">{{ grp.items.length }}</span></div>
              <table>
                <tbody>
                  @for (d of grp.items; track d.id) {
                    <tr (click)="select(d)" [class.sel]="sel()?.id === d.id">
                      <td><span class="badge" [class.active]="d.status==='active'" [class.inactive]="d.status==='inactive'" [class.archived]="d.status==='archived'">{{ d.status }}</span></td>
                      <td><span class="p-title">{{ projectName(d.workflowId) }}</span></td>
                      <td class="muted">{{ d.versionLabel || ('v' + (d.versionNumber ?? '?')) }}</td>
                      <td class="muted mono">{{ d.deployedAt | slice:0:10 }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>

          <!-- RIGHT: Selected Deployment Workspace -->
          @if (sel(); as d) {
            <div class="detail card">
              <div class="d-head">
                <div class="d-head-meta">
                  <span class="d-proj">{{ projectName(d.workflowId) }}</span>
                  <span class="d-env-pill">{{ d.environment }}</span>
                  <span class="d-ver-pill">{{ d.versionLabel || ('v' + (d.versionNumber ?? '?')) }}</span>
                  <span class="badge" [class.active]="d.status==='active'" [class.inactive]="d.status==='inactive'" [class.archived]="d.status==='archived'">{{ d.status }}</span>
                  <span class="badge freeze" title="This deployment is an immutable snapshot freeze"><app-icon name="lock" [size]="11" /> Frozen Snapshot</span>
                </div>
                <span class="spacer"></span>
                <div class="d-actions">
                  <button class="btn sm" (click)="downloadSnapshot(d)" title="Download complete self-contained deployment snapshot (.json)">
                    <app-icon name="download" [size]="13" /> Download
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

              <!-- TAB 1: READ-ONLY DIAGRAM SNAPSHOT WITH PROCESS SWITCHER -->
              @if (activeTab() === 'diagram') {
                <div class="diagram-workspace">
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
                    <div class="dwrap">
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
                               (click)="selectedNode.set(n)">

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
                      </div>

                      <div class="zoomctrl">
                        <button (click)="zoomOut()" title="Zoom out" aria-label="Zoom out">−</button>
                        <span class="zpct" (click)="zoomReset()" title="Reset zoom">{{ zoomPct() }}%</span>
                        <button (click)="zoomIn()" title="Zoom in" aria-label="Zoom in">+</button>
                        <button (click)="zoomReset()" title="Fit view">⤢</button>
                      </div>

                      <!-- Node Inspector Floating Drawer -->
                      @if (selectedNode(); as sn) {
                        <div class="node-inspector glass">
                          <div class="ni-header">
                            <span class="ni-title">
                              <span class="ni-chip" [style.background]="visual(sn.type).color"><app-icon [name]="visual(sn.type).icon" [size]="12" /></span>
                              <b>{{ sn.name || sn.id }}</b>
                            </span>
                            <button class="ni-close" (click)="selectedNode.set(null)">×</button>
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
                    </div>
                  </main>
                </div>
              }

              <!-- TAB 2: PROCESS DEFINITIONS & START INSTANCE -->
              @if (activeTab() === 'definitions') {
                <div class="tabbody">
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
                <div class="tabbody">
                  <table class="kv"><tbody>
                    <tr><td class="k">Deployed</td><td class="mono">{{ d.deployedAt | slice:0:19 }} by {{ d.deployedBy }}</td></tr>
                    <tr><td class="k">Tags</td><td>@for (t of d.tags; track t) { <span class="badge">{{ t }}</span> } @if (!d.tags.length) { <span class="muted">—</span> }</td></tr>
                    <tr><td class="k">Environment Variables</td><td><pre class="mono sm">{{ d.env ? (d.env | json) : 'None' }}</pre></td></tr>
                  </tbody></table>

                  <h3 class="sec-h">Rollback</h3>
                  @if (rollbackTargets().length === 0) {
                    <p class="muted">No other deployment in "{{ d.environment }}" to roll back to.</p>
                  } @else {
                    <div class="row">
                      <select #rb>
                        @for (t of rollbackTargets(); track t.id) { <option [value]="t.id">{{ t.versionLabel || ('v' + (t.versionNumber ?? '?')) }} · {{ t.deployedAt | slice:0:10 }}</option> }
                      </select>
                      <button class="btn" (click)="rollback(d, rb.value)">Rollback to selected</button>
                    </div>
                  }
                </div>
              }
            </div>
          } @else {
            <div class="detail card">
              <div class="empty-state">
                <div class="es-icon"><app-icon name="search" [size]="24" /></div>
                <h3>No deployment selected</h3>
                <p>Select a deployment on the left to see its process definitions, frozen diagram snapshot, and lifecycle actions.</p>
              </div>
            </div>
          }
        </div>
      }

      <!-- MODAL: IMPORT DEPLOYMENT SNAPSHOT -->
      @if (showImportModal()) {
        <div class="modal-backdrop" (click)="closeImportModal()">
          <div class="modal-card" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h3><app-icon name="upload" [size]="16" /> Import Deployment Snapshot</h3>
              <button class="modal-close" (click)="closeImportModal()">×</button>
            </div>
            <div class="modal-body">
              <p class="modal-hint">Import a previously exported deployment snapshot package (.json). This will create an immutable deployment unit in the target environment.</p>

              <div class="form-group">
                <label>Target Environment</label>
                <select [(ngModel)]="importEnvironment">
                  <option value="dev">dev</option>
                  <option value="stage">stage</option>
                  <option value="prod">prod</option>
                </select>
              </div>

              <div class="form-group">
                <label>Snapshot File (.json)</label>
                <input type="file" accept=".json,application/json" (change)="onFileSelected($event)" />
                @if (importFile()) {
                  <div class="file-chosen"><app-icon name="file" [size]="13" /> {{ importFile()!.name }} ({{ importFile()!.size }} bytes)</div>
                }
              </div>

              <div class="form-group checkbox-row">
                <label class="cb-label">
                  <input type="checkbox" [(ngModel)]="importActivate" />
                  <span>Activate immediately after import</span>
                </label>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn" (click)="closeImportModal()" [disabled]="importing()">Cancel</button>
              <button class="btn primary" (click)="executeImport()" [disabled]="!importFile() || importing()">
                @if (importing()) { Importing… } @else { Import Snapshot }
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .ta-r { text-align: right; }
    .page { padding: 20px 24px; }
    .crumbwrap { margin-bottom: 8px; }
    .pagehead { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
    h1 { font-size: 19px; margin: 0; }
    .proj-filter { max-width: 200px; }
    .split { display: grid; grid-template-columns: minmax(320px, 380px) 1fr; gap: 16px; align-items: start; }
    .env-h { padding: 10px 14px; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); background: var(--surface-2); border-bottom: 1px solid var(--border); }
    .list tr { cursor: pointer; } .list tbody tr:hover { background: var(--surface-2); } .list tr.sel td { background: var(--primary-50); }
    .p-title { font-weight: 600; color: var(--text); }
    .badge + .badge { margin-left: 4px; }
    .badge.freeze { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; display: inline-flex; align-items: center; gap: 4px; font-weight: 600; }
    .mono { font-family: var(--font-mono); font-size: 12px; }
    .d-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    .d-head-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .d-proj { font-size: 15px; font-weight: 700; color: var(--text); }
    .d-env-pill { padding: 2px 8px; border-radius: 999px; background: var(--surface-3); font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .d-ver-pill { font-size: 12px; color: var(--muted); font-weight: 600; }
    .d-actions { display: flex; align-items: center; gap: 6px; }
    .tab-strip { display: flex; gap: 4px; border-bottom: 1px solid var(--border); background: var(--surface-2); padding: 0 12px; }
    .tab-strip button { display: flex; align-items: center; gap: 6px; border: none; background: transparent; padding: 9px 12px; font-size: 13px; font-weight: 600; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; }
    .tab-strip button.active { color: var(--primary); border-bottom-color: var(--primary); background: var(--surface); }
    .tabbody { padding: 16px; }
    .kv { width: 100%; margin-bottom: 18px; } .kv td { padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 13px; vertical-align: top; } .kv .k { color: var(--muted); width: 28%; }
    .sec-h { font-size: 13px; margin: 0 0 10px; }
    .pad { padding: 4px 0 16px; }
    .row { display: flex; gap: 8px; align-items: center; }
    select { border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; font-size: 13px; background: var(--surface); }
    .btn.danger { color: var(--red); border-color: var(--border-strong); } .btn.danger:hover { background: var(--red-bg); }

    /* DIAGRAM WORKSPACE */
    .diagram-workspace { display: flex; height: 600px; min-height: 480px; position: relative; }
    .proc-rail { width: 230px; flex-shrink: 0; background: var(--surface-2); border-right: 1px solid var(--border); overflow-y: auto; display: flex; flex-direction: column; padding: 10px 8px; gap: 4px; }
    .proc-rail-h { display: flex; justify-content: space-between; align-items: center; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); padding: 4px 6px 8px; border-bottom: 1px solid var(--border); margin-bottom: 6px; }
    .p-count { background: var(--surface); padding: 1px 6px; border-radius: 10px; font-size: 10px; border: 1px solid var(--border); }
    .proc-group-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--muted); padding: 8px 6px 3px; }
    .proc-btn { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 7px 8px; border-radius: 8px; border: 1px solid transparent; background: transparent; cursor: pointer; transition: background .12s, border-color .12s; }
    .proc-btn:hover { background: var(--surface); border-color: var(--border); }
    .proc-btn.sel { background: var(--surface); border-color: var(--primary); box-shadow: 0 1px 3px rgba(91,61,245,.12); }
    .proc-ic-pill { width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; flex-shrink: 0; }
    .proc-ic-pill.parent { background: #dcfce7; color: #16a34a; }
    .proc-ic-pill.child { background: #ede9fe; color: #6366f1; }
    .proc-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .proc-name { font-size: 12px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .proc-id { font-size: 10px; color: var(--muted); }
    .proc-nodes-badge { font-size: 10px; background: var(--surface-3); color: var(--muted); padding: 1px 5px; border-radius: 6px; font-weight: 600; }
    .empty-processes { padding: 16px; text-align: center; color: var(--muted); font-size: 12px; }

    /* CANVAS VIEWPORT */
    .canvas-viewport { flex: 1; min-width: 0; position: relative; overflow: hidden; display: flex; flex-direction: column; }
    .dwrap { position: relative; flex: 1; overflow: auto; background-color: var(--canvas-bg); background-image: radial-gradient(circle, var(--canvas-dot) 1.1px, transparent 1.1px); background-size: 22px 22px; }
    .zoomlayer { position: relative; min-width: 100%; min-height: 100%; }
    .edges { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
    .ge { fill: none; stroke: var(--border-strong); stroke-width: 2; }
    .zoomctrl { position: absolute; bottom: 14px; right: 14px; display: flex; align-items: center; gap: 2px; background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 4px; box-shadow: var(--shadow-pop); z-index: 20; }
    .zoomctrl button { width: 28px; height: 28px; border: none; background: transparent; border-radius: 50%; cursor: pointer; color: var(--text-secondary); font-size: 15px; display: grid; place-items: center; }
    .zoomctrl button:hover { background: var(--surface-3); color: var(--text); }
    .zoomctrl .zpct { padding: 0 8px; font-size: 12px; font-weight: 600; cursor: pointer; }

    /* BPMN 2.0 Standard Nodes */
    .node {
      position: absolute;
      background: var(--surface);
      cursor: pointer;
      user-select: none;
      transition: box-shadow .12s, border-color .12s;
    }
    .node:hover { box-shadow: var(--shadow-pop); }
    .node.sel { border-color: var(--primary) !important; box-shadow: 0 0 0 3px rgba(91,61,245,.2), var(--shadow-card); }

    /* TASK / ACTIVITY RECTANGLE */
    .node.node-rectangle {
      border-radius: 10px;
      border: 1.5px solid var(--border-strong);
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 14px;
      box-shadow: var(--shadow-card);
    }
    .node.node-call {
      border: 2px solid #6366f1;
    }
    .call-badge {
      position: absolute;
      bottom: 2px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 10px;
      font-weight: 800;
      color: #6366f1;
      letter-spacing: -0.5px;
    }
    .node .chip {
      width: 28px;
      height: 28px;
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      border-radius: 7px;
      color: #fff;
    }
    .ntitle {
      font-weight: 600;
      font-size: 13px;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* EVENT CIRCLE */
    .node.node-circle {
      border-radius: 50%;
      border: 2px solid var(--border-strong);
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
      width: 120px;
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
      width: 120px;
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
      color: var(--text-secondary);
      box-shadow: var(--shadow-card);
      z-index: 3;
      white-space: nowrap;
    }

    /* NODE INSPECTOR CARD */
    .node-inspector {
      position: absolute;
      top: 14px;
      right: 14px;
      width: 290px;
      max-height: 85%;
      overflow-y: auto;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.94);
      backdrop-filter: blur(8px);
      box-shadow: var(--shadow-pop);
      z-index: 25;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .ni-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    .ni-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text); }
    .ni-chip { width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; color: #fff; flex-shrink: 0; }
    .ni-close { border: none; background: transparent; font-size: 18px; cursor: pointer; color: var(--muted); }
    .ni-body { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
    .ni-row { display: flex; justify-content: space-between; gap: 8px; }
    .ni-row .k { color: var(--muted); }
    .ni-call-box { background: var(--surface-2); border-radius: 8px; padding: 8px; margin-top: 4px; display: flex; flex-direction: column; gap: 4px; }
    .ni-call-label { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; }
    .ni-call-target { font-weight: 600; color: #6366f1; word-break: break-all; }
    .ni-jump { margin-top: 4px; width: 100%; justify-content: center; }
    .ni-code-block label { display: block; font-size: 11px; color: var(--muted); font-weight: 600; margin-bottom: 2px; }
    .ni-code-block pre { background: var(--surface-2); padding: 6px 8px; border-radius: 6px; max-height: 120px; overflow: auto; margin: 0; font-size: 11px; }

    /* IMPORT MODAL */
    .modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); backdrop-filter: blur(3px); z-index: 100; display: grid; place-items: center; }
    .modal-card { width: 440px; background: var(--surface); border-radius: 14px; border: 1px solid var(--border); box-shadow: var(--shadow-pop); overflow: hidden; display: flex; flex-direction: column; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); }
    .modal-header h3 { margin: 0; font-size: 15px; display: flex; align-items: center; gap: 8px; }
    .modal-close { border: none; background: transparent; font-size: 20px; cursor: pointer; color: var(--muted); }
    .modal-body { padding: 18px; display: flex; flex-direction: column; gap: 14px; }
    .modal-hint { margin: 0; font-size: 12.5px; color: var(--muted); line-height: 1.4; }
    .form-group { display: flex; flex-direction: column; gap: 6px; }
    .form-group label { font-size: 12px; font-weight: 600; color: var(--text); }
    .checkbox-row { flex-direction: row; align-items: center; }
    .cb-label { display: flex; align-items: center; gap: 8px; font-weight: normal; cursor: pointer; font-size: 13px; }
    .file-chosen { font-size: 12px; color: var(--primary); display: flex; align-items: center; gap: 6px; margin-top: 4px; }
    .modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; background: var(--surface-2); border-top: 1px solid var(--border); }
  `],
})
export class DeploymentsComponent {
  private api = inject(DeploymentApiService);
  private wfApi = inject(WorkflowApiService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private instApi = inject(InstanceApiService);
  private router = inject(Router);

  workflows = signal<Workflow[]>([]);
  deployments = signal<Deployment[]>([]);
  catalog = signal<Catalog | null>(null);
  loading = signal(true);
  sel = signal<Deployment | null>(null);
  defs = signal<DeploymentProcessDef[]>([]);
  defsLoading = signal(false);
  projectFilter = signal<string>(this.route.snapshot.queryParamMap.get('workflowId') || '');

  activeTab = signal<DeploymentTab>('diagram');
  selectedProcessId = signal<string | null>(null);
  selectedNode = signal<any | null>(null);
  zoom = signal(1);
  zoomPct = computed(() => Math.round(this.zoom() * 100));

  // Import Modal State
  showImportModal = signal(false);
  importEnvironment = 'dev';
  importActivate = false;
  importFile = signal<File | null>(null);
  importing = signal(false);

  private wfNames = computed(() => new Map(this.workflows().map((w) => [w.id, w.name])));
  projectName(id: string) { return this.wfNames().get(id) || id; }

  grouped = computed(() => {
    const byEnv = new Map<string, Deployment[]>();
    for (const d of this.deployments()) { (byEnv.get(d.environment) || byEnv.set(d.environment, []).get(d.environment)!).push(d); }
    return [...byEnv.entries()].map(([env, items]) => ({ env, items }));
  });

  rollbackTargets = computed(() => {
    const d = this.sel();
    if (!d) return [];
    return this.deployments().filter((x) => x.environment === d.environment && x.workflowId === d.workflowId && x.id !== d.id);
  });

  // All processes in the active deployment container
  processes = computed(() => {
    const d = this.sel();
    return (d?.engine?.processes || []) as any[];
  });

  // Set of process IDs that are called as sub-processes
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

  // Parent / Root processes (not called by any Call Activity)
  parentProcesses = computed(() => {
    const called = this.calledProcessIds();
    const ps = this.processes();
    const roots = ps.filter((p) => !called.has(p.id));
    return roots.length ? roots : ps.slice(0, 1);
  });

  // Child / Sub-processes (called by Call Activities)
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
    let maxX = 700;
    for (const n of this.laidNodes()) {
      const d = this.nodeDims(n.type);
      const right = n.x + d.w + 60;
      if (right > maxX) maxX = right;
    }
    return maxX + 80;
  });

  dh = computed(() => {
    let maxY = 300;
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

  constructor() {
    this.wfApi.listWorkflows().subscribe((ws) => this.workflows.set(ws));
    this.wfApi.catalog().subscribe((c) => this.catalog.set(c));
    this.reload();
  }

  reload() {
    this.loading.set(true);
    this.api.listDeploymentsGlobal({ workflowId: this.projectFilter() || undefined }).subscribe((d) => {
      this.deployments.set(d);
      this.loading.set(false);
      const curr = this.sel();
      if (curr) {
        const updated = d.find((x) => x.id === curr.id);
        if (updated) this.select(updated);
      }
    });
  }

  setProjectFilter(id: string) { this.projectFilter.set(id); this.sel.set(null); this.reload(); }

  select(d: Deployment) {
    this.sel.set(d);
    this.selectedProcessId.set(null);
    this.selectedNode.set(null);
    this.defsLoading.set(true);
    this.api.getDeployment(d.id).subscribe({
      next: (full) => {
        this.sel.set(full);
      },
    });
    this.api.definitions(d.id).subscribe((defs) => {
      this.defs.set(defs);
      this.defsLoading.set(false);
    });
  }

  private refreshAfterAction(id: string) {
    this.reload();
    this.api.getDeployment(id).subscribe((d) => this.select(d));
  }

  private onActionError(e: any) { this.toast.error(e?.error?.error?.message || 'That action could not be completed'); }

  activate(d: Deployment) { this.api.activate(d.id).subscribe({ next: () => this.refreshAfterAction(d.id), error: (e) => this.onActionError(e) }); }
  undeploy(d: Deployment) { this.api.undeploy(d.id).subscribe({ next: () => this.refreshAfterAction(d.id), error: (e) => this.onActionError(e) }); }
  archive(d: Deployment) { this.api.archive(d.id).subscribe({ next: () => this.refreshAfterAction(d.id), error: (e) => this.onActionError(e) }); }
  rollback(d: Deployment, toDeploymentId: string) { if (!toDeploymentId) return; this.api.rollback(d.id, { environment: d.environment, toDeploymentId }).subscribe({ next: () => this.reload(), error: (e) => this.onActionError(e) }); }

  startInstance(d: Deployment, pd: DeploymentProcessDef) {
    this.instApi.startInstance({ workflowId: d.workflowId, processId: pd.id, deploymentId: d.id }).subscribe({
      next: (inst) => {
        this.toast.success(`Instance started: \u2026${inst.id.slice(-7)}`);
        this.router.navigate(['/instances'], { queryParams: { id: inst.id } });
      },
      error: (e) => this.onActionError(e),
    });
  }

  // --- DOWNLOAD SNAPSHOT ---
  downloadSnapshot(d: Deployment) {
    this.api.exportSnapshot(d.id).subscribe({
      next: (snap) => {
        const json = JSON.stringify(snap, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ver = d.versionLabel || ('v' + (d.versionNumber ?? '1'));
        a.download = `deployment-${d.workflowId}-${d.environment}-${ver}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.toast.success('Deployment snapshot package downloaded.');
      },
      error: (e) => this.onActionError(e),
    });
  }

  // --- RESTORE TO PROJECT ---
  confirmRestore(d: Deployment) {
    const ver = d.versionLabel || ('v' + (d.versionNumber ?? '?'));
    const confirmed = confirm(
      `Restore deployment snapshot (${ver}, ${d.environment}) back to project "${this.projectName(d.workflowId)}"?\n\n` +
      `This will create a new draft in the project containing the exact frozen workflow, processes, and assets from this deployment snapshot.`
    );
    if (!confirmed) return;

    this.api.restoreToProject(d.id).subscribe({
      next: (res) => {
        this.toast.success(res.message || 'Snapshot successfully restored to project draft.');
      },
      error: (e) => this.onActionError(e),
    });
  }

  // --- IMPORT SNAPSHOT MODAL ---
  openImportModal() {
    this.importEnvironment = 'dev';
    this.importActivate = false;
    this.importFile.set(null);
    this.importing.set(false);
    this.showImportModal.set(true);
  }

  closeImportModal() {
    this.showImportModal.set(false);
  }

  onFileSelected(ev: Event) {
    const input = ev.target as HTMLInputElement;
    if (input.files && input.files.length) {
      this.importFile.set(input.files[0]);
    }
  }

  executeImport() {
    const file = this.importFile();
    if (!file) {
      this.toast.error('Please choose a .json snapshot file to import.');
      return;
    }
    this.importing.set(true);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const snapshot = JSON.parse(reader.result as string);
        this.api.importSnapshot({
          snapshot,
          environment: this.importEnvironment,
          activate: this.importActivate,
        }).subscribe({
          next: (dep) => {
            this.importing.set(false);
            this.showImportModal.set(false);
            this.toast.success(`Deployment imported into "${dep.environment}" successfully.`);
            this.reload();
            this.select(dep);
          },
          error: (e) => {
            this.importing.set(false);
            this.onActionError(e);
          },
        });
      } catch (err: any) {
        this.importing.set(false);
        this.toast.error('Invalid JSON file format.');
      }
    };
    reader.readAsText(file);
  }

  // --- BPMN DIAGRAM HELPERS ---
  visual(t: string) { return this.catalog()?.diagram?.[t] || { icon: 'info', color: '#64748b' }; }

  nodeDims(type: string): { w: number; h: number } {
    if (type === 'start' || type === 'end' || type === 'catch' || type === 'throw' || type === 'boundary') {
      return { w: 44, h: 44 };
    }
    if (type === 'gateway') {
      return { w: 52, h: 52 };
    }
    return { w: 180, h: 56 };
  }
  isCircle(type: string): boolean { return this.nodeDims(type).w === 44; }
  isDiamond(type: string): boolean { return this.nodeDims(type).w === 52; }
  isRectangle(type: string): boolean { return this.nodeDims(type).w === 180; }
  gatewayMarker(n: any): string {
    const mode = n['mode'] || 'exclusive';
    if (mode === 'parallel') return '+';
    if (mode === 'inclusive') return '○';
    if (mode === 'event') return '⬠';
    return '✕';
  }

  nodeAnchorOut(n: any): { x: number; y: number } {
    const d = this.nodeDims(n.type);
    return { x: n.x + d.w, y: n.y + d.h / 2 };
  }
  nodeAnchorIn(n: any): { x: number; y: number } {
    const d = this.nodeDims(n.type);
    return { x: n.x, y: n.y + d.h / 2 };
  }

  private computeLayeredPositions(nodes: any[], flows: any[]): Map<string, { x: number; y: number }> {
    if (!nodes.length) return new Map();
    const roots = nodes.filter((n) => n.type === 'start' || !flows.some((f) => f.to === n.id));
    const rootIds = (roots.length ? roots : nodes.slice(0, 1)).map((n) => n.id);

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const forwardFlows: any[] = [];

    const dfs = (curr: string) => {
      visited.add(curr);
      inStack.add(curr);
      for (const f of flows) {
        if (f.from !== curr) continue;
        if (!inStack.has(f.to)) {
          forwardFlows.push(f);
          if (!visited.has(f.to)) dfs(f.to);
        }
      }
      inStack.delete(curr);
    };

    for (const r of rootIds) if (!visited.has(r)) dfs(r);
    for (const n of nodes) if (!visited.has(n.id)) dfs(n.id);

    const col = new Map<string, number>();
    for (const id of rootIds) col.set(id, 0);

    for (let pass = 0; pass < nodes.length + 1; pass++) {
      let changed = false;
      for (const f of forwardFlows) {
        if (!col.has(f.from)) continue;
        const c = col.get(f.from)! + 1;
        if (!col.has(f.to) || col.get(f.to)! < c) { col.set(f.to, c); changed = true; }
      }
      if (!changed) break;
    }
    let maxCol = Math.max(0, ...[...col.values()]);
    for (const n of nodes) if (!col.has(n.id)) { maxCol += 1; col.set(n.id, maxCol); }

    const byCol = new Map<number, string[]>();
    for (const n of nodes) { const c = col.get(n.id)!; (byCol.get(c) || byCol.set(c, []).get(c)!).push(n.id); }

    const row = new Map<string, number>();
    const cols = [...byCol.keys()].sort((a, b) => a - b);
    for (const c of cols) {
      const idsInCol = byCol.get(c)!;
      if (c === 0) { idsInCol.forEach((id, i) => row.set(id, i)); continue; }
      const scored = idsInCol.map((id) => {
        const preds = flows.filter((f) => f.to === id && row.has(f.from)).map((f) => row.get(f.from)!);
        const score = preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : idsInCol.indexOf(id);
        return { id, score };
      });
      scored.sort((a, b) => a.score - b.score);
      scored.forEach((s, i) => row.set(s.id, i));
    }

    const out = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      const h = this.nodeDims(n.type).h;
      const yOffset = (56 - h) / 2;
      out.set(n.id, { x: 40 + col.get(n.id)! * COL_W, y: 40 + row.get(n.id)! * ROW_H + yOffset });
    }
    return out;
  }

  private orthPath(x1: number, y1: number, x2: number, y2: number, fromNode?: any, toNode?: any): string {
    const R = 8;
    if (Math.abs(y2 - y1) < 4 && x2 >= x1) return `M ${x1} ${y1} L ${x2} ${y2}`;

    if (x2 >= x1 + 24) {
      const midX = Math.round(x1 + (x2 - x1) / 2);
      const down = y2 > y1;
      const r = Math.min(R, Math.abs(y2 - y1) / 2, Math.abs(midX - x1), Math.abs(x2 - midX));
      const vSign = down ? 1 : -1;
      return [
        `M ${x1} ${y1}`,
        `L ${midX - r} ${y1}`,
        `Q ${midX} ${y1} ${midX} ${y1 + r * vSign}`,
        `L ${midX} ${y2 - r * vSign}`,
        `Q ${midX} ${y2} ${midX + r} ${y2}`,
        `L ${x2} ${y2}`,
      ].join(' ');
    }

    const dFrom = fromNode ? this.nodeDims(fromNode.type) : { w: 180, h: 56 };
    const dTo = toNode ? this.nodeDims(toNode.type) : { w: 180, h: 56 };
    const bypassY = Math.max((fromNode?.y ?? y1) + dFrom.h, (toNode?.y ?? y2) + dTo.h) + 38;
    const outX = x1 + 20, inX = x2 - 20;
    const r = Math.min(R, Math.abs(bypassY - y1) / 2, Math.abs(bypassY - y2) / 2, 16);

    return [
      `M ${x1} ${y1}`,
      `L ${outX - r} ${y1}`,
      `Q ${outX} ${y1} ${outX} ${y1 + r}`,
      `L ${outX} ${bypassY - r}`,
      `Q ${outX} ${bypassY} ${outX - r} ${bypassY}`,
      `L ${inX + r} ${bypassY}`,
      `Q ${inX} ${bypassY} ${inX} ${bypassY - r}`,
      `L ${inX} ${y2 + r}`,
      `Q ${inX} ${y2} ${inX + r} ${y2}`,
      `L ${x2} ${y2}`,
    ].join(' ');
  }

  edge(e: any) {
    const a = this.byId(e.from), b = this.byId(e.to);
    if (!a || !b) return '';
    const p1 = this.nodeAnchorOut(a), p2 = this.nodeAnchorIn(b);
    return this.orthPath(p1.x, p1.y, p2.x, p2.y, a, b);
  }

  zoomIn() { this.zoom.set(Math.min(1.5, Math.round((this.zoom() + 0.1) * 10) / 10)); }
  zoomOut() { this.zoom.set(Math.max(0.4, Math.round((this.zoom() - 0.1) * 10) / 10)); }
  zoomReset() { this.zoom.set(1); }
}
