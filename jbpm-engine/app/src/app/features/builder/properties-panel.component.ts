import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NODE_SCHEMA, type Field, type Section } from './node-schema';

// Generic, schema-driven property editor. Renders every configurable field for the selected node's
// type (from NODE_SCHEMA) so a node can be fully configured. Emits `changed` on any edit.
@Component({
  selector: 'app-properties-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    @for (sec of sections; track sec.title) {
      <div class="sec">
        <div class="sec-h">{{ sec.title }}</div>
        @for (f of sec.fields; track f.key) {
          <div class="fld">
            <label>{{ f.label }}</label>
            @switch (f.widget) {
              @case ('text') { <input [ngModel]="val(f.key)" (ngModelChange)="set(f.key, $event)" [placeholder]="f.placeholder || ''" /> }
              @case ('number') { <input type="number" [ngModel]="val(f.key)" (ngModelChange)="set(f.key, num($event))" /> }
              @case ('bool') {
                <label class="tog"><input type="checkbox" [ngModel]="!!val(f.key)" (ngModelChange)="set(f.key, $event)" /><span>{{ !!val(f.key) ? 'On' : 'Off' }}</span></label>
              }
              @case ('select') {
                <select [ngModel]="selVal(f)" (ngModelChange)="onSelect(f, $event)">
                  @for (o of f.options; track o) { <option [value]="o">{{ o }}</option> }
                </select>
              }
              @case ('code') { <textarea class="mono" rows="6" [ngModel]="val(f.key)" (ngModelChange)="set(f.key, $event)" [placeholder]="f.placeholder || ''"></textarea> }
              @case ('textarea') { <textarea rows="3" [ngModel]="val(f.key)" (ngModelChange)="set(f.key, $event)" [placeholder]="f.placeholder || ''"></textarea> }
              @case ('stringlist') {
                <div class="list">
                  @for (item of sl[f.key]; track $index) {
                    <div class="lrow"><input [ngModel]="sl[f.key][$index]" (ngModelChange)="sl[f.key][$index] = $event; syncSl(f.key)" />
                      <button class="x" (click)="rmSl(f.key, $index)">✕</button></div>
                  }
                  <button class="add" (click)="addSl(f.key)">+ add</button>
                </div>
              }
              @case ('keyval') {
                <div class="list">
                  @for (row of kv[f.key]; track $index) {
                    <div class="kvrow">
                      <input class="k" placeholder="key" [(ngModel)]="row.k" (ngModelChange)="syncKv(f.key)" />
                      <input class="v" placeholder="value" [(ngModel)]="row.v" (ngModelChange)="syncKv(f.key)" />
                      <button class="x" (click)="rmKv(f.key, $index)">✕</button>
                    </div>
                  }
                  <button class="add" (click)="addKv(f.key)">+ add entry</button>
                </div>
              }
              @case ('nodes') {
                <label class="tog all"><input type="checkbox" [ngModel]="isAll(f.key)" (ngModelChange)="toggleAll(f.key, $event)" /><span>All nodes (process-wide handler)</span></label>
                @if (!isAll(f.key)) {
                  <div class="nodesel">
                    @for (n of attachable(); track n.id) {
                      <label class="tog"><input type="checkbox" [ngModel]="isAttached(f.key, n.id)" (ngModelChange)="toggleAttach(f.key, n.id)" /><span>{{ n.name || n.id }} <em>{{ n.type }}</em></span></label>
                    }
                    @if (attachable().length === 0) { <span class="muted">No other nodes yet.</span> }
                  </div>
                }
              }
              @case ('event') {
                <select [ngModel]="eventKind(f.key)" (ngModelChange)="setKind(f, $event)">
                  @for (k of f.options; track k) { <option [value]="k">{{ k }}</option> }
                </select>
                @switch (eventKind(f.key)) {
                  @case ('signal') { <input class="mt" placeholder="Signal name" [ngModel]="val(f.key + '.signal')" (ngModelChange)="set(f.key + '.signal', $event)" /> }
                  @case ('message') { <input class="mt" placeholder="Message name" [ngModel]="val(f.key + '.message')" (ngModelChange)="set(f.key + '.message', $event)" /> }
                  @case ('error') {
                    <input class="mt" placeholder="Error code (blank = any)" [attr.list]="'engine-errs'" [ngModel]="errText(f.key)" (ngModelChange)="set(f.key + '.error', $event || '*')" />
                    <datalist id="engine-errs">@for (c of errorCodes; track c) { <option [value]="c"></option> }</datalist>
                    <small>Runtime codes: SCRIPT_ERROR, SERVICE_ERROR, RULE_ERROR, CALL_ERROR, RUNTIME_ERROR — or your own from an error-throw end. Blank/“*” = any.</small>
                  }
                  @case ('escalation') { <input class="mt" placeholder="Escalation code" [ngModel]="val(f.key + '.escalation')" (ngModelChange)="set(f.key + '.escalation', $event)" /> }
                  @case ('condition') {
                    <input class="mt" placeholder="Condition expression (JavaScript)" [ngModel]="val(f.key + '.condition')" (ngModelChange)="set(f.key + '.condition', $event); set(f.key + '.lang', 'js')" />
                  }
                  @case ('timer') {
                    <input class="mt" placeholder="Duration e.g. PT5M / P1D" [ngModel]="val(f.key + '.timer.duration')" (ngModelChange)="set(f.key + '.timer.duration', $event)" />
                    <input class="mt" placeholder="Cycle e.g. R/PT1H" [ngModel]="val(f.key + '.timer.cycle')" (ngModelChange)="set(f.key + '.timer.cycle', $event)" />
                    <input class="mt" placeholder="Date (ISO)" [ngModel]="val(f.key + '.timer.date')" (ngModelChange)="set(f.key + '.timer.date', $event)" />
                  }
                }
              }
            }
            @if (f.help) { <small>{{ f.help }}</small> }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .sec { margin-bottom: 4px; }
    .sec-h { font-size: 11px; font-weight: 700; color: #98a2b3; text-transform: uppercase; letter-spacing: .05em; margin: 14px 0 8px; padding-bottom: 5px; border-bottom: 1px solid var(--border); }
    .fld { margin-bottom: 12px; } .fld > label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 5px; }
    input, select, textarea { width: 100%; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; font-size: 13px; font-family: inherit; }
    input:focus, select:focus, textarea:focus { outline: none; border-color: var(--primary); }
    textarea.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    .mt { margin-top: 6px; }
    small { display: block; color: #98a2b3; font-size: 11px; margin-top: 4px; line-height: 1.4; }
    .tog { display: flex; align-items: center; gap: 8px; } .tog input { width: auto; } .tog span { font-size: 13px; }
    .list { display: flex; flex-direction: column; gap: 6px; }
    .lrow, .kvrow { display: flex; gap: 6px; } .kvrow .k { flex: 0 0 40%; } .kvrow .v { flex: 1; }
    .x { flex: 0 0 auto; width: 30px; border: 1px solid var(--border); background: #fff; border-radius: 8px; cursor: pointer; color: var(--muted); }
    .x:hover { background: #fdeaea; color: var(--red); border-color: #f3b4b4; }
    .add { align-self: flex-start; border: 1px dashed var(--border); background: #fff; border-radius: 8px; padding: 5px 10px; font-size: 12px; cursor: pointer; color: var(--muted); }
    .add:hover { border-color: var(--primary); color: var(--primary); }
    .all { padding: 8px 10px; background: #f2f0ff; border-radius: 8px; margin-bottom: 8px; }
    .nodesel { display: flex; flex-direction: column; gap: 5px; max-height: 200px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
    .nodesel em { color: var(--muted); font-style: normal; font-size: 11px; }
  `],
})
export class PropertiesPanelComponent implements OnChanges {
  @Input() node: any;
  @Input() allNodes: { id: string; type: string; name?: string }[] = [];
  @Output() changed = new EventEmitter<void>();
  sections: Section[] = [];
  kv: Record<string, { k: string; v: string }[]> = {};
  sl: Record<string, string[]> = {};
  errorCodes = ['SCRIPT_ERROR', 'SERVICE_ERROR', 'RULE_ERROR', 'CALL_ERROR', 'RUNTIME_ERROR'];

  // nodes-to-catch selector (writes node.on as a string[]; '*' = all)
  attachable() { return (this.allNodes || []).filter((n) => n.id !== this.node?.id && n.type !== 'boundary'); }
  private onArr(path: string): string[] { const v = this.val(path); return Array.isArray(v) ? v : (v ? [v] : []); }
  isAll(path: string) { return this.onArr(path).includes('*'); }
  isAttached(path: string, id: string) { return this.onArr(path).includes(id); }
  toggleAll(path: string, on: boolean) { this.node[path.split('.')[0]] = on ? ['*'] : []; this.changed.emit(); }
  toggleAttach(path: string, id: string) {
    const key = path.split('.')[0]; const arr = this.onArr(path).filter((x) => x !== '*');
    const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); else arr.push(id);
    this.node[key] = arr; this.changed.emit();
  }
  errText(path: string) { const e = this.val(path + '.error'); return e === '*' ? '' : e; }

  ngOnChanges() {
    this.sections = (this.node && NODE_SCHEMA[this.node.type]) || [];
    this.kv = {}; this.sl = {};
    for (const sec of this.sections) for (const f of sec.fields) {
      if (f.widget === 'keyval') this.kv[f.key] = Object.entries(this.val(f.key) || {}).map(([k, v]) => ({ k, v: this.str(v) }));
      if (f.widget === 'stringlist') this.sl[f.key] = [...((this.val(f.key) as string[]) || [])];
    }
  }

  // ---- dotted-path get/set ----
  val(path: string): any { return path.split('.').reduce((c: any, p) => (c == null ? c : c[p]), this.node); }
  set(path: string, value: any) {
    const parts = path.split('.'); let cur = this.node;
    for (let i = 0; i < parts.length - 1; i++) { const p = parts[i]!; if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {}; cur = cur[p]; }
    const last = parts[parts.length - 1]!;
    if (value === '' || value === undefined) delete cur[last]; else cur[last] = value;
    this.changed.emit();
  }
  num(v: any) { const n = Number(v); return Number.isFinite(n) ? n : undefined; }
  str(v: any) { return typeof v === 'object' ? JSON.stringify(v) : String(v); }

  // ---- select (with (normal) sentinel for end.result) ----
  selVal(f: Field) { const v = this.val(f.key); if (f.key === 'result') return v || '(normal)'; return v ?? (f.options?.[0] || ''); }
  onSelect(f: Field, v: string) { if (f.key === 'result') this.set(f.key, v === '(normal)' ? undefined : v); else this.set(f.key, v); }

  // ---- event trigger widget ----
  eventKind(path: string): string {
    const o = this.val(path);
    if (!o || typeof o !== 'object') return 'none';
    for (const k of ['timer', 'signal', 'message', 'error', 'escalation', 'condition']) if (k in o) return k;
    return 'none';
  }
  setKind(f: Field, kind: string) {
    let obj: any;
    switch (kind) {
      case 'none': obj = undefined; break;
      case 'signal': obj = { signal: '' }; break;
      case 'message': obj = { message: '' }; break;
      case 'error': obj = { error: '' }; break;
      case 'escalation': obj = { escalation: '' }; break;
      case 'condition': obj = { condition: '', lang: 'js' }; break;
      case 'timer': obj = { timer: { duration: 'PT5M' } }; break;
    }
    if (obj === undefined) { const parts = f.key.split('.'); const p = parts[0]!; delete this.node[p]; this.changed.emit(); }
    else this.node[f.key] = obj, this.changed.emit();
  }

  // ---- key-value maps ----
  addKv(key: string) { (this.kv[key] ||= []).push({ k: '', v: '' }); }
  rmKv(key: string, i: number) { this.kv[key].splice(i, 1); this.syncKv(key); }
  syncKv(key: string) {
    const obj: Record<string, any> = {};
    for (const r of this.kv[key] || []) if (r.k.trim()) obj[r.k.trim()] = this.coerce(r.v);
    if (Object.keys(obj).length) this.node[key] = obj; else delete this.node[key];
    this.changed.emit();
  }
  coerce(v: string): any {
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if (v === 'true') return true; if (v === 'false') return false;
    return v;
  }

  // ---- string lists ----
  addSl(key: string) { (this.sl[key] ||= []).push(''); }
  rmSl(key: string, i: number) { this.sl[key].splice(i, 1); this.syncSl(key); }
  syncSl(key: string) {
    const arr = (this.sl[key] || []).map((s) => s.trim()).filter(Boolean);
    if (arr.length) this.node[key] = arr; else delete this.node[key];
    this.changed.emit();
  }
}
