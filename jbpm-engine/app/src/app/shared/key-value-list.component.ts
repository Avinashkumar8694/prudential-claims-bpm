import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../shared/icon.component';

export interface KVPair { key: string; value: string; }

// Generic key/value editor — used for task-completion outputs and anywhere else a freeform record needs
// hand-authoring. Supports [(pairs)] two-way binding.
@Component({
  selector: 'app-key-value-list',
  standalone: true,
  imports: [IconComponent, FormsModule],
  template: `
    <div class="kvl">
      @for (p of pairs; track $index) {
        <div class="kvrow">
          <input placeholder="key" [(ngModel)]="p.key" (ngModelChange)="emit()" />
          <input placeholder="value" [(ngModel)]="p.value" (ngModelChange)="emit()" />
          <button type="button" class="x" (click)="remove($index)" aria-label="Remove"><app-icon name="close" [size]="13" /></button>
        </div>
      }
      <button type="button" class="add" (click)="add()">+ add field</button>
    </div>
  `,
  styles: [`
    .kvrow { display: flex; gap: 8px; margin-bottom: 8px; }
    .kvrow input { flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; font-size: 13px; }
    .x { width: 32px; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; cursor: pointer; color: var(--muted); }
    .add { border: 1px dashed var(--border); background: var(--surface); border-radius: 8px; padding: 7px 12px; font-size: 13px; cursor: pointer; color: var(--muted); }
  `],
})
export class KeyValueListComponent {
  @Input() pairs: KVPair[] = [];
  @Output() pairsChange = new EventEmitter<KVPair[]>();

  add() { this.pairs = [...this.pairs, { key: '', value: '' }]; this.emit(); }
  remove(i: number) { this.pairs = this.pairs.filter((_, idx) => idx !== i); this.emit(); }
  emit() { this.pairsChange.emit(this.pairs); }
}

export function pairsToRecord(pairs: KVPair[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of pairs) {
    const k = p.key.trim();
    if (!k) continue;
    try { out[k] = JSON.parse(p.value); } catch { out[k] = p.value; }
  }
  return out;
}
