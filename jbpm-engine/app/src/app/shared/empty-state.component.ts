import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  template: `
    <div class="empty">
      <div class="icon">{{ icon }}</div>
      <h3>{{ title }}</h3>
      @if (body) { <p>{{ body }}</p> }
      <ng-content />
    </div>
  `,
  styles: [`
    .empty { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 60px 20px; color: var(--text-lo); }
    .icon {
      width: 48px; height: 48px; border-radius: 14px; background: var(--grad-brand); color: #fff;
      display: flex; align-items: center; justify-content: center; font-size: 20px; margin-bottom: 16px;
    }
    h3 { font-size: 15px; color: var(--text-hi); margin-bottom: 6px; }
    p { font-size: 13px; max-width: 42ch; }
  `],
})
export class EmptyStateComponent {
  @Input() icon = '◇';
  @Input() title = 'Nothing here yet';
  @Input() body = '';
}
