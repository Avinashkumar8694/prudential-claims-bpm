import { Component, inject } from '@angular/core';
import { ToastService } from './toast.service';
import { IconComponent } from '../shared/icon.component';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="toast-stack">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class]="t.kind" (click)="toast.dismiss(t.id)">
          <app-icon class="ic" [name]="t.kind === 'error' ? 'warning' : t.kind === 'success' ? 'success' : 'info'" [size]="15" />
          <span class="msg">{{ t.text }}</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-stack { position: fixed; right: 16px; bottom: 16px; z-index: 1000; display: flex; flex-direction: column; gap: 8px; max-width: 360px; }
    .toast { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: var(--radius, 10px); background: var(--surface, #fff); box-shadow: var(--shadow-pop, 0 8px 24px rgba(16,24,40,.16)); border: 1px solid var(--border, #e5e7eb); cursor: pointer; font-size: 13px; animation: slide-in .15s ease-out; }
    .toast.error { border-left: 3px solid #dc2626; }
    .toast.success { border-left: 3px solid #16a34a; }
    .toast.info { border-left: 3px solid var(--primary, #5b3df5); }
    .ic { flex-shrink: 0; }
    .msg { flex: 1; color: var(--text, #111827); white-space: pre-line; }
    @keyframes slide-in { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  `],
})
export class ToastComponent {
  toast = inject(ToastService);
}
