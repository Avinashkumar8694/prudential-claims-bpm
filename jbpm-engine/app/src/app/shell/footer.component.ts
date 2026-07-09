import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-footer',
  standalone: true,
  template: `
    <footer class="footer">
      <span [class.err]="errors > 0">{{ errors > 0 ? '⚠ ' + errors + ' problem(s)' : '✓ No problems' }}</span>
      <span class="spacer"></span>
      <span class="muted">{{ status }}</span>
    </footer>
  `,
  styles: [`
    .footer { height: var(--footer-h); background: var(--surface); border-top: 1px solid var(--border);
      display: flex; align-items: center; gap: 12px; padding: 0 14px; font-size: 12px; color: var(--muted); }
    .err { color: var(--red); }
  `],
})
export class FooterComponent {
  @Input() errors = 0;
  @Input() status = 'Ready';
}
