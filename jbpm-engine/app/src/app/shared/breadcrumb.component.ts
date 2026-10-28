import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface Crumb { label: string; link?: string[]; onClick?: () => void; }

@Component({
  selector: 'app-breadcrumb',
  standalone: true,
  imports: [RouterLink],
  template: `
    <nav class="crumbs" aria-label="Breadcrumb">
      @for (c of crumbs; track $index; let last = $last) {
        @if (c.onClick && !last) {
          <button type="button" class="linklike" (click)="c.onClick()">{{ c.label }}</button>
        } @else if (c.link && !last) {
          <a [routerLink]="c.link">{{ c.label }}</a>
        } @else {
          <span class="cur">{{ c.label }}</span>
        }
        @if (!last) { <span class="sep">›</span> }
      }
    </nav>
  `,
  styles: [`
    .crumbs { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); flex-wrap: wrap; }
    .crumbs a, .linklike { color: var(--muted); }
    .crumbs a:hover, .linklike:hover { color: var(--primary); text-decoration: underline; }
    .linklike { border: none; background: transparent; padding: 0; font: inherit; cursor: pointer; }
    .cur { color: var(--text); font-weight: 600; }
    .sep { color: var(--border); }
  `],
})
export class BreadcrumbComponent {
  @Input() crumbs: Crumb[] = [];
}
