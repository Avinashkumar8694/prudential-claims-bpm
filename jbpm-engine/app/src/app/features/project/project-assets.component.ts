import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProjectContextService } from './project-context.service';
import { ToastService } from '../../shared/toast.service';
import { ModalService } from '../../shared/modal.service';
import { IconComponent } from '../../shared/icon.component';
import { AssetFieldsComponent } from './asset-fields.component';

interface ExtraField { key: string; label: string; type: 'text' | 'number'; placeholder?: string; }

// Each kind's only real schema is its seed() shape on the backend (src/assets/*/def.ts) — these extra
// fields mirror that shape exactly, dot-paths nest (e.g. forms' 'model.className' → { model: { className } }).
// Kinds not listed here (decisions, enumerations, types, messages) only take the name/nameField itself;
// their seed shape is either just a name or starts with empty arrays/objects there's no useful upfront field for.
const EXTRA_FIELDS: Record<string, ExtraField[]> = {
  forms: [{ key: 'model.className', label: 'Backing class', type: 'text', placeholder: 'com.acme.ClaimIntake' }],
  guidedTables: [{ key: 'fact', label: 'Fact type', type: 'text', placeholder: 'Claim' }],
  decisionTrees: [{ key: 'fact', label: 'Fact type', type: 'text', placeholder: 'Claim' }],
  scorecards: [
    { key: 'fact', label: 'Fact type', type: 'text', placeholder: 'Claim' },
    { key: 'baseline', label: 'Baseline score', type: 'number', placeholder: '0' },
    { key: 'target', label: 'Target field', type: 'text', placeholder: 'score' },
  ],
  tests: [{ key: 'target', label: 'Target process/decision', type: 'text' }],
};

interface AssetRow { kind: string; kindLabel: string; name: string; usedBy: number; }

/**
 * Asset library (ux_design/mockups/assets-overview.html): kind sidebar with counts + search, a list
 * table, and a detail view with the "referenced by" panel that makes deletion safe, plus a structured
 * per-kind configuration editor (AssetFieldsComponent) — one schema per kind matching exactly what its
 * runtime evaluator reads (engine/decisioning.ts) or, for forms/types, what the form renderer and SDK
 * export expect. Deliberately narrower than the mockup: this engine has no per-asset lock or version
 * history yet (see ux_design/13-remaining-backlog.md, items C2/C3), and rename/delete are real (backed
 * by the API's usage-checked update/delete).
 */
