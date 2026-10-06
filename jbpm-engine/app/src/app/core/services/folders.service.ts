import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Folder } from '../models/domain';

@Injectable({ providedIn: 'root' })
export class FoldersService {
  constructor(private http: HttpClient) {}
  list() { return this.http.get<Folder[]>('/api/folders'); }
  get(id: string) { return this.http.get<Folder>(`/api/folders/${id}`); }
  create(name: string, parentId: string | null) { return this.http.post<Folder>('/api/folders', { name, parentId }); }
  rename(id: string, name: string) { return this.http.put<Folder>(`/api/folders/${id}`, { name }); }
  move(id: string, parentId: string | null) { return this.http.put<Folder>(`/api/folders/${id}`, { parentId }); }
  delete(id: string) { return this.http.delete<void>(`/api/folders/${id}`); }
}
