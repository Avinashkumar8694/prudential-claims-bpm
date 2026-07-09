import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { JsonPipe, SlicePipe } from '@angular/common';
import { ApiService } from '../../core/api.service';
import type { Instance } from '../../core/models';

@Component({
  selector: 'app-instances',
  standalone: true,
  imports: [RouterLink, JsonPipe, SlicePipe],
  template: `
    <div class="page">
      <header class="pagehead">
        <a class="btn ghost" routerLink="/workflows">‹ Apps</a>
        <h1>Instances</h1>
        <span class="spacer"></span>
        <button class="btn" (click)="reload()">Refresh</button>
      </header>

      @if (instances().length === 0) { <p class="muted">No instances. Start one from an active deployment.</p> }
      @else {
        <div class="split">
          <table>
            <thead><tr><th>Instance</th><th>Status</th><th>Started</th><th>Nodes visited</th></tr></thead>
            <tbody>
              @for (i of instances(); track i.id) {
                <tr (click)="select(i)" [class.sel]="selected()?.id === i.id">
                  <td class="muted">{{ i.id | slice:0:10 }}…</td>
                  <td><span class="badge" [class.active]="i.status==='completed'">{{ i.status }}</span></td>
                  <td class="muted">{{ i.startedAt | slice:0:19 }}</td>
                  <td class="muted">{{ i.history.length }}</td>
                </tr>
              }
            </tbody>
          </table>

          @if (selected(); as sel) {
            <aside class="detail card">
              <h3>Instance {{ sel.id | slice:0:10 }}…</h3>
              <div class="kv"><span class="muted">Status</span><span class="badge" [class.active]="sel.status==='completed'">{{ sel.status }}</span></div>
              <h4>Execution history</h4>
              <ol class="timeline">
                @for (h of sel.history; track $index) {
                  <li><span class="dot"></span><b>{{ h.nodeId }}</b> <span class="muted">({{ h.type }})</span> <span class="muted">→ {{ h.outcome }}</span></li>
                }
              </ol>
              <h4>Variables</h4>
              <pre class="vars">{{ sel.variables | json }}</pre>
              @if (sel.status !== 'completed' && sel.status !== 'aborted') { <button class="btn" (click)="abort(sel)">Abort</button> }
            </aside>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px 28px; }
    .pagehead { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
    h1 { font-size: 20px; margin: 0; }
    .split { display: grid; grid-template-columns: 1fr 360px; gap: 16px; align-items: start; }
    tr { cursor: pointer; }
    tr.sel td { background: #f2f0ff; }
    .detail { padding: 16px; }
    .detail h3 { margin: 0 0 12px; }
    .detail h4 { margin: 16px 0 6px; font-size: 13px; color: var(--muted); }
    .kv { display: flex; justify-content: space-between; }
    .timeline { list-style: none; padding: 0; margin: 0; }
    .timeline li { padding: 4px 0 4px 16px; position: relative; font-size: 13px; }
    .dot { position: absolute; left: 0; top: 9px; width: 8px; height: 8px; border-radius: 50%; background: var(--primary); }
    .vars { background: #0f172a; color: #e2e8f0; padding: 10px; border-radius: 8px; font-size: 12px; overflow: auto; max-height: 200px; }
  `],
})
export class InstancesComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  wfId = this.route.snapshot.paramMap.get('id');
  instances = signal<Instance[]>([]);
  selected = signal<Instance | null>(null);

  constructor() { this.reload(); }
  reload() { if (this.wfId) this.api.listInstances(this.wfId).subscribe((i) => this.instances.set(i)); }
  select(i: Instance) { this.api.getInstance(i.id).subscribe((full) => this.selected.set(full)); }
  abort(i: Instance) { this.api.abort(i.id).subscribe(() => { this.reload(); this.select(i); }); }
}
