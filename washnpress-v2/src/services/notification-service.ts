import { randomUUID } from "node:crypto";
import type { DataStore } from "../ports/repositories";
import type { AppConfig } from "../config";
import type { Notification, Role } from "../domain/models";
import type { NotificationProvider } from "../adapters/notifications/providers";

// Notifications go through a transactional outbox for external delivery, and are
// also persisted per user so every portal can render an in-app notification feed.
// Callers enqueue as part of their own work; a worker delivers later. That keeps
// user requests fast and makes delivery retryable instead of coupled to a provider.
export class NotificationService {
  constructor(
    private readonly store: DataStore,
    private readonly config: AppConfig,
    private readonly provider: NotificationProvider,
  ) {}

  async enqueue(type: string, payload: Record<string, unknown>): Promise<void> {
    await this.store.outbox.add({
      id: randomUUID(), type, payload, status: "pending", attempts: 0, createdAt: new Date().toISOString(),
    });
  }

  // Persist an in-app notification for one user and enqueue the outbound message.
  async notifyUser(userId: string, input: { type: string; title: string; body: string; orderId?: string | null }): Promise<Notification> {
    const notification: Notification = {
      id: randomUUID(), userId, type: input.type, title: input.title, body: input.body,
      orderId: input.orderId ?? null, read: false, createdAt: new Date().toISOString(),
    };
    await this.store.notifications.put(notification);
    await this.enqueue(input.type, { to: userId, title: input.title, body: input.body });
    return notification;
  }

  // Notify the resident who owns an order plus the staff responsible for it: the
  // assigned operator and the supervisor of the order's area.
  async notifyResident(residentId: string, input: { type: string; title: string; body: string; orderId?: string | null }): Promise<void> {
    const resident = await this.store.residents.get(residentId);
    if (!resident) { await this.enqueue(input.type, { to: residentId, title: input.title, body: input.body }); return; }
    await this.notifyUser(resident.userId, input);
  }

  async notifyRoleInArea(areaId: string | null, role: Role, input: { type: string; title: string; body: string; orderId?: string | null }): Promise<void> {
    if (!areaId) return;
    const users = await this.store.users.find((u) => u.roles.includes(role) && u.areaId === areaId && u.status === "active");
    for (const user of users) await this.notifyUser(user.id, input);
  }

  async listForUser(userId: string, options: { unreadOnly?: boolean; limit?: number } = {}): Promise<Notification[]> {
    let items = await this.store.notifications.find((n) => n.userId === userId);
    if (options.unreadOnly) items = items.filter((n) => !n.read);
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return items.slice(0, options.limit ?? 100);
  }

  async markRead(userId: string, notificationId: string): Promise<Notification | null> {
    const found = await this.store.notifications.get(notificationId);
    if (!found || found.userId !== userId) return null;
    found.read = true;
    return this.store.notifications.put(found);
  }

  async markAllRead(userId: string): Promise<number> {
    const items = await this.store.notifications.find((n) => n.userId === userId && !n.read);
    for (const item of items) { item.read = true; await this.store.notifications.put(item); }
    return items.length;
  }

  // The worker loop. Drains pending events and hands each to the channel provider,
  // honouring the notification channel toggles in configuration.
  async processOutboxOnce(): Promise<number> {
    const pending = await this.store.outbox.listPending();
    for (const event of pending) {
      try {
        const to = String(event.payload.to ?? "");
        const title = String(event.payload.title ?? "Wash N Press");
        const body = String(event.payload.body ?? "");
        if (this.config.notifications.push.enabled) await this.provider.send({ channel: "push", to, title, body });
        if (this.config.notifications.sms.enabled) await this.provider.send({ channel: "sms", to, title, body });
        await this.store.outbox.mark(event.id, "sent");
      } catch {
        await this.store.outbox.mark(event.id, "failed");
      }
    }
    return pending.length;
  }
}
