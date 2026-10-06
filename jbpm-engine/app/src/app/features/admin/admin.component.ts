import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IamService } from '../../core/services/iam.service';
import { ToastService } from '../../core/services/toast.service';
import type { Group, Role, User } from '../../core/models/domain';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h1>Admin</h1>
    <p>Users, groups, and roles for this tenant.</p>
    <div class="tabs">
      <button class="tab" [class.active]="tab() === 'users'" (click)="tab.set('users')">Users ({{ users().length }})</button>
      <button class="tab" [class.active]="tab() === 'groups'" (click)="tab.set('groups')">Groups ({{ groups().length }})</button>
      <button class="tab" [class.active]="tab() === 'roles'" (click)="tab.set('roles')">Roles ({{ roles().length }})</button>
    </div>

    @if (tab() === 'users') {
      <div class="newrow">
        <input placeholder="Username" [(ngModel)]="newUsername" />
        <input placeholder="Password" type="password" [(ngModel)]="newPassword" />
        <input placeholder="Roles (comma separated)" [(ngModel)]="newRoles" />
        <button class="btn primary" (click)="createUser()">+ Add user</button>
      </div>
      <table>
        <thead><tr><th>Username</th><th>Roles</th><th>Groups</th><th>Active</th><th></th></tr></thead>
        <tbody>
          @for (u of users(); track u.id) {
            <tr>
              <td>{{ u.username }}</td><td>{{ u.roles.join(', ') }}</td><td>{{ u.groups.join(', ') }}</td>
              <td>{{ u.active ? 'Yes' : 'No' }}</td>
              <td><button class="btn" (click)="toggleActive(u)">{{ u.active ? 'Deactivate' : 'Activate' }}</button></td>
            </tr>
          }
        </tbody>
      </table>
    } @else if (tab() === 'groups') {
      <ul class="list">@for (g of groups(); track g.id) { <li>{{ g.name }}</li> }</ul>
    } @else {
      <table>
        <thead><tr><th>Role</th><th>Permissions</th></tr></thead>
        <tbody>@for (r of roles(); track r.id) { <tr><td>{{ r.name }}</td><td class="mono">{{ r.permissions.join(', ') }}</td></tr> }</tbody>
      </table>
    }
  `,
  styles: [`
    :host { display: block; padding: 28px 32px; }
    h1 { font-size: 22px; } p { color: var(--text-lo); font-size: 13.5px; margin: 4px 0 20px; }
    .tabs { display: flex; gap: 20px; border-bottom: 1px solid var(--border-soft); margin-bottom: 18px; }
    .tab { background: none; border: none; color: var(--text-lo); font-size: 13px; font-weight: 600; padding: 0 0 12px; cursor: pointer; border-bottom: 2px solid transparent; }
    .tab.active { color: var(--text-hi); border-color: var(--violet); }
    .newrow { display: flex; gap: 8px; margin-bottom: 16px; }
    .newrow input { border-radius: var(--radius-sm); border: 1px solid var(--border-soft); background: var(--bg-void); padding: 8px 10px; font-size: 13px; color: var(--text-hi); }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; color: var(--text-faint); padding: 0 12px 10px; }
    td { padding: 10px 12px; font-size: 13px; border-top: 1px solid var(--border-soft); }
    .mono { font-family: var(--font-mono); font-size: 12px; }
    .list { list-style: none; padding: 0; margin: 0; }
    .list li { padding: 10px 12px; font-size: 13px; border-top: 1px solid var(--border-soft); }
  `],
})
export class AdminComponent {
  private svc = inject(IamService);
  private toast = inject(ToastService);
  tab = signal<'users' | 'groups' | 'roles'>('users');
  users = signal<User[]>([]);
  groups = signal<Group[]>([]);
  roles = signal<Role[]>([]);
  newUsername = ''; newPassword = ''; newRoles = '';

  constructor() { this.reload(); }

  private reload(): void {
    this.svc.listUsers().subscribe({ next: (rows) => this.users.set(rows), error: (e) => this.toast.errorFrom(e, 'Admin access required') });
    this.svc.listGroups().subscribe((rows) => this.groups.set(rows));
    this.svc.listRoles().subscribe((rows) => this.roles.set(rows));
  }

  createUser(): void {
    if (!this.newUsername.trim() || !this.newPassword) return;
    const roles = this.newRoles.split(',').map((r) => r.trim()).filter(Boolean);
    this.svc.createUser(this.newUsername.trim(), this.newPassword, roles, []).subscribe({
      next: () => { this.toast.success('User created'); this.newUsername = ''; this.newPassword = ''; this.newRoles = ''; this.reload(); },
      error: (e) => this.toast.errorFrom(e),
    });
  }

  toggleActive(u: User): void {
    this.svc.setActive(u.id, !u.active).subscribe({ next: () => this.reload(), error: (e) => this.toast.errorFrom(e) });
  }
}
