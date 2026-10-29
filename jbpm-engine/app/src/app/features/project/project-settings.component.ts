import { Component, inject, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProjectContextService } from './project-context.service';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-project-settings',
  standalone: true,
  imports: [IconComponent, FormsModule],
  template: `
    <h3 class="sec-h">General</h3>
    <div class="setrow"><label>Key</label><input [value]="ctx.wf()?.key" disabled /></div>
    <div class="setrow"><label>Description</label><input [(ngModel)]="ctx.description" (blur)="ctx.saveName()" placeholder="What this project does" /></div>
    <div class="setrow">
      <label>Instance creation mode</label>
      <select [(ngModel)]="ctx.instanceCreationMode" (ngModelChange)="ctx.saveCreationMode()">
        <option value="">Inherit system default</option>
        <option value="both">Both (Process & Case Instances)</option>
        <option value="case-only">Case Instances Only</option>
        <option value="process-only">Process Instances Only</option>
      </select>
      <small>Controls which instance types users can start within this project.</small>
    </div>
    <div class="setrow"><label>Integration base URL</label><input [(ngModel)]="ctx.baseUrl" placeholder="http://localhost:3000" /><small>Applied per deployment environment for service tasks.</small></div>

    <!-- ENVIRONMENT VARIABLES SECTION -->
    <h3 class="sec-h">Environment Variables (env)</h3>
    <p class="hint">
      Arbitrary project-level environment variables deployed to all environments.
      Accessible at runtime via <code>env.KEY</code>, <code>System.getenv("KEY")</code>,
      <code>System.getProperty("KEY")</code>, and in Java via
      <code>kcontext.getKieRuntime().getEnvironment().get("KEY")</code>.
    </p>

    @if (ctx.envList().length === 0) {
      <div class="empty-state">
        <div class="es-icon"><app-icon name="settings" [size]="24" /></div>
        <h3>No environment variables yet</h3>
        <p>Add key-value variables below (e.g. <code>INTEGRATION_LAYER_URL</code>, <code>API_KEY</code>).</p>
      </div>
    } @else {
      @for (e of ctx.envList(); track $index) {
        <div class="vrow">
          <input placeholder="KEY (e.g. INTEGRATION_LAYER_URL)" [(ngModel)]="e.key" class="env-key" />
          <input placeholder="VALUE" [(ngModel)]="e.value" class="env-val" />
          <button class="x" (click)="ctx.rmEnvVar($index)" aria-label="Remove variable"><app-icon name="close" [size]="13" /></button>
        </div>
      }
    }
    <div class="row">
      <button class="add" (click)="ctx.addEnvVar()">+ add environment variable</button>
      @if (ctx.envList().length) { <button class="btn primary" (click)="ctx.saveEnv()">Save environment variables</button> }
    </div>

    <!-- PROJECT GLOBAL ERROR HANDLER SECTION -->
    <h3 class="sec-h">Project Global Error Handler</h3>
    <p class="hint">
      Configures project-level global error interception. Local boundary error events attached to nodes
      <strong>always execute first</strong>. If an error is unhandled locally or explicitly rethrown, it bubbles up
      to this Project Global Error Handler. A built-in circuit breaker ensures loop recursion is capped at 1.
    </p>

    <div class="setrow checkrow">
      <label class="toggle-lbl">
        <input type="checkbox" [checked]="ctx.globalErrorHandler().enabled" (change)="toggleGlobalHandler($event)" />
        <span>Enable Project Global Error Handler</span>
      </label>
      <small>When enabled, unhandled process node exceptions route to the designated error process.</small>
    </div>

    @if (ctx.globalErrorHandler().enabled) {
      <div class="setrow">
        <label>Error Handler Process</label>
        <select [ngModel]="ctx.globalErrorHandler().processId" (ngModelChange)="setHandlerProcess($event)">
          <option value="">-- Select error handler process --</option>
          @for (p of ctx.processes(); track p.id) {
            <option [value]="p.id">{{ p.name }} ({{ p.id }})</option>
          }
        </select>
        <small>The BPMN process in this project that runs when an unhandled error occurs.</small>
      </div>

      <div class="setrow">
        <label>Resolution Strategy</label>
        <select [ngModel]="ctx.globalErrorHandler().strategy || 'repair-and-resume'" (ngModelChange)="setStrategy($event)">
          <option value="repair-and-resume">Repair and Resume (Apply output mappings & continue/retry)</option>
          <option value="compensate-and-abort">Compensate and Abort (Run compensation/cleanup & abort)</option>
          <option value="spawn">Spawn Incident Process (Fire-and-forget notification flow)</option>
        </select>
        <small>
          <strong>Repair and Resume:</strong> Merges output variables back to the failing instance and continues (or retries if <code>errorHandlerAction="retry"</code>).<br />
          <strong>Compensate and Abort:</strong> Executes error handler cleanup, then marks original instance as aborted.
        </small>
      </div>

      <div class="setrow">
        <label>Error Codes Filter (comma-separated)</label>
        <input [ngModel]="filterText" (ngModelChange)="setFilterText($event)" placeholder="* or SERVICE_ERROR, SCRIPT_ERROR, 500" />
        <small>Use <code>*</code> to intercept all errors, or specify exact error codes / HTTP statuses.</small>
      </div>

      @if ((ctx.globalErrorHandler().strategy || 'repair-and-resume') === 'repair-and-resume') {
        <div class="setrow">
          <label>Variable Output Mappings (Error Process Output &rarr; Target Instance Var)</label>
          <small>Map variables computed by the error handler back into the original instance before resuming.</small>
          @for (m of outputMappingList(); track $index) {
            <div class="vrow">
              <input placeholder="Error Process Var" [(ngModel)]="m.errVar" (blur)="syncMappings()" />
              <span class="arr">&rarr;</span>
              <input placeholder="Target Instance Var" [(ngModel)]="m.targetVar" (blur)="syncMappings()" />
              <button class="x" (click)="rmMapping($index)"><app-icon name="close" [size]="13" /></button>
            </div>
          }
          <div class="row">
            <button class="add" (click)="addMapping()">+ add output mapping</button>
          </div>
        </div>
      }

      <div class="row" style="margin-top: 14px;">
        <button class="btn primary" (click)="saveGlobalHandler()">Save Global Error Handler</button>
      </div>
    }

    <!-- SHARED VARIABLES SECTION -->
    <h3 class="sec-h">Shared variables</h3>
    <p class="hint">Project-shared variables. (Each process also has its own variables, edited in its canvas toolbar.)</p>
    @if (ctx.vars().length === 0) {
      <div class="empty-state">
        <div class="es-icon"><app-icon name="settings" [size]="24" /></div>
        <h3>No shared variables yet</h3>
        <p>Add one below to share it across every process in this project.</p>
      </div>
    } @else {
      @for (v of ctx.vars(); track $index) {
        <div class="vrow">
          <input placeholder="name" [(ngModel)]="v.name" />
          <select [(ngModel)]="v.type"><option>string</option><option>int</option><option>long</option><option>double</option><option>bool</option><option>date</option><option>object</option><option>list</option><option>map</option></select>
          <button class="x" (click)="ctx.rmVar($index)" aria-label="Remove variable"><app-icon name="close" [size]="13" /></button>
        </div>
      }
    }
    <div class="row">
      <button class="add" (click)="ctx.addVar()">+ add variable</button>
      @if (ctx.vars().length) { <button class="btn primary" (click)="ctx.saveVars()">Save variables</button> }
    </div>
  `,
  styles: [`
    .sec-h { font-size: 14px; margin: 0 0 14px; font-weight: 700; color: var(--text, #f1f5f9); }
    .sec-h:not(:first-child) { margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--border); }
    .setrow { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; max-width: 580px; }
    .setrow label { font-size: 12px; color: var(--muted); font-weight: 600; }
    .setrow input, .setrow select { border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; background: var(--surface); color: inherit; font: inherit; }
    .setrow small { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .hint { color: var(--muted); font-size: 13px; margin: 0 0 16px; line-height: 1.4; }
    .hint code { background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 4px; font-size: 12px; }
    .vrow { display: flex; gap: 8px; margin-bottom: 8px; max-width: 580px; align-items: center; }
    .vrow input { flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; background: var(--surface); color: inherit; }
    .vrow select { flex: 0 0 120px; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; background: var(--surface); color: inherit; }
    .env-key { font-family: monospace; font-size: 13px; }
    .env-val { font-family: monospace; font-size: 13px; }
    .arr { color: var(--muted); font-weight: 700; padding: 0 4px; }
    .checkrow { flex-direction: row; align-items: flex-start; gap: 10px; }
    .toggle-lbl { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; font-weight: 600; color: inherit; }
    .toggle-lbl input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }
    .x { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; cursor: pointer; color: var(--muted); }
    .x:hover { color: #f87171; border-color: #f87171; }
    .add { border: 1px dashed var(--border); background: var(--surface); border-radius: 8px; padding: 7px 12px; font-size: 13px; cursor: pointer; color: var(--muted); }
    .add:hover { color: inherit; border-color: var(--accent, #6366f1); }
    .btn.primary { background: var(--accent, #6366f1); color: #fff; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
    .empty-state { padding: 24px; border: 1px dashed var(--border); border-radius: 12px; text-align: center; max-width: 580px; margin-bottom: 12px; background: rgba(255,255,255,0.01); }
    .empty-state h3 { font-size: 14px; margin: 8px 0 4px; }
    .empty-state p { color: var(--muted); font-size: 12px; margin: 0; }
  `],
})
export class ProjectSettingsComponent {
  ctx = inject(ProjectContextService);