@Component({
  selector: 'app-project-assets',
  standalone: true,
  imports: [FormsModule, IconComponent, AssetFieldsComponent],
  template: `
    <p class="hint">Assets are shared across the project's processes and become real jBPM assets on export. Nodes link to them by name (business rule tasks reference a DRL ruleset's group, forms are picked by name on user tasks, and so on).</p>

    <div class="toolbar">
      <input class="search" placeholder="Search assets…" [(ngModel)]="q" />
      <span class="spacer"></span>
      <button class="btn primary" (click)="openAdd()"><app-icon name="plus" [size]="13" /> Add asset</button>
    </div>

    <div class="layout">
      <aside class="rail card">
        <div class="section-title first">Kind</div>
        <button class="krow" [class.active]="kindFilter() === null" (click)="kindFilter.set(null)">
          <span>All assets</span><span class="badge">{{ allRows().length }}</span>
        </button>
        @for (k of ctx.assetKinds(); track k.key) {
          <button class="krow" [class.active]="kindFilter() === k.key" (click)="kindFilter.set(k.key)">
            <span>{{ k.label }}</span><span class="badge">{{ (ctx.assets()[k.key] || []).length }}</span>
          </button>
        }
      </aside>

      <div class="listcol">
        @if (filtered().length === 0) {
          <div class="card empty-state">
            <div class="es-icon"><app-icon name="file" [size]="22" /></div>
            <h3>{{ hasFilters() ? 'No assets match' : 'No assets yet' }}</h3>
            <p>{{ hasFilters() ? 'Try a different search or kind filter.' : "Add a form, data type, ruleset or decision — nodes reference these by name." }}</p>
            @if (hasFilters()) { <button class="btn sm" (click)="resetFilters()">Reset filters</button> }
          </div>
        } @else {
          <div class="card listcard">
            <table>
              <thead><tr><th>Name</th><th>Kind</th><th>Used by</th><th></th></tr></thead>
              <tbody>
                @for (a of filtered(); track a.kind + '::' + a.name) {
                  <tr>
                    <td><button class="lnk" (click)="openDetail(a)">{{ a.name }}</button></td>
                    <td><span class="badge">{{ a.kindLabel }}</span></td>
                    <td>@if (a.usedBy > 0) { <span class="badge active">{{ a.usedBy }} reference{{ a.usedBy === 1 ? '' : 's' }}</span> } @else { <span class="badge inactive">unused</span> }</td>
                    <td class="menucell" (click)="$event.stopPropagation()">
                      <button class="kebab" (click)="menuFor.set(menuFor() === a ? null : a)" aria-label="Asset actions" aria-haspopup="menu"><app-icon name="more" [size]="15" /></button>
                      @if (menuFor() === a) {
                        <div class="rowmenu card">
                          <button class="mrow" (click)="openDetail(a); menuFor.set(null)"><app-icon name="file" [size]="13" /> Open</button>
                          <button class="mrow" (click)="rename(a); menuFor.set(null)"><app-icon name="edit" [size]="13" /> Rename</button>
                          <button class="mrow danger" [disabled]="a.usedBy > 0" [title]="a.usedBy > 0 ? 'Referenced by ' + a.usedBy + ' node(s)' : ''" (click)="ctx.removeAsset(a.kind, a.name, a.usedBy); menuFor.set(null)"><app-icon name="trash" [size]="13" /> Delete</button>
                        </div>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    </div>

    @if (adding()) {
      <div class="modal-bg" (click)="closeAdd()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-h"><span>Add asset</span><span class="spacer"></span><button class="x" (click)="closeAdd()" aria-label="Close"><app-icon name="close" [size]="15" /></button></div>
          <div class="modal-body">
            <label class="fld"><span>Kind</span>
              <select [(ngModel)]="addKind">
                @for (k of ctx.assetKinds(); track k.key) { <option [value]="k.key">{{ k.label }}</option> }
              </select>
            </label>
            <label class="fld"><span>{{ nameFieldLabel(addKind) }}</span><input [(ngModel)]="addName" [placeholder]="nameFieldLabel(addKind)" /></label>
            @for (f of extraFields(addKind); track f.key) {
              <label class="fld"><span>{{ f.label }}</span><input [type]="f.type" [placeholder]="f.placeholder || f.label" [ngModel]="fv()[f.key]" (ngModelChange)="fv()[f.key] = $event" /></label>
            }
            <button class="btn primary full" (click)="submitAdd()">Add asset</button>
          </div>
        </div>
      </div>
    }

    @if (detail(); as d) {
      <div class="modal-bg" (click)="closeDetail()">
        <div class="modal wide" (click)="$event.stopPropagation()">
          <div class="modal-h">
            <span>{{ d.row.name }}</span><span class="badge">{{ d.row.kindLabel }}</span><span class="spacer"></span>
            <button class="x" (click)="closeDetail()" aria-label="Close"><app-icon name="close" [size]="15" /></button>
          </div>
          <div class="modal-body">
            <div class="section-title first">Referenced by</div>
            @if (d.usedBy.length) {
              <div class="panel-list">
                @for (r of d.usedBy; track r.process + (r.nodeId || '')) {
                  <div class="prow"><span>{{ r.process }}@if (r.nodeName) { · {{ r.nodeName }} }</span><span class="muted sm">{{ r.via }}</span></div>
                }
              </div>
              <p class="muted sm">Deletion is blocked while anything above still points at this asset.</p>
            } @else {
              <p class="muted sm">Not referenced by any process — safe to delete.</p>
            }

            <div class="section-title">Configuration</div>
            <app-asset-fields [kind]="d.row.kind" [value]="d.raw" />
            @if (detailError()) { <p class="err">{{ detailError() }}</p> }

            <div class="row actionrow">
              <button class="btn primary sm" (click)="saveDetail()">Save</button>
              <button class="btn sm" (click)="rename(d.row)">Rename</button>
              <button class="btn sm danger" [disabled]="d.row.usedBy > 0" [title]="d.row.usedBy > 0 ? 'Referenced by ' + d.row.usedBy + ' node(s)' : ''" (click)="deleteFromDetail(d.row)">Delete</button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .hint { color: var(--muted); font-size: 13px; margin: 0 0 14px; max-width: 760px; line-height: 1.5; }
    .hint.sm { font-size: 12px; margin-bottom: 10px; }
    .toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
    .search { width: 260px; }
    .layout { display: grid; grid-template-columns: 220px 1fr; gap: 16px; align-items: start; }
    .rail { padding: 14px; }
    .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 700; margin: 14px 0 8px; }
    .section-title.first { margin-top: 0; }
    .krow { display: flex; align-items: center; justify-content: space-between; width: 100%; border: none; background: none; padding: 7px 8px; border-radius: var(--radius-sm); font-size: 13px; cursor: pointer; color: var(--text-secondary); text-align: left; }
    .krow:hover { background: var(--surface-3); }
    .krow.active { background: var(--primary-50); color: var(--primary); font-weight: 600; }
    /* No overflow-x here (unlike a wide operational list) — this table is 4 narrow columns and never
       needs horizontal scroll at desktop widths. That matters because ANY ancestor with a non-visible
       overflow-x also clips overflow-y (the browser can't scroll one axis and clip-hide the other), which
       was cutting the absolutely-positioned row menu down to a sliver — hence "Rename"/"Delete" missing. */
    .listcard { padding: 0; }
    tbody tr:hover { background: var(--surface-2); }
    .lnk { border: none; background: none; color: var(--primary); font-weight: 600; cursor: pointer; font: inherit; padding: 0; }
    .lnk:hover { text-decoration: underline; }
    .menucell { position: relative; text-align: right; }
    .kebab { border: none; background: transparent; cursor: pointer; color: var(--muted); padding: 6px 8px; border-radius: var(--radius-xs); }
    .kebab:hover { background: var(--surface-3); }
    .rowmenu { position: absolute; top: 34px; right: 0; width: 180px; z-index: 20; padding: 4px; box-shadow: var(--shadow-pop); }
    .mrow { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; border: none; background: none; padding: 8px 10px; font-size: 12.5px; cursor: pointer; border-radius: var(--radius-xs); color: inherit; font: inherit; }
    .mrow:hover { background: var(--surface-2); }
    .mrow.danger { color: var(--red); }
    .mrow:disabled { opacity: .45; cursor: not-allowed; }
    .empty-state { padding: 40px; }

    .fld { display: block; margin-bottom: 12px; } .fld span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 5px; }
    .fld input, .fld select, .fld textarea { width: 100%; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; font-size: 13px; font-family: inherit; }
    .btn.full { width: 100%; justify-content: center; margin-top: 4px; }
    .btn.danger { color: var(--red); border-color: var(--border-strong); } .btn.danger:hover { background: var(--red-bg); }
    .actionrow { gap: 8px; margin-top: 14px; }
    .sm { font-size: 12px; }
    .err { color: var(--red); font-size: 12px; margin: -4px 0 8px; }
    .panel-list { display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; }
    .prow { display: flex; justify-content: space-between; padding: 6px 8px; border-radius: var(--radius-xs); font-size: 13px; }
    .prow:hover { background: var(--surface-2); }

    .modal-bg { position: fixed; inset: 0; background: rgba(16,24,40,.4); display: grid; place-items: center; z-index: 50; }
    .modal { background: var(--surface); border-radius: 14px; width: 440px; max-width: 92vw; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column; box-shadow: var(--shadow-pop); }
    /* Wide enough that a rule's nested When/Then panels (see asset-fields.component) get real room —
       narrower and every nested list cramps back down to the single column this is meant to avoid. */
    .modal.wide { width: 760px; max-width: 94vw; max-height: 86vh; }
    .modal-h { display: flex; align-items: center; gap: 8px; padding: 14px 18px; border-bottom: 1px solid var(--border); font-weight: 700; }
    .modal-h .x { border: none; background: transparent; font-size: 16px; cursor: pointer; color: var(--muted); }
    .modal-body { padding: 16px 18px; overflow: auto; }
  `],
})
export class ProjectAssetsComponent {
  ctx = inject(ProjectContextService);
  private toast = inject(ToastService);
  private modal = inject(ModalService);

