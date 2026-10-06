import { Component, inject } from '@angular/core';
import { ToastService } from '../core/services/toast.service';

@Component({
  selector: 'app-toast-host',
  standalone: true,
  template: `
    <div class="toasts">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class]="t.kind" (click)="toast.dismiss(t.id)">
          <span class="dot"></span>
          <span>{{ t.message }}</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .toasts { position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 1000; max-width: 340px; }
    .toast {
      display: flex; align-items: center; gap: 9px;
      background: var(--bg-surface); border: 1px solid var(--border-soft); border-radius: var(--radius-sm);
      padding: 11px 14px; font-size: 13px; color: var(--text-hi); cursor: pointer;
      box-shadow: var(--shadow-shell);
      animation: slide-in .18s ease-out;
    }
    .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
    .toast.info .dot { background: var(--info); }
    .toast.success .dot { background: var(--good); }
    .toast.error .dot { background: var(--bad); }
    @keyframes slide-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  `],
})
export class ToastHostComponent {
  toast = inject(ToastService);
}