  get filterText(): string {
    return (this.ctx.globalErrorHandler().filter || ['*']).join(', ');
  }

  setFilterText(val: string) {
    const arr = val.split(',').map((s) => s.trim()).filter(Boolean);
    this.ctx.updateGlobalErrorHandler({ filter: arr.length ? arr : ['*'] });
  }

  outputMappingList = signal<{ errVar: string; targetVar: string }[]>([]);

  constructor() {
    effect(() => {
      const mappings = this.ctx.globalErrorHandler().outputMappings || {};
      this.outputMappingList.set(Object.entries(mappings).map(([errVar, targetVar]) => ({ errVar, targetVar })));
    }, { allowSignalWrites: true });
  }

  toggleGlobalHandler(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.ctx.updateGlobalErrorHandler({ enabled: checked });
  }

  setHandlerProcess(processId: string) {
    this.ctx.updateGlobalErrorHandler({ processId: processId || undefined });
  }

  setStrategy(strategy: any) {
    this.ctx.updateGlobalErrorHandler({ strategy });
  }

  addMapping() {
    this.outputMappingList.set([...this.outputMappingList(), { errVar: '', targetVar: '' }]);
  }

  rmMapping(i: number) {
    const list = [...this.outputMappingList()];
    list.splice(i, 1);
    this.outputMappingList.set(list);
    this.syncMappings();
  }

  syncMappings() {
    const map: Record<string, string> = {};
    for (const item of this.outputMappingList()) {
      if (item.errVar.trim() && item.targetVar.trim()) {
        map[item.errVar.trim()] = item.targetVar.trim();
      }
    }
    this.ctx.updateGlobalErrorHandler({ outputMappings: map });
  }

  saveGlobalHandler() {
    this.syncMappings();
    this.ctx.saveGlobalErrorHandler();
  }
}
