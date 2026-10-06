import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../core/services/settings.service';
import { ToastService } from '../../core/services/toast.service';
import type { SystemSettings } from '../../core/models/domain';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h1>Settings</h1>
    <p>System-wide defaults for this tenant.</p>
    @if (settings(); as s) {
      <div class="grid">
        <div class="field"><label>Default page size</label><input type="number" [(ngModel)]="s.defaultPageSize" /></div>
        <div class="field"><label>Instance retention (days)</label><input type="number" [(ngModel)]="s.instanceRetentionDays" /></div>
        <div class="field"><label>Audit retention (days)</label><input type="number" [(ngModel)]="s.auditRetentionDays" /></div>
        <div class="field"><label>Executor interval (seconds)</label><input type="number" [(ngModel)]="s.executorIntervalSeconds" /></div>
        <div class="field"><label>SLA warn threshold (%)</label><input type="number" [(ngModel)]="s.slaWarnThresholdPct" /></div>
        <div class="field"><label>Session timeout (hours)</label><input type="number" [(ngModel)]="s.sessionTimeoutHours" /></div>
        <label class="checkbox"><input type="checkbox" [(ngModel)]="s.allowRunningVariableEdits" /> Allow editing variables on running instances</label>
        <label class="checkbox"><input type="checkbox" [(ngModel)]="s.emailEnabled" /> Email notifications enabled</label>
      </div>
      <button class="btn primary" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save changes' }}</button>
    }
  `,
  styles: [`
    :host { display: block; padding: 28px 32px; }
    h1 { font-size: 22px; } p { color: var(--text-lo); font-size: 13.5px; margin: 4px 0 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; max-width: 720px; margin-bottom: 20px; }
    .checkbox { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-lo); }
    .checkbox input { width: auto; }
  `],
})
export class SettingsComponent {
  private svc = inject(SettingsService);
  private toast = inject(ToastService);
  settings = signal<SystemSettings | undefined>(undefined);
  saving = signal(false);

  constructor() {
    this.svc.get().subscribe({ next: (s) => this.settings.set(s), error: (e) => this.toast.errorFrom(e) });
  }

  save(): void {
    const s = this.settings();
    if (!s) return;
    this.saving.set(true);
    this.svc.update(s).subscribe({
      next: (updated) => { this.settings.set(updated); this.saving.set(false); this.toast.success('Settings saved'); },
      error: (e) => { this.saving.set(false); this.toast.errorFrom(e); },
    });
  }
}
