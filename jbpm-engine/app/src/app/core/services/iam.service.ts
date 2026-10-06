import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Group, Role, User } from '../models/domain';

@Injectable({ providedIn: 'root' })
export class IamService {
  constructor(private http: HttpClient) {}
  listUsers() { return this.http.get<User[]>('/api/iam/users'); }
  createUser(username: string, password: string, roles: string[], groups: string[]) {
    return this.http.post<User>('/api/iam/users', { username, password, roles, groups });
  }
  setActive(id: string, active: boolean) { return this.http.put<User>(`/api/iam/users/${id}/active`, { active }); }
  listGroups() { return this.http.get<Group[]>('/api/iam/groups'); }
  listRoles() { return this.http.get<Role[]>('/api/iam/roles'); }
}
