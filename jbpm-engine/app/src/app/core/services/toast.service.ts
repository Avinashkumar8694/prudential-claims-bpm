import { Injectable, signal } from '@angular/core';

export interface Toast { id: number; kind: 'info' | 'success' | 'error'; message: string; }

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  readonly toasts = signal<Toast[]>([]);

  private push(kind: Toast['kind'], message: string): void {
    const id = this.nextId++;
    this.toasts.update((list) => [...list, { id, kind, message }]);
    setTimeout(() => this.dismiss(id), 4500);
  }

  info(message: string): void { this.push('info', message); }
  success(message: string): void { this.push('success', message); }
  error(message: string): void { this.push('error', message); }

  /** Best-effort extraction from an HttpErrorResponse-shaped object. */
  errorFrom(err: unknown, fallback = 'Something went wrong'): void {
    const message = (err as { error?: { error?: string } })?.error?.error || fallback;
    this.push('error', message);
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
