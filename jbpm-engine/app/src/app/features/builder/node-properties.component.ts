import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { EngineNode, EngineProcess, NodeDef, UiField } from '../../core/models/engine';

const EVENT_KINDS = ['timer', 'message', 'signal', 'error', 'escalation', 'condition', 'compensation'] as const;

// Schema-driven: every field this panel renders comes from the node's own NodeDef.schema (fetched from
// GET /api/node-defs, the SAME catalog the factory registry validated at boot) — never a hand-written
// per-type form. Adding a new node type on the backend needs zero changes here.
@Component({
  selector: 'app-node-properties',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @for (section of def?.schema ?? []; track section.title) {
      <div class="section">
        <div class="sectitle">{{ section.title }}</div>
        @for (field of section.fields; track field.key) {
          <div class="field">
            <label>{{ field.label }}@if (field.required) {<span class="req">*</span>}</label>

            @switch (field.widget) {
              @case ('text') { <input [ngModel]="get(field.key)" (ngModelChange)="set(field.key, $event)" [placeholder]="field.placeholder || ''" /> }
              @case ('number') { <input type="number" [ngModel]="get(field.key)" (ngModelChange)="set(field.key, $event === '' ? undefined : +$event)" /> }
              @case ('bool') { <label class="checkbox"><input type="checkbox" [ngModel]="!!get(field.key)" (ngModelChange)="set(field.key, $event)" /> Enabled</label> }
              @case ('select') {
                <select [ngModel]="get(field.key)" (ngModelChange)="set(field.key, $event)">
                  @for (opt of field.options ?? []; track opt) { <option [value]="opt">{{ opt }}</option> }
                </select>
              }
              @case ('textarea') { <textarea rows="3" [ngModel]="get(field.key)" (ngModelChange)="set(field.key, $event)" [placeholder]="field.placeholder || ''"></textarea> }
              @case ('code') { <textarea class="mono" rows="5" [ngModel]="get(field.key)" (ngModelChange)="set(field.key, $event)" [placeholder]="field.placeholder || ''"></textarea> }
              @case ('stringlist') {
                <input [ngModel]="(get(field.key) ?? []).join(', ')" (ngModelChange)="setList(field.key, $event)" placeholder="comma, separated, values" />
              }
              @case ('keyval') {
                @for (row of keyvalRows(field.key); track row.k; let i = $index) {
                  <div class="kvrow">
                    <input placeholder="key" [ngModel]="row.k" (ngModelChange)="renameKvKey(field.key, i, $event)" />
                    <input placeholder="value" [ngModel]="row.v" (ngModelChange)="setKvValue(field.key, row.k, $event)" />
                    <button class="kvdel" (click)="removeKv(field.key, row.k)">×</button>
                  </div>
                }
                <button class="btn addrow" (click)="addKv(field.key)">+ Add</button>
              }
              @case ('nodes') {
                <div class="nodelist">
                  <label class="checkbox"><input type="checkbox" [ngModel]="isAllNodes(field.key)" (ngModelChange)="toggleAllNodes(field.key)" /> All nodes (*)</label>
                  @if (!isAllNodes(field.key)) {
                    @for (n of otherNodes(); track n.id) {
                      <label class="checkbox"><input type="checkbox" [ngModel]="isNodeOn(field.key, n.id)" (ngModelChange)="toggleNodeOn(field.key, n.id)" /> {{ n['name'] || n.id }}</label>
                    }
                  }
                </div>
              }
              @case ('timer') { <ng-container [ngTemplateOutlet]="timerTpl" [ngTemplateOutletContext]="{ key: field.key }" /> }
              @case ('event') { <ng-container [ngTemplateOutlet]="eventTpl" [ngTemplateOutletContext]="{ field: field }" /> }
              @case ('eventSubError') {
                <input [ngModel]="get('on')?.error" (ngModelChange)="setSubError($event)" placeholder="error code (blank = any)" />
              }
              @default { <input [ngModel]="get(field.key)" (ngModelChange)="set(field.key, $event)" placeholder="(assetRef/processRef/varRef — plain reference)" /> }
            }
            @if (field.help) { <div class="help">{{ field.help }}</div> }
          </div>
        }
      </div>
    }

    <ng-template #timerTpl let-key="key">
      <div class="timerbox">
        <select [ngModel]="timerKind(key)" (ngModelChange)="setTimerKind(key, $event)">
          <option value="duration">Duration</option><option value="cycle">Cycle</option><option value="date">Date</option>
        </select>
        <input [ngModel]="timerValue(key)" (ngModelChange)="setTimerValue(key, $event)"
               [placeholder]="timerKind(key) === 'cycle' ? 'R3/PT1H' : timerKind(key) === 'date' ? '2026-01-01T00:00:00Z' : 'PT30M'" />
      </div>
    </ng-template>

    <ng-template #eventTpl let-field="field">
      <select [ngModel]="eventKind" (ngModelChange)="setEventKind($event)">
        <option value="">— pick —</option>
        @for (k of field.options; track k) { <option [value]="k">{{ k }}</option> }
      </select>
      @switch (eventKind) {
        @case ('message') { <input [ngModel]="eventNode()['message']" (ngModelChange)="setEventProp('message', $event)" placeholder="message name" /> }
        @case ('signal') { <input [ngModel]="eventNode()['signal']" (ngModelChange)="setEventProp('signal', $event)" placeholder="signal name" /> }
        @case ('error') { <input [ngModel]="eventNode()['error']" (ngModelChange)="setEventProp('error', $event)" placeholder="error code (blank = any)" /> }
        @case ('escalation') { <input [ngModel]="eventNode()['escalation']" (ngModelChange)="setEventProp('escalation', $event)" placeholder="escalation code" /> }
        @case ('condition') {
          <textarea class="mono" rows="3" [ngModel]="eventNode()['condition']" (ngModelChange)="setEventProp('condition', $event)" placeholder="amount > 1000"></textarea>
          <select [ngModel]="eventNode()['lang'] || 'js'" (ngModelChange)="setEventProp('lang', $event)"><option value="js">js</option><option value="java">java</option></select>
        }
        @case ('timer') { <ng-container [ngTemplateOutlet]="timerTpl" [ngTemplateOutletContext]="{ key: '__event_timer' }" /> }
        @case ('compensation') { <span class="help">Runs when a compensation throw targets this node's host.</span> }
      }
      @if (eventKind === 'message' || eventKind === 'signal') {
        <input [ngModel]="eventNode()['correlationKey']" (ngModelChange)="setEventProp('correlationKey', $event)" placeholder="correlationKey (optional, e.g. $claimId)" />
      }
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .section { margin-bottom: 4px; }
    .sectitle { font-size: 10.5px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .05em; margin: 12px 0 8px; }
    .sectitle:first-child { margin-top: 0; }
    .field { margin-bottom: 10px; }
    label { display: block; font-size: 10.5px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
    .req { color: var(--bad); margin-left: 2px; }
    input, select, textarea {
      width: 100%; font-size: 12.5px; background: var(--bg-void); border: 1px solid var(--border-soft);
      border-radius: 7px; padding: 6px 9px; color: var(--text-hi); font-family: inherit;
    }
    textarea.mono, input.mono { font-family: var(--font-mono); }
    .checkbox { display: flex; align-items: center; gap: 7px; font-size: 12px; text-transform: none; letter-spacing: 0; color: var(--text-hi); margin-bottom: 4px; }
    .checkbox input { width: auto; }
    .help { font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.4; }
    .kvrow { display: flex; gap: 4px; margin-bottom: 4px; }
    .kvdel { background: none; border: none; color: var(--text-faint); cursor: pointer; font-size: 15px; width: 20px; }
    .addrow { font-size: 11.5px; padding: 5px 10px; }
    .nodelist { max-height: 140px; overflow-y: auto; }
    .timerbox { display: flex; gap: 6px; }
    .timerbox select { flex: none; width: 90px; }
  `],
})
export class NodePropertiesComponent {
  @Input({ required: true }) node!: EngineNode;
  @Input() def: NodeDef | undefined;
  @Input({ required: true }) process!: EngineProcess;
  @Output() changed = new EventEmitter<void>();

  eventKind = '';

  ngOnChanges(): void {
    this.eventKind = this.detectEventKind();
  }

  get(key: string): any { return (this.node as any)[key]; }
  set(key: string, value: any): void { (this.node as any)[key] = value; this.changed.emit(); }
  setList(key: string, csv: string): void { this.set(key, csv.split(',').map((s) => s.trim()).filter(Boolean)); }

  // ---- keyval ----
  keyvalRows(key: string): { k: string; v: unknown }[] {
    const obj = this.get(key) || {};
    return Object.entries(obj).map(([k, v]) => ({ k, v }));
  }
  addKv(key: string): void {
    const obj = { ...(this.get(key) || {}) };
    let n = 'key', i = 1;
    while (n in obj) n = `key${i++}`;
    obj[n] = '';
    this.set(key, obj);
  }
  setKvValue(key: string, k: string, v: string): void {
    const obj = { ...(this.get(key) || {}) };
    obj[k] = v;
    this.set(key, obj);
  }
  renameKvKey(key: string, index: number, newKey: string): void {
    const rows = this.keyvalRows(key);
    const obj: Record<string, unknown> = {};
    rows.forEach((r, i) => { obj[i === index ? newKey : r.k] = r.v; });
    this.set(key, obj);
  }
  removeKv(key: string, k: string): void {
    const obj = { ...(this.get(key) || {}) };
    delete obj[k];
    this.set(key, obj);
  }

  // ---- nodes (boundary's "on") ----
  otherNodes(): EngineNode[] { return this.process.nodes.filter((n) => n.id !== this.node.id); }
  isAllNodes(key: string): boolean { return this.get(key) === '*'; }
  toggleAllNodes(key: string): void { this.set(key, this.isAllNodes(key) ? [] : '*'); }
  isNodeOn(key: string, id: string): boolean {
    const on = this.get(key);
    return Array.isArray(on) ? on.includes(id) : on === id;
  }
  toggleNodeOn(key: string, id: string): void {
    const on = this.get(key);
    const list = Array.isArray(on) ? [...on] : (on && on !== '*' ? [on] : []);
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.push(id);
    this.set(key, list);
  }

  // ---- timer (TimerSpec: {duration?|cycle?|date?}) ----
  private timerSpec(key: string): Record<string, string> {
    if (key === '__event_timer') return (this.get('event') || {}).timer || {};
    const v = this.get(key);
    return typeof v === 'object' && v ? v : {};
  }
  private setTimerSpec(key: string, spec: Record<string, string>): void {
    if (key === '__event_timer') { this.setEventProp('timer', spec); return; }
    this.set(key, spec);
  }
  timerKind(key: string): 'duration' | 'cycle' | 'date' {
    const spec = this.timerSpec(key);
    return spec['cycle'] ? 'cycle' : spec['date'] ? 'date' : 'duration';
  }
  timerValue(key: string): string {
    const spec = this.timerSpec(key);
    return spec['cycle'] ?? spec['date'] ?? spec['duration'] ?? '';
  }
  setTimerKind(key: string, kind: 'duration' | 'cycle' | 'date'): void {
    const value = this.timerValue(key);
    this.setTimerSpec(key, { [kind]: value });
  }
  setTimerValue(key: string, value: string): void {
    this.setTimerSpec(key, { [this.timerKind(key)]: value });
  }

  // ---- event (EventDef, polymorphic) ----
  eventNode(): any { return this.get('event') || {}; }
  private detectEventKind(): string {
    const ev = this.get('event') || this.get('on');
    if (!ev || typeof ev !== 'object') return '';
    return EVENT_KINDS.find((k) => k in ev) || '';
  }
  setEventKind(kind: string): void {
    this.eventKind = kind;
    const key = this.def?.schema.flatMap((s) => s.fields).find((f) => f.widget === 'event')?.key ?? 'event';
    if (!kind) { this.set(key, {}); return; }
    const seed = kind === 'compensation' ? { compensation: true } : kind === 'timer' ? { timer: { duration: 'PT30M' } } : kind === 'condition' ? { condition: '', lang: 'js' } : { [kind]: '' };
    this.set(key, seed);
  }
  setEventProp(prop: string, value: unknown): void {
    const key = this.def?.schema.flatMap((s) => s.fields).find((f) => f.widget === 'event')?.key ?? 'event';
    this.set(key, { ...this.eventNode(), [prop]: value });
  }

  // ---- eventSubError (subprocess's on.error, mirrored onto its inner error-start node) ----
  setSubError(value: string): void {
    const on = { ...(this.get('on') || {}), error: value };
    this.set('on', on);
    const nodes = (this.node as any).nodes as EngineNode[] | undefined;
    const inner = nodes?.find((n) => n['type'] === 'start' && n['on'] && 'error' in (n['on'] as any));
    if (inner) { (inner['on'] as any).error = value; }
  }
}
