// Workspace team API (server: http/team-routes.ts + tenant-routes.ts). The auth interceptor adds the bearer
// token and the selected workspace's x-tenant-id; the server enforces every rule below — the UI only hides
// what the caller could not do anyway.
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface TeamMember {
  id: string; email?: string; displayName?: string | null; role: string;
  status: 'active' | 'invited' | 'suspended'; userId?: string; joinedAt: string; lastActiveAt?: string;
  invitedBy?: string; invitationExpiresAt?: string | null;
}
export interface InviteResult { member: TeamMember; invitationToken: string; invitationPath: string; expiresAt: string }
export interface InvitationInfo { workspace: { id: string; name: string }; email: string; role: string; expiresAt: string }

@Injectable({ providedIn: 'root' })
export class TeamApiService {
  private http = inject(HttpClient);
  private unwrap = async <T>(p: Promise<{ data: T }>) => (await p).data;

  members() { return this.unwrap(firstValueFrom(this.http.get<{ data: TeamMember[] }>('/api/team/members'))); }
  roles() { return this.unwrap(firstValueFrom(this.http.get<{ data: { roles: string[]; assignableRoles: string[]; permissions: Record<string, string[]> } }>('/api/team/roles'))); }
  invite(email: string, role: string) { return this.unwrap(firstValueFrom(this.http.post<{ data: InviteResult }>('/api/team/members/invite', { email, role }))); }
  resend(id: string) { return this.unwrap(firstValueFrom(this.http.post<{ data: InviteResult }>(`/api/team/members/${id}/resend`, {}))); }
  cancelInvite(id: string) { return firstValueFrom(this.http.delete<void>(`/api/team/members/${id}/invitation`)); }
  update(id: string, patch: { role?: string; status?: string }) { return this.unwrap(firstValueFrom(this.http.put<{ data: TeamMember }>(`/api/team/members/${id}`, patch))); }
  remove(id: string) { return firstValueFrom(this.http.delete<void>(`/api/team/members/${id}`)); }
  leave() { return firstValueFrom(this.http.post<void>('/api/team/leave', {})); }
  transferOwnership(memberId: string) { return firstValueFrom(this.http.post('/api/team/ownership/transfer', { memberId })); }
  lookupInvitation(token: string) { return this.unwrap(firstValueFrom(this.http.get<{ data: InvitationInfo }>(`/api/team/invitations/${encodeURIComponent(token)}`))); }
  acceptInvitation(token: string) { return this.unwrap(firstValueFrom(this.http.post<{ data: { tenantId: string; role: string } }>('/api/team/invitations/accept', { token }))); }
}
