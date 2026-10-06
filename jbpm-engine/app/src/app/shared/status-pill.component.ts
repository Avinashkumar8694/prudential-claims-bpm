import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-status-pill',
  standalone: true,
  template: `<span class="pill" [style.color]="'var(--status-' + status + ')'" [style.background]="'var(--status-' + status + '-bg)'">{{ status }}</span>`,
})
export class StatusPillComponent {
  @Input({ required: true }) status!: string;
}
