import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import type { Catalog, NodeSpec, Workflow } from '../../core/models';

// Phase-1 builder shell: header + categorized palette + canvas placeholder + properties panel.
// Canvas node/edge editing (@foblex/flow) + engine-JSON binding land in the Phase-1 canvas task.
@Component({
  selector: 'app-builder',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="builder">
      <!-- HEADER -->
      <header class="hdr">
        <a class="btn ghost" routerLink="/workflows">‹ Apps</a>
        <div class="titles">
          <input class="wfname" [(ngModel)]="name" placeholder="Workflow Name *" />
          <span class="key badge">{{ wf()?.key || '—' }}</span>
        </div>
        <span class="spacer"></span>
        <button class="btn" (click)="save()">Update</button>
        <button class="btn">User Permissions</button>
        <button class="btn">Variables</button>
        <button class="btn ghost" title="Undo all changes">⟲</button>
        <button class="btn ghost" title="Import">↥</button>
        <button class="btn ghost" title="Export">↧</button>
        <button class="btn">▷ Run</button>
        <button class="btn primary">Deploy</button>
      </header>

      <div class="body">
        <!-- PALETTE -->
        <aside class="palette">
          <input class="search" placeholder="Search nodes…" [(ngModel)]="q" />
          @for (cat of cats(); track cat) {
            <div class="cat">
              <div class="cat-h">{{ cat }}</div>
              <div class="cat-grid">
                @for (n of nodesIn(cat); track n.key) {
                  <div class="ptile" draggable="true" [title]="n.label">
                    <span class="pic" [style.background]="n.color">{{ n.icon }}</span>
                    <span class="plabel">{{ n.label }}</span>
                  </div>
                }
              </div>
            </div>
          }
        </aside>

        <!-- CANVAS -->
        <main class="canvas">
          <div class="canvas-hint card">
            <h3>Canvas</h3>
            <p class="muted">Drag nodes from the palette to build your flow. The node/edge editor
              (Foblex Flow) binds to the engine JSON model and autosaves as a draft version.</p>
            <div class="sample">
              <div class="scard"><span class="pic" style="background:#16a34a">▤</span><b>Form Submitted</b></div>
              <span class="edge">→</span>
              <div class="scard"><span class="pic" style="background:#2563eb">🏷</span><b>Add Tag</b></div>
              <span class="edge">→</span>
              <div class="scard"><span class="pic" style="background:#16a34a">💬</span><b>SMS</b></div>
              <span class="edge">→</span>
              <div class="scard"><span class="pic" style="background:#7c3aed">⏱</span><b>Wait</b></div>
              <span class="edge">→</span>
              <div class="scard"><span class="pic" style="background:#16a34a">✉</span><b>Email</b></div>
            </div>
          </div>
        </main>

        <!-- PROPERTIES -->
        <aside class="props">
          <div class="props-h">Properties</div>
          <p class="muted small">Select a node to edit its properties. Forms are generated from each
            node's JSON schema (docs/bpm-nodes).</p>
        </aside>
      </div>
    </div>
  `,
  styles: [`
    .builder { display: flex; flex-direction: column; height: 100%; }
    .hdr { display: flex; align-items: center; gap: 8px; padding: 8px 14px; background: var(--surface); border-bottom: 1px solid var(--border); }
    .titles { display: flex; align-items: center; gap: 10px; }
    .wfname { border: 1px solid transparent; border-radius: var(--radius-sm); padding: 6px 8px; font-size: 15px; font-weight: 600; }
    .wfname:hover, .wfname:focus { border-color: var(--border); outline: none; }
    .body { flex: 1; display: flex; min-height: 0; }
    .palette { width: 240px; background: var(--surface); border-right: 1px solid var(--border); overflow-y: auto; padding: 12px; }
    .search { width: 100%; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 6px 10px; margin-bottom: 12px; font-size: 13px; }
    .cat-h { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin: 12px 0 6px; }
    .cat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .ptile { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 6px; border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: grab; background: var(--surface); text-align: center; }
    .ptile:hover { box-shadow: var(--shadow-card); }
    .pic { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 9px; color: #fff; font-size: 15px; }
    .plabel { font-size: 11px; color: var(--text); }
    .canvas { flex: 1; background:
      radial-gradient(circle, #dfe3ee 1px, transparent 1px) 0 0 / 20px 20px; overflow: auto; display: grid; place-items: center; }
    .canvas-hint { max-width: 900px; padding: 24px; text-align: center; }
    .sample { display: flex; align-items: center; gap: 10px; margin-top: 18px; justify-content: center; flex-wrap: wrap; }
    .scard { display: flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-card); padding: 10px 14px; }
    .edge { color: var(--muted); }
    .props { width: var(--panel-w); background: var(--surface); border-left: 1px solid var(--border); padding: 16px; }
    .props-h { font-weight: 600; margin-bottom: 8px; }
    .small { font-size: 12px; }
  `],
})
export class BuilderComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  wf = signal<Workflow | null>(null);
  catalog = signal<Catalog | null>(null);
  name = '';
  q = '';

  cats = computed(() => this.catalog()?.categories ?? []);

  constructor() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.api.getWorkflow(id).subscribe((w) => { this.wf.set(w); this.name = w.name; });
    this.api.catalog().subscribe((c) => this.catalog.set(c));
  }

  nodesIn(cat: string): NodeSpec[] {
    const q = this.q.trim().toLowerCase();
    return (this.catalog()?.nodes ?? []).filter((n) => n.category === cat && (!q || n.label.toLowerCase().includes(q)));
  }

  save() {
    const w = this.wf();
    if (!w) return;
    this.api.updateWorkflow(w.id, { name: this.name }).subscribe((u) => this.wf.set(u));
  }
}
