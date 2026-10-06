import { Component, ElementRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { VersionsService, type ValidationIssue } from '../../core/services/versions.service';
import { DeploymentsService } from '../../core/services/deployments.service';
import { NodeCatalogService } from '../../core/services/node-catalog.service';
import { ToastService } from '../../core/services/toast.service';
import type { Version } from '../../core/models/domain';
import type { EngineFlow, EngineNode, EngineProcess, NodeCatalog, NodeDef, PaletteEntry } from '../../core/models/engine';
import { NodePropertiesComponent } from './node-properties.component';

const SHAPE_SIZE: Record<string, { w: number; h: number }> = {
  circle: { w: 46, h: 46 },
  diamond: { w: 60, h: 60 },
  rectangle: { w: 168, h: 48 },
};

@Component({
  selector: 'app-process-builder',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, NodePropertiesComponent],
  templateUrl: './process-builder.component.html',
  styleUrl: './process-builder.component.scss',
})
export class ProcessBuilderComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private versionsSvc = inject(VersionsService);
  private deploymentsSvc = inject(DeploymentsService);
  private catalogSvc = inject(NodeCatalogService);
  private toast = inject(ToastService);

  workflowId = this.route.snapshot.paramMap.get('workflowId')!;
  private versionId = this.route.snapshot.paramMap.get('versionId')!;
  private processId = this.route.snapshot.paramMap.get('processId')!;

  canvasEl = viewChild<ElementRef<HTMLDivElement>>('canvasField');

  version = signal<Version | undefined>(undefined);
  process = signal<EngineProcess | undefined>(undefined);
  catalog = signal<NodeCatalog | undefined>(undefined);
  selectedNodeId = signal<string | undefined>(undefined);
  paletteOpen = signal(false);
  paletteQuery = signal('');
  saveState = signal<'saved' | 'saving' | 'dirty'>('saved');
  issues = signal<ValidationIssue[]>([]);
  validating = signal(false);
  publishing = signal(false);
  zoom = signal(1);
  pan = signal({ x: 0, y: 0 });

  connectingFrom = signal<string | undefined>(undefined);
  ghostPoint = signal<{ x: number; y: number } | undefined>(undefined);

  private dragNodeId: string | undefined;
  private dragOffset = { x: 0, y: 0 };
  private panning = false;
  private panStart = { x: 0, y: 0 };
  private panOrigin = { x: 0, y: 0 };
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  selectedNode = computed(() => this.process()?.nodes.find((n) => n.id === this.selectedNodeId()));
  selectedNodeDef = computed(() => {
    const node = this.selectedNode();
    return node ? this.catalog()?.defs.find((d) => d.engineType === node['type']) : undefined;
  });
  errorCount = computed(() => this.issues().filter((i) => i.severity === 'error').length);
  warningCount = computed(() => this.issues().filter((i) => i.severity === 'warning').length);

  paletteByCategory = computed(() => {
    const cat = this.catalog();
    if (!cat) return [] as { category: string; entries: PaletteEntry[] }[];
    const q = this.paletteQuery().trim().toLowerCase();
    const all = cat.defs.flatMap((d) => d.palette);
    const filtered = q ? all.filter((p) => p.label.toLowerCase().includes(q)) : all;
    return cat.categories
      .map((category) => ({ category, entries: filtered.filter((p) => p.category === category) }))
      .filter((g) => g.entries.length > 0);
  });

  constructor() {
    this.catalogSvc.load().subscribe((c) => this.catalog.set(c));
    this.versionsSvc.get(this.versionId).subscribe({
      next: (v) => {
        this.version.set(v);
        const p = v.engine?.processes.find((pr) => pr.id === this.processId);
        if (!p) { this.toast.error('Process not found'); this.router.navigate(['/projects', this.workflowId]); return; }
        this.process.set(structuredClone(p));
      },
      error: (e) => this.toast.errorFrom(e, 'Could not load process'),
    });
  }

  nodeAt(id: string): EngineNode | undefined {
    return this.process()?.nodes.find((n) => n.id === id);
  }

  anchorRight(n: EngineNode): { x: number; y: number } {
    const s = this.shapeOf(n);
    return { x: (n['x'] as number ?? 0) + s.w, y: (n['y'] as number ?? 0) + s.h / 2 };
  }
  private anchorLeft(n: EngineNode): { x: number; y: number } {
    const s = this.shapeOf(n);
    return { x: n['x'] as number ?? 0, y: (n['y'] as number ?? 0) + s.h / 2 };
  }

  pathBetween(a: EngineNode, b: EngineNode): string {
    const p1 = this.anchorRight(a), p2 = this.anchorLeft(b);
    const dx = Math.max(40, Math.abs(p2.x - p1.x) / 2);
    return `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;
  }

  shapeOf(node: EngineNode): { w: number; h: number; shape: string; color: string; icon: string } {
    const def = this.catalog()?.defs.find((d) => d.engineType === node['type']);
    const shape = def?.diagram.shape ?? 'rectangle';
    return { ...SHAPE_SIZE[shape]!, shape, color: def?.diagram.color ?? '#8b5cf6', icon: def?.diagram.icon ?? '?' };
  }

  label(node: EngineNode): string {
    return (node['name'] as string) || this.catalog()?.defs.find((d) => d.engineType === node['type'])?.typeLabel || node['type'];
  }

  // ---- selection ----
  selectNode(node: EngineNode, ev: MouseEvent): void {
    ev.stopPropagation();
    if (this.connectingFrom()) { this.completeConnection(node.id); return; }
    this.selectedNodeId.set(node.id);
  }

  deselect(): void {
    this.selectedNodeId.set(undefined);
    this.connectingFrom.set(undefined);
  }

  // ---- dragging nodes ----
  private dragMoved = false;
  startDrag(node: EngineNode, ev: MouseEvent): void {
    if (ev.button !== 0 || this.connectingFrom()) return;
    ev.stopPropagation();
    this.dragNodeId = node.id;
    this.dragMoved = false;
    const z = this.zoom();
    this.dragOffset = { x: ev.clientX / z - (node['x'] as number ?? 0), y: ev.clientY / z - (node['y'] as number ?? 0) };
  }

  // ---- connecting flows ----
  startConnect(node: EngineNode, ev: MouseEvent): void {
    ev.stopPropagation();
    this.connectingFrom.set(node.id);
    this.selectedNodeId.set(undefined);
  }

  private completeConnection(targetId: string): void {
    const fromId = this.connectingFrom();
    this.connectingFrom.set(undefined);
    if (!fromId || fromId === targetId) return;
    const p = this.process();
    if (!p) return;
    if (p.flows.some((f) => f.from === fromId && f.to === targetId)) return;
    p.flows = [...p.flows, { from: fromId, to: targetId }];
    this.touch();
  }

  @HostListener('document:mousemove', ['$event'])
  onDocMouseMove(ev: MouseEvent): void {
    const rect = this.canvasEl()?.nativeElement.getBoundingClientRect();
    if (!rect) return;
    const z = this.zoom();
    const pan = this.pan();
    const localX = (ev.clientX - rect.left) / z - pan.x;
    const localY = (ev.clientY - rect.top) / z - pan.y;

    if (this.dragNodeId) {
      const p = this.process();
      const node = p?.nodes.find((n) => n.id === this.dragNodeId);
      if (node) {
        const nx = Math.round(ev.clientX / z - this.dragOffset.x);
        const ny = Math.round(ev.clientY / z - this.dragOffset.y);
        if (nx !== node['x'] || ny !== node['y']) this.dragMoved = true;
        node['x'] = nx;
        node['y'] = ny;
      }
      return;
    }
    if (this.panning) {
      this.pan.set({ x: this.panOrigin.x + (ev.clientX - this.panStart.x) / z, y: this.panOrigin.y + (ev.clientY - this.panStart.y) / z });
      return;
    }
    if (this.connectingFrom()) this.ghostPoint.set({ x: localX, y: localY });
  }

  @HostListener('document:mouseup')
  onDocMouseUp(): void {
    if (this.dragNodeId) {
      this.dragNodeId = undefined;
      if (this.dragMoved) this.touch();
    }
    this.panning = false;
  }

  startPan(ev: MouseEvent): void {
    if (ev.button !== 0) return;
    this.deselect();
    this.panning = true;
    this.panStart = { x: ev.clientX, y: ev.clientY };
    this.panOrigin = this.pan();
  }

  // ---- palette ----
  addFromPalette(entry: PaletteEntry): void {
    const p = this.process();
    if (!p) return;
    const anchor = this.selectedNode();
    const x = anchor ? (anchor['x'] as number ?? 0) + 220 : 120 + p.nodes.length * 40;
    const y = anchor ? (anchor['y'] as number ?? 0) : 200;
    const id = `${entry.engineType}_${Date.now().toString(36)}${Math.floor(Math.random() * 999)}`;
    const node: EngineNode = { ...structuredClone(entry.defaults), id, x, y } as EngineNode;
    p.nodes = [...p.nodes, node];
    if (anchor) p.flows = [...p.flows, { from: anchor.id, to: id }];
    this.selectedNodeId.set(id);
    this.touch();
  }

  deleteSelected(): void {
    const p = this.process();
    const id = this.selectedNodeId();
    if (!p || !id) return;
    p.nodes = p.nodes.filter((n) => n.id !== id);
    p.flows = p.flows.filter((f) => f.from !== id && f.to !== id);
    this.selectedNodeId.set(undefined);
    this.touch();
  }

  deleteFlow(flow: EngineFlow, ev: MouseEvent): void {
    ev.stopPropagation();
    const p = this.process();
    if (!p) return;
    p.flows = p.flows.filter((f) => f !== flow);
    this.touch();
  }

  onFieldChange(): void { this.touch(); }

  // ---- zoom ----
  zoomBy(delta: number): void { this.zoom.set(Math.min(2, Math.max(0.3, Math.round((this.zoom() + delta) * 100) / 100))); }
  zoomReset(): void { this.zoom.set(1); this.pan.set({ x: 0, y: 0 }); }

  // ---- persistence ----
  private touch(): void {
    this.saveState.set('dirty');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 900);
  }

  private save(): void {
    const v = this.version(), p = this.process();
    if (!v || !p || !v.engine) return;
    this.saveState.set('saving');
    const engine = { ...v.engine, processes: v.engine.processes.map((pr) => (pr.id === p.id ? p : pr)) };
    this.versionsSvc.saveDraft(v.id, engine).subscribe({
      next: () => this.saveState.set('saved'),
      error: (e) => { this.saveState.set('dirty'); this.toast.errorFrom(e, 'Could not save'); },
    });
  }

  validate(): void {
    this.validating.set(true);
    this.versionsSvc.validate(this.versionId).subscribe({
      next: (res) => {
        this.validating.set(false);
        this.issues.set(res.issues);
        if (res.issues.length === 0) this.toast.success('No problems found');
        else if (this.errorCount() === 0) this.toast.info(`No blocking errors — ${this.warningCount()} warning${this.warningCount() > 1 ? 's' : ''}`);
        else this.toast.error(`${this.errorCount()} error${this.errorCount() > 1 ? 's' : ''} found`);
      },
      error: (e) => { this.validating.set(false); this.toast.errorFrom(e); },
    });
  }

  publish(): void {
    this.publishing.set(true);
    this.versionsSvc.publish(this.versionId).subscribe({
      next: (res) => {
        this.publishing.set(false);
        this.issues.set(res.warnings);
        this.toast.success('Published — a new draft is ready to continue editing');
      },
      error: (e) => { this.publishing.set(false); if (e?.error?.details) this.issues.set(e.error.details); this.toast.errorFrom(e, 'Publish failed'); },
    });
  }

  deploy(): void {
    const environment = window.prompt('Deploy to which environment?', 'test');
    if (!environment) return;
    this.versionsSvc.publish(this.versionId).subscribe({
      next: (res) => {
        this.deploymentsSvc.deploy(res.version.id, environment).subscribe({
          next: () => this.toast.success(`Deployed to "${environment}"`),
          error: (e) => this.toast.errorFrom(e, 'Deploy failed'),
        });
      },
      error: (e) => { if (e?.error?.details) this.issues.set(e.error.details); this.toast.errorFrom(e, 'Publish before deploy failed'); },
    });
  }

  back(): void { this.router.navigate(['/projects', this.workflowId]); }
}
