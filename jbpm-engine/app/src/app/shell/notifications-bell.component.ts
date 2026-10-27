import { Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SystemApiService } from '../core/api/system-api.service';
import { AppNotification } from '../core/models';
import { IconComponent } from '../shared/icon.component';

/**
 * The bell from the mockups' topbar (notifications-panel.html). The app has no global topbar —
 * every page renders its own header — so the bell floats pinned to the main pane's top-right,
 * matching where the mockup puts it without forcing a chrome bar onto every page.
 */
@Component({
  selector: 'app-notifications-bell',
  standalone: true,
  imports: [IconComponent],
  template: `
    <button class="bell" (click)="toggle($event)" [attr.aria-label]="'Notifications, ' + unread() + ' unread'" aria-haspopup="dialog">
      <app-icon name="bell" [size]="16" />
      @if (unread() > 0) { <span class="dot"></span> }
    </button>
    @if (open()) {
      <div class="panel card" (click)="$event.stopPropagation()">
        <div class="head">
          <b>Notifications</b>
          <div class="spacer"></div>
          @if (unread() > 0) { <a class="link" (click)="markAllRead()">Mark all read</a> }
        </div>
        <div class="body">
          @if (!items().length) {
            <div class="empty muted">You're all caught up.</div>
          }
          @if (today().length) {
            <div class="glabel">Today</div>
            @for (n of today(); track n.id) {
              <a class="nrow" [class.unread]="!n.read" (click)="openItem(n)">
                <span class="kic" [class]="'kic ' + tone(n.kind)"><app-icon [name]="icon(n.kind)" [size]="13" /></span>
                <span class="ntext">
                  <span class="ntitle">{{ n.title }}</span>
                  @if (n.body) { <span class="nbody muted">{{ n.body }}</span> }
                  <span class="nwhen muted">{{ ago(n.at) }}</span>
                </span>
              </a>
            }
          }
          @if (earlier().length) {
            <div class="glabel">Earlier</div>
            @for (n of earlier(); track n.id) {
              <a class="nrow" [class.unread]="!n.read" (click)="openItem(n)">
                <span class="kic" [class]="'kic ' + tone(n.kind)"><app-icon [name]="icon(n.kind)" [size]="13" /></span>
                <span class="ntext">
                  <span class="ntitle">{{ n.title }}</span>
                  @if (n.body) { <span class="nbody muted">{{ n.body }}</span> }
                  <span class="nwhen muted">{{ ago(n.at) }}</span>
                </span>
              </a>
            }
          }
        </div>
      </div>
    }
  `,
  styles: [`
    /* Sticky, zero-height strip at the top of the scrolling main pane: the bell stays visible
       while the page scrolls, without pushing any page content down. */
    :host { position: sticky; top: 14px; z-index: 40; display: block; height: 0; }
    .bell { position: absolute; top: 0; right: 22px; width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid var(--border); background: var(--surface); color: var(--text-secondary); border-radius: 50%; cursor: pointer; box-shadow: var(--shadow-sm, 0 1px 2px rgba(0,0,0,.06)); }
    .bell:hover { color: var(--text); background: var(--surface-3); }
    .dot { position: absolute; top: 7px; right: 8px; width: 8px; height: 8px; border-radius: 50%; background: var(--red, #ef4444); border: 2px solid var(--surface); }
    .panel { position: absolute; top: 42px; right: 22px; width: 340px; box-shadow: var(--shadow-pop, 0 12px 32px -8px rgba(0,0,0,.25)); border-radius: var(--radius-md, 12px); background: var(--surface); border: 1px solid var(--border); overflow: hidden; }
    .head { display: flex; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--border); font-size: 13px; }
    .spacer { flex: 1; }
    .link { font-size: 11.5px; color: var(--muted); cursor: pointer; }
    .link:hover { color: var(--primary); }
    .body { max-height: 360px; overflow: auto; padding-bottom: 6px; }
    .glabel { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 700; margin: 10px 14px 4px; }
    .empty { padding: 22px 14px; text-align: center; font-size: 12.5px; }
    .nrow { display: flex; gap: 10px; padding: 9px 14px; cursor: pointer; color: inherit; text-decoration: none; }
    .nrow:hover { background: var(--surface-3); }
    .nrow.unread { background: var(--primary-50); }
    .nrow.unread:hover { background: var(--surface-3); }
    .kic { flex-shrink: 0; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; background: var(--surface-3); color: var(--muted); }
    .kic.ok { background: var(--green-bg, #dcfce7); color: var(--green, #16a34a); }
    .kic.bad { background: var(--red-bg, #fee2e2); color: var(--red, #ef4444); }
    .kic.warn { background: var(--amber-bg, #fef3c7); color: var(--amber, #d97706); }
    .ntext { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .ntitle { font-size: 13px; }
    .nbody { font-size: 12px; }
    .nwhen { font-size: 11px; }
    .muted { color: var(--muted); }
  `],
})
export class NotificationsBellComponent implements OnInit, OnDestroy {
  private api = inject(SystemApiService);
  private router = inject(Router);

  open = signal(false);
  items = signal<AppNotification[]>([]);
  unread = signal(0);
  today = signal<AppNotification[]>([]);
  earlier = signal<AppNotification[]>([]);
  private timer: ReturnType<typeof setInterval> | undefined;

  ngOnInit() {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 30_000);
  }
  ngOnDestroy() { if (this.timer) clearInterval(this.timer); }

  refresh() {
    this.api.listNotifications({ limit: 30 }).subscribe({
      next: (r) => {
        this.items.set(r.items); this.unread.set(r.unread);
        const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
        const cut = midnight.toISOString();
        this.today.set(r.items.filter((n) => n.at >= cut));
        this.earlier.set(r.items.filter((n) => n.at < cut));
      },
      error: () => { /* bell is chrome — never toast on poll failure */ },
    });
  }

  toggle(ev: Event) {
    ev.stopPropagation();
    this.open.update((v) => !v);
    if (this.open()) this.refresh();
  }

  @HostListener('document:click') closeOnOutside() { if (this.open()) this.open.set(false); }
  @HostListener('document:keydown.escape') closeOnEsc() { this.open.set(false); }

  openItem(n: AppNotification) {
    if (!n.read) this.api.markNotificationRead(n.id).subscribe(() => this.refresh());
    this.open.set(false);
    if (n.link) this.router.navigateByUrl(n.link);
  }

  markAllRead() { this.api.markAllNotificationsRead().subscribe(() => this.refresh()); }

  icon(kind: AppNotification['kind']): string {
    switch (kind) {
      case 'task-assigned': return 'user';
      case 'task-reminder': return 'clock';
      case 'instance-failed': case 'deployment-failed': return 'error';
      case 'deployment-succeeded': return 'success';
      case 'sla-at-risk': case 'sla-breached': return 'warning';
      default: return 'info';
    }
  }
  tone(kind: AppNotification['kind']): string {
    switch (kind) {
      case 'instance-failed': case 'deployment-failed': case 'sla-breached': return 'bad';
      case 'deployment-succeeded': return 'ok';
      case 'sla-at-risk': case 'task-reminder': return 'warn';
      default: return '';
    }
  }

  ago(iso: string): string {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86_400)}d ago`;
  }
}
