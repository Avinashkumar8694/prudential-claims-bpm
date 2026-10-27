import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IamApiService } from '../../core/api/iam-api.service';
import { ToastService } from '../../shared/toast.service';
import { FULL_ACCESS, KNOWN_PERMISSIONS } from './permission-taxonomy';
import type { AppRole } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';

// List+detail split, same convention as Users/Deployments/Instances/Tasks. Permissions are a checkbox
// list of the known taxonomy, never freeform text — the backend does zero validation on permission
// strings, so a typo would silently grant nothing. The 'admin' role is protected server-side (its
// permissions can't change, it can't be deleted) — mirrored here as a disabled state, not re-validated.
@Component({
  selector: 'app-roles-list',
  standalone: true,
  imports: [IconComponent, FormsModule],
  template: `
    <div class="split">
      <div class="list card">
        @if (loading()) {
          <div class="pad"><div class="skeleton skeleton-line" style="width:70%"></div><div class="skeleton skeleton-line" style="width:50%"></div></div>
        } @else if (roles().length === 0) {
          <div class="empty-state"><div class="es-icon"><app-icon name="shield" [size]="24" /></div><h3>No roles yet</h3><p>Create the first one on the right.</p></div>
        } @else {
          <table>
            <thead><tr><th>Role</th><th>Permissions</th></tr></thead>
            <tbody>
              @for (r of roles(); track r.id) {
                <tr (click)="select(r)" [class.sel]="sel()?.id === r.id">
                  <td><b>{{ r.name }}</b> @if (r.name === 'admin') { <span class="badge">protected</span> }</td>
                  <td class="muted">{{ r.permissions.includes('*') ? 'Full access' : (r.permissions.join(', ') || '—') }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>

      <div class="detail card">
        @if (sel(); as r) {
          <div class="d-head"><b>{{ r.name }}</b><span class="spacer"></span>
            @if (r.name !== 'admin') { <button class="btn danger" (click)="remove(r)">Delete role</button> }
            <button class="btn" (click)="deselect()">+ New role</button>
          </div>
          <div class="tabbody">
            @if (r.name === 'admin') {
              <p class="muted">The admin role always has full access and can't be changed.</p>
            } @else {
              <div class="field">
                <label class="chkrow"><input type="checkbox" [checked]="editPerms.includes(full)" (change)="toggleFull()" /> <b>Full access (*)</b></label>
                @if (!editPerms.includes(full)) {
                  @for (p of known; track p.key) {
                    <label class="chkrow"><input type="checkbox" [checked]="editPerms.includes(p.key)" (change)="toggle(p.key)" /> {{ p.label }} <span class="muted sm">({{ p.key }})</span></label>
                  }
                }
              </div>
              <button class="btn primary" (click)="save(r)">Save permissions</button>
            }
          </div>
        } @else {
          <div class="tabbody">
            <h3 class="sec-h">Create role</h3>
            <div class="field"><label>Name</label><input [(ngModel)]="newName" placeholder="role name" #nameInput /></div>
            <div class="field">
              <label class="chkrow"><input type="checkbox" [checked]="newPerms.includes(full)" (change)="toggleNewFull()" /> <b>Full access (*)</b></label>
              @if (!newPerms.includes(full)) {
                @for (p of known; track p.key) {
                  <label class="chkrow"><input type="checkbox" [checked]="newPerms.includes(p.key)" (change)="toggleNew(p.key)" /> {{ p.label }} <span class="muted sm">({{ p.key }})</span></label>
                }
              }
            </div>
            <button class="btn primary" (click)="create()">Create role</button>
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
    .field { margin-bottom: 16px; max-width: 460px; }
    .field label:not(.chkrow) { display: block; font-size: 12px; color: var(--muted); font-weight: 600; margin-bottom: 6px; }
    .field input:not([type=checkbox]) { width: 100%; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; font-size: 13px; margin-bottom: 12px; }
    .chkrow { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 6px; }
    .chkrow input { width: auto; }
    .sec-h { font-size: 13px; margin: 0 0 14px; }
    .sm { font-size: 12px; }
    .btn.danger { color: var(--red); border-color: var(--border-strong); } .btn.danger:hover { background: var(--red-bg); }
  `],
})
export class RolesListComponent {
  private api = inject(IamApiService);
  private toast = inject(ToastService);
  roles = signal<AppRole[]>([]);
  loading = signal(true);
  sel = signal<AppRole | null>(null);
  known = KNOWN_PERMISSIONS;
  full = FULL_ACCESS;

  editPerms: string[] = [];
  newName = ''; newPerms: string[] = [];

  constructor() { this.reload(); }
  reload() {
    this.loading.set(true);
    this.api.listRoles().subscribe({ next: (r) => { this.roles.set(r); this.loading.set(false); }, error: () => this.loading.set(false) });
  }
  select(r: AppRole) { this.sel.set(r); this.editPerms = [...r.permissions]; }
  deselect() { this.sel.set(null); this.newName = ''; this.newPerms = []; }
  toggle(key: string) { const i = this.editPerms.indexOf(key); if (i >= 0) this.editPerms.splice(i, 1); else this.editPerms.push(key); }
  toggleFull() { this.editPerms = this.editPerms.includes(this.full) ? [] : [this.full]; }
  toggleNew(key: string) { const i = this.newPerms.indexOf(key); if (i >= 0) this.newPerms.splice(i, 1); else this.newPerms.push(key); }
  toggleNewFull() { this.newPerms = this.newPerms.includes(this.full) ? [] : [this.full]; }

  create() {
    const name = this.newName.trim();
    if (!name) return this.toast.error('Role name is required');
    this.api.createRole({ name, permissions: this.newPerms }).subscribe({
      next: () => { this.toast.success(`Role "${name}" created`); this.deselect(); this.reload(); },
      error: (e) => this.toast.error(e?.error?.error?.message || 'Could not create role'),
    });
  }
  save(r: AppRole) {
    this.api.updateRolePermissions(r.id, this.editPerms).subscribe({
      next: () => { this.toast.success('Permissions updated'); this.reload(); },
      error: (e) => this.toast.error(e?.error?.error?.message || 'Could not update role'),
    });
  }
  remove(r: AppRole) {
    this.api.deleteRole(r.id).subscribe({
      next: () => { this.toast.success(`Role "${r.name}" deleted`); this.deselect(); this.reload(); },
      error: (e) => this.toast.error(e?.error?.error?.message || 'Could not delete role'),
    });
  }
}
