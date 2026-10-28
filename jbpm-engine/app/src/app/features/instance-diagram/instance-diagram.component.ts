import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { InstancesService, type DiagramState } from '../../core/services/instances.service';
import { DeploymentsService } from '../../core/services/deployments.service';
import { NodeCatalogService } from '../../core/services/node-catalog.service';
import { ToastService } from '../../core/services/toast.service';
import type { Instance } from '../../core/models/domain';
import type { EngineFlow, EngineNode, EngineProcess, NodeCatalog } from '../../core/models/engine';

const SHAPE_SIZE: Record<string, { w: number; h: number }> = {
  circle: { w: 46, h: 46 },
  diamond: { w: 60, h: 60 },
  rectangle: { w: 168, h: 48 },
};
const POLL_MS = 3000;

@Component({
  selector: 'app-instance-diagram',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './instance-diagram.component.html',
  styleUrl: './instance-diagram.component.scss',
})
export class InstanceDiagramComponent implements OnDestroy {
  private route = inject(ActivatedRoute);
  private instancesSvc = inject(InstancesService);
  private deploymentsSvc = inject(DeploymentsService);
  private catalogSvc = inject(NodeCatalogService);
  private toast = inject(ToastService);

  private id = this.route.snapshot.paramMap.get('id')!;
  instance = signal<Instance | undefined>(undefined);
  process = signal<EngineProcess | undefined>(undefined);
  catalog = signal<NodeCatalog | undefined>(undefined);
  diagramState = signal<DiagramState | undefined>(undefined);
  selectedId = signal<string | undefined>(undefined);
  zoom = signal(1);
  pan = signal({ x: 0, y: 0 });
  legendOpen = signal(true);

  private panning = false;
  private panStart = { x: 0, y: 0 };
  private panOrigin = { x: 0, y: 0 };
  private pollHandle: ReturnType<typeof setInterval> | undefined;

  autoLaidOut = computed(() => this.process() !== undefined);

  constructor() {
    this.catalogSvc.load().subscribe((c) => this.catalog.set(c));
    this.load(true);
  }

  ngOnDestroy(): void { clearInterval(this.pollHandle); }

  private load(withProcess: boolean): void {
    this.instancesSvc.get(this.id).subscribe({
      next: (inst) => {
        this.instance.set(inst);
        if (withProcess) {
          this.deploymentsSvc.get(inst.deploymentId).subscribe({
            next: (dep) => {
              const proc = dep.engine.processes.find((p) => p.id === inst.processId) ?? dep.engine.processes[0];
              this.process.set(proc ? this.layoutIfNeeded(proc) : undefined);
            },
            error: (e) => this.toast.errorFrom(e, 'Could not load process graph'),
          });
        }
        if (inst.status === 'running' || inst.status === 'waiting') this.schedulePoll(); else clearInterval(this.pollHandle);
      },
      error: (e) => this.toast.errorFrom(e, 'Could not load instance'),
    });
    this.instancesSvc.diagram(this.id).subscribe((d) => this.diagramState.set(d));
  }

  private schedulePoll(): void {
    clearInterval(this.pollHandle);
    this.pollHandle = setInterval(() => this.load(false), POLL_MS);
  }

  /** Nodes authored before x/y existed (or from an older draft) get a simple left-to-right layout by
   *  BFS depth so the diagram is never a pile of overlapping shapes at (0,0). */
  private layoutIfNeeded(proc: EngineProcess): EngineProcess {
    if (proc.nodes.every((n) => typeof n['x'] === 'number')) return proc;
    const depth = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    for (const f of proc.flows) outgoing.set(f.from, [...(outgoing.get(f.from) ?? []), f.to]);
    const roots = proc.nodes.filter((n) => !proc.flows.some((f) => f.to === n.id));
    const queue: [string, number][] = roots.map((n) => [n.id, 0]);
    while (queue.length) {
      const [id, d] = queue.shift()!;
      if (depth.has(id) && depth.get(id)! <= d) continue;
      depth.set(id, d);
      for (const next of outgoing.get(id) ?? []) queue.push([next, d + 1]);
    }
    const perDepth = new Map<number, number>();
    const nodes = proc.nodes.map((n) => {
      if (typeof n['x'] === 'number') return n;
      const d = depth.get(n.id) ?? 0;
      const row = perDepth.get(d) ?? 0;
      perDepth.set(d, row + 1);
      return { ...n, x: 80 + d * 210, y: 100 + row * 90 };
    });
    return { ...proc, nodes };
  }

