import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import type { Problem } from '../../core/models';

// Collapsible problems strip (like a designer's "Problems" view). Click a problem to jump to its node.
@Component({
  selector: 'app-problems-panel',
  standalone: true,
  template: `
    <div class="problems" [class.collapsed]="collapsed()">
      <div class="ph" (click)="collapsed.set(!collapsed())">
        <span class="chev">{{ collapsed() ? '▸' : '▾' }}</span>
        <span class="lbl">Problems</span>
        @if (errorCount) { <span class="pill err">{{ errorCount }} error{{ errorCount === 1 ? '' : 's' }}</span> }
        @if (warnCount) { <span class="pill warn">{{ warnCount }} warning{{ warnCount === 1 ? '' : 's' }}</span> }
        @if (!errorCount && !warnCount) { <span class="pill ok">✓ No problems</span> }
      </div>
      @if (!collapsed() && problems.length) {
        <div class="plist">
          @for (p of problems; track $index) {
            <div class="prow" [class.err]="p.severity === 'error'" (click)="pick.emit(p.nodeId || p.flowId || '')">
              <span class="ic">{{ p.severity === 'error' ? '⛔' : '⚠️' }}</span>
              <span class="msg">{{ p.message }}</span>
              <span class="rule">{{ p.rule }}</span>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .problems { border-top: 1px solid var(--border); background: var(--surface); max-height: 200px; display: flex; flex-direction: column; }
    .problems.collapsed { max-height: 34px; }
    .ph { display: flex; align-items: center; gap: 8px; padding: 8px 14px; cursor: pointer; font-size: 13px; user-select: none; }
    .chev { color: var(--muted); width: 12px; } .lbl { font-weight: 600; }
    .pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
    .pill.err { background: #fdeaea; color: var(--red); } .pill.warn { background: #fef3e2; color: #b45309; } .pill.ok { background: #e7f7ee; color: var(--green); }
    .plist { overflow: auto; }
    .prow { display: flex; align-items: center; gap: 10px; padding: 7px 14px; border-top: 1px solid #f1f2f6; cursor: pointer; font-size: 13px; }
    .prow:hover { background: #f8f9fc; }
    .ic { flex: 0 0 auto; } .msg { flex: 1; } .rule { color: var(--muted); font-size: 11px; font-family: ui-monospace, Menlo, monospace; }
  `],
})
export class ProblemsPanelComponent {
  @Input() problems: Problem[] = [];
  @Input() errorCount = 0;
  @Input() warnCount = 0;
  @Output() pick = new EventEmitter<string>();
  collapsed = signal(false);
}
