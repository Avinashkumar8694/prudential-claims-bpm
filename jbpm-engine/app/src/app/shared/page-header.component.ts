import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-page-header',
  standalone: true,
  template: `
    <div class="header">
      <div>
        <h1>{{ title }}</h1>
        @if (subtitle) { <p>{{ subtitle }}</p> }
      </div>
      <div class="actions"><ng-content /></div>
    </div>
  `,
  styles: [`
    .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 28px 32px 20px; flex-wrap: wrap; }
    h1 { font-size: 22px; }
    p { color: var(--text-lo); font-size: 13.5px; margin-top: 4px; }
    .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  `],
})
export class PageHeaderComponent {
  @Input() title = '';
  @Input() subtitle = '';
}