  shapeOf(node: EngineNode) {
    const def = this.catalog()?.defs.find((d) => d.engineType === node['type']);
    const shape = def?.diagram.shape ?? 'rectangle';
    return { ...SHAPE_SIZE[shape]!, shape, color: def?.diagram.color ?? '#8b5cf6', icon: def?.diagram.icon ?? '?' };
  }
  label(node: EngineNode): string {
    return (node['name'] as string) || this.catalog()?.defs.find((d) => d.engineType === node['type'])?.typeLabel || node['type'];
  }
  nodeState(id: string): 'active' | 'visited' | 'ghost' {
    const d = this.diagramState();
    if (!d) return 'ghost';
    if (d.activeNodeIds.includes(id)) return 'active';
    if (d.visitedNodeIds.includes(id)) return 'visited';
    return 'ghost';
  }
  flowTaken(f: EngineFlow): boolean {
    const d = this.diagramState();
    return !!d && d.visitedNodeIds.includes(f.from) && (d.visitedNodeIds.includes(f.to) || d.activeNodeIds.includes(f.to));
  }
  nodeAt(id: string): EngineNode | undefined { return this.process()?.nodes.find((n) => n.id === id); }
  private anchorRight(n: EngineNode) { const s = this.shapeOf(n); return { x: (n['x'] as number ?? 0) + s.w, y: (n['y'] as number ?? 0) + s.h / 2 }; }
  private anchorLeft(n: EngineNode) { const s = this.shapeOf(n); return { x: n['x'] as number ?? 0, y: (n['y'] as number ?? 0) + s.h / 2 }; }
  pathBetween(a: EngineNode, b: EngineNode): string {
    const p1 = this.anchorRight(a), p2 = this.anchorLeft(b);
    const dx = Math.max(40, Math.abs(p2.x - p1.x) / 2);
    return `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;
  }

  select(id: string, ev: MouseEvent): void { ev.stopPropagation(); this.selectedId.set(id); }
  deselect(): void { this.selectedId.set(undefined); }

  startPan(ev: MouseEvent): void {
    if (ev.button !== 0) return;
    this.deselect();
    this.panning = true;
    this.panStart = { x: ev.clientX, y: ev.clientY };
    this.panOrigin = this.pan();
  }
  onMouseMove(ev: MouseEvent): void {
    if (!this.panning) return;
    const z = this.zoom();
    this.pan.set({ x: this.panOrigin.x + (ev.clientX - this.panStart.x) / z, y: this.panOrigin.y + (ev.clientY - this.panStart.y) / z });
  }
  onMouseUp(): void { this.panning = false; }
  zoomBy(delta: number): void { this.zoom.set(Math.min(2, Math.max(0.3, Math.round((this.zoom() + delta) * 100) / 100))); }
  zoomReset(): void { this.zoom.set(1); this.pan.set({ x: 0, y: 0 }); }

  abort(): void {
    this.instancesSvc.abort(this.id).subscribe({ next: (inst) => { this.instance.set(inst); this.toast.success('Aborted'); }, error: (e) => this.toast.errorFrom(e) });
  }
  retry(nodeId: string): void {
    this.instancesSvc.retryNode(this.id, nodeId).subscribe({ next: (inst) => { this.instance.set(inst); this.toast.success('Retried'); this.load(false); }, error: (e) => this.toast.errorFrom(e) });
  }
}