  // Clicks inside the menu/kebab stop propagation (see the template), so this only ever sees clicks
  // genuinely outside the menu — safe to unconditionally close on every document click.
  @HostListener('document:click') closeMenu() { this.menuFor.set(null); }

  q = '';
  kindFilter = signal<string | null>(null);
  menuFor = signal<AssetRow | null>(null);

  adding = signal(false);
  addKind = '';
  addName = '';
  private fieldVal: Record<string, string> = {};

  detail = signal<{ row: AssetRow; usedBy: { kind: string; process: string; nodeId?: string; nodeName?: string; via: string }[]; raw: any } | null>(null);
  detailError = signal('');

  allRows = computed<AssetRow[]>(() => {
    const out: AssetRow[] = [];
    for (const k of this.ctx.assetKinds()) {
      for (const a of this.ctx.assets()[k.key] || []) out.push({ kind: k.key, kindLabel: k.label, name: a.name, usedBy: a.usedBy });
    }
    return out;
  });
  filtered = computed(() => {
    const kind = this.kindFilter();
    const q = this.q.trim().toLowerCase();
    return this.allRows().filter((a) => (!kind || a.kind === kind) && (!q || a.name.toLowerCase().includes(q)));
  });
  hasFilters = computed(() => !!this.kindFilter() || !!this.q.trim());
  resetFilters() { this.kindFilter.set(null); this.q = ''; }

