// Minimal toast queue — pulled forward from Phase 4 because the auth interceptor needs SOME way to
// surface a 403 that isn't a native alert() (the thing Phase 4 is otherwise dedicated to removing).
// Phase 4 extends this (more polish, more call sites); this is the smallest useful version.
import { Injectable, signal } from '@angular/core';

export interface ToastMsg { id: number; kind: 'error' | 'info' | 'success'; text: string; }

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 0;
  toasts = signal<ToastMsg[]>([]);

  error(text: string) { this.push('error', text); }
  info(text: string) { this.push('info', text); }
  success(text: string) { this.push('success', text); }

  dismiss(id: number) { this.toasts.update((list) => list.filter((t) => t.id !== id)); }

  private push(kind: ToastMsg['kind'], text: string) {
    // A 403 commonly gets reported twice — once by the global auth interceptor's fallback handler,
    // once by the specific component's own error callback — with the identical server-provided
    // message both times. Skip the duplicate rather than stacking two toasts for one failure.
    if (this.toasts().some((t) => t.kind === kind && t.text === text)) return;
    const id = ++this.nextId;
    this.toasts.update((list) => [...list, { id, kind, text }]);
    setTimeout(() => this.dismiss(id), 5000);
  }
}
