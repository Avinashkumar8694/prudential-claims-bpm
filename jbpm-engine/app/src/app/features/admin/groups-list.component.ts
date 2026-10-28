import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IamApiService } from '../../core/api/iam-api.service';
import { ToastService } from '../../shared/toast.service';
import type { AppGroup } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';

// List+detail split, same convention as the other Admin pages. Groups are create/delete only — the
// backend has no rename/update endpoint, so the detail pane is read-only + Delete, not an edit form.
@Component({
  selector: 'app-groups-list',
  standalone: true,
  imports: [IconComponent, FormsModule],
  template: `
    <div class="split">
      <div class="list card">
        @if (loading()) {
          <div class="pad"><div class="skeleton skeleton-line" style="width:60%"></div><div class="skeleton skeleton-line" style="width:40%"></div></div>
        } @else if (groups().length === 0) {
          <div class="empty-state"><div class="es-icon"><app-icon name="users" [size]="24" /></div><h3>No groups yet</h3><p>Create the first one on the right — groups gate who can claim group-scoped tasks.</p></div>
        } @else {
          <table>
            <thead><tr><th>Name</th><th>Description</th></tr></thead>
            <tbody>
              @for (g of groups(); track g.id) {
                <tr (click)="select(g)" [class.sel]="sel()?.id === g.id">
                  <td><b>{{ g.name }}</b></td>
                  <td class="muted">{{ g.description || '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>

      <div class="detail card">
        @if (sel(); as g) {
          <div class="d-head"><b>{{ g.name }}</b><span class="spacer"></span>
            <button class="btn danger" (click)="remove(g)">Delete group</button>
            <button class="btn" (click)="deselect()">+ New group</button>
          </div>
          <div class="tabbody">
            <table class="kv"><tbody>
              <tr><td class="k">Name</td><td>{{ g.name }}</td></tr>
              <tr><td class="k">Description</td><td>{{ g.description || '—' }}</td></tr>
            </tbody></table>
            <p class="hint">Groups have no separate rename/edit — delete and recreate if the name needs to change (existing task/userTask group references by name will stop matching until updated).</p>
          </div>
        } @else {
          <div class="tabbody">
            <h3 class="sec-h">Create group</h3>
            <div class="field"><label>Name</label><input [(ngModel)]="newName" placeholder="e.g. hr-approvers" /></div>
            <div class="field"><label>Description</label><input [(ngModel)]="newDescription" placeholder="optional" /></div>
            <button class="btn primary" (click)="create()">Create group</button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .split { display: grid; grid-template-columns: minmax(360px, 480px) 1fr; gap: 16px; align-items: start; }
    .list tr { cursor: pointer; } .list tbody tr:hover { background: var(--surface-2); } .list tr.sel td { background: var(--primary-50); }
    .d-head { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
    .tabbody { padding: 14px 16px; }
    .pad { padding: 14px; }
    .field { margin-bottom: 16px; max-width: 420px; }
    .field label { display: block; font-size: 12px; color: var(--muted); font-weight: 600; margin-bottom: 6px; }
    .field input { width: 100%; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; font-size: 13px; }
    .kv { width: 100%; margin-bottom: 14px; } .kv td { padding: 7px 12px; border-bottom: 1px solid var(--border); font-size: 13px; } .kv .k { color: var(--muted); width: 30%; }
    .hint { color: var(--muted); font-size: 12px; }
    .sec-h { font-size: 13px; margin: 0 0 14px; }
    .btn.danger { color: var(--red); border-color: var(--border-strong); } .btn.danger:hover { background: var(--red-bg); }
  `],
})
export class GroupsListComponent {
  private api = inject(IamApiService);
  private toast = inject(ToastService);
  groups = signal<AppGroup[]>([]);
  loading = signal(true);
  sel = signal<AppGroup | null>(null);
  newName = ''; newDescription = '';

  constructor() { this.reload(); }
  reload() {
    this.loading.set(true);
    this.api.listGroups().subscribe({ next: (g) => { this.groups.set(g); this.loading.set(false); }, error: () => this.loading.set(false) });
  }
  select(g: AppGroup) { this.sel.set(g); }
  deselect() { this.sel.set(null); this.newName = ''; this.newDescription = ''; }
  create() {
    const name = this.newName.trim();
    if (!name) return this.toast.error('Group name is required');
    this.api.createGroup({ name, description: this.newDescription.trim() || undefined }).subscribe({
      next: () => { this.toast.success(`Group "${name}" created`); this.deselect(); this.reload(); },
      error: (e) => this.toast.error(e?.error?.error?.message || 'Could not create group'),
    });
  }
  remove(g: AppGroup) {
    this.api.deleteGroup(g.id).subscribe({
      next: () => { this.toast.success(`Group "${g.name}" deleted`); this.deselect(); this.reload(); },
      error: (e) => this.toast.error(e?.error?.error?.message || 'Could not delete group'),
    });
  }
}