  extraFields(kind: string) { return EXTRA_FIELDS[kind] || []; }
  fv() { return this.fieldVal; }
  nameFieldLabel(kind: string): string { return this.ctx.assetKinds().find((k) => k.key === kind)?.nameField === 'group' ? 'Ruleflow group name' : 'Name'; }

  openAdd() {
    this.addKind = this.ctx.assetKinds()[0]?.key || '';
    this.addName = '';
    this.fieldVal = {};
    this.adding.set(true);
  }
  closeAdd() { this.adding.set(false); }
  submitAdd() {
    const name = this.addName.trim();
    if (!name) { this.toast.error('Name is required'); return; }
    const fields = this.buildFields(this.addKind);
    this.ctx.addAsset(this.addKind, name, Object.keys(fields).length ? fields : undefined);
    this.closeAdd();
  }
  private buildFields(kind: string): Record<string, unknown> {
    const out: Record<string, any> = {};
    for (const f of this.extraFields(kind)) {
      const raw = this.fieldVal[f.key];
      if (raw === undefined || raw === '') continue;
      const parts = f.key.split('.');
      let cur = out;
      for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] ??= {}; cur = cur[parts[i]]; }
      cur[parts[parts.length - 1]] = f.type === 'number' ? Number(raw) : raw;
    }
    return out;
  }

  openDetail(row: AssetRow) {
    this.menuFor.set(null);
    this.ctx.getAsset(row.kind, row.name).subscribe({
      next: (r) => {
        this.detail.set({ row, usedBy: r.usedBy, raw: r.asset });
        this.detailError.set('');
      },
      error: (e) => this.toast.error(e?.error?.error?.message || 'Could not load asset'),
    });
  }
  closeDetail() { this.detail.set(null); }

  // AssetFieldsComponent mutates `d.raw` in place (see its [value] input) — Save just re-sends the
  // whole object as the patch. The nameField key inside it always matches d.row.name already (rename
  // is a separate action), so this never triggers the update endpoint's rename path by accident.
  saveDetail() {
    const d = this.detail(); if (!d) return;
    this.ctx.updateAsset(d.row.kind, d.row.name, d.raw).subscribe({
      next: () => { this.toast.success('Asset saved'); this.closeDetail(); this.ctx.loadAssets(); },
      error: (e) => this.detailError.set(e?.error?.error?.message || 'Save failed'),
    });
  }

  async rename(row: AssetRow) {
    this.menuFor.set(null);
    const nameField = this.ctx.assetKinds().find((k) => k.key === row.kind)?.nameField || 'name';
    const next = await this.modal.prompt({ title: 'Rename asset', initialValue: row.name });
    if (!next || !next.trim() || next.trim() === row.name) return;
    this.ctx.updateAsset(row.kind, row.name, { [nameField]: next.trim() }).subscribe({
      next: () => { this.toast.success('Renamed'); this.closeDetail(); this.ctx.loadAssets(); },
      error: (e) => this.toast.error(e?.error?.error?.message || 'Rename failed'),
    });
  }

  deleteFromDetail(row: AssetRow) {
    this.closeDetail();
    this.ctx.removeAsset(row.kind, row.name, row.usedBy);
  }
}
