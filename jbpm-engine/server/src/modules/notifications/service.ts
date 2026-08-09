// In-app notifications: persisted per-user so the bell survives a reload and "mark read" is real
// state (see domain.ts Notification). Producers call notify(); the HTTP layer only ever reads the
// caller's own rows — there is no cross-user notification API by design.
import type { AppContext } from '../../context.ts';
import { Collections, type Notification } from '../../domain.ts';
import { notFound } from '../../infra/errors.ts';

export class NotificationService {
  constructor(private ctx: AppContext) {}
  private repo() { return this.ctx.store.repo<Notification>(Collections.notifications); }

  async notify(n: Omit<Notification, 'id' | 'tenantId' | 'read' | 'at'>): Promise<Notification> {
    const rec: Notification = { id: this.ctx.newId(), tenantId: this.ctx.tenantId, read: false, at: this.ctx.clock(), ...n };
    await this.repo().put(rec);
    return rec;
  }

  async listFor(userId: string, q: { unread?: boolean; limit?: number } = {}): Promise<{ items: Notification[]; unread: number }> {
    const all = (await this.repo().query((n) => n.tenantId === this.ctx.tenantId && n.userId === userId))
      .sort((a, b) => (a.at < b.at ? 1 : -1));
    const unread = all.filter((n) => !n.read).length;
    const items = (q.unread ? all.filter((n) => !n.read) : all).slice(0, q.limit ?? 50);
    return { items, unread };
  }

  async markRead(id: string, userId: string): Promise<Notification> {
    const n = await this.repo().get(id);
    if (!n || n.tenantId !== this.ctx.tenantId || n.userId !== userId) throw notFound('Notification');
    if (!n.read) { n.read = true; await this.repo().put(n); }
    return n;
  }

  async markAllRead(userId: string): Promise<{ marked: number }> {
    const unread = await this.repo().query((n) => n.tenantId === this.ctx.tenantId && n.userId === userId && !n.read);
    for (const n of unread) { n.read = true; await this.repo().put(n); }
    return { marked: unread.length };
  }
}
