import { randomUUID } from "node:crypto";
import type { DataStore } from "../ports/repositories";
import type { AppConfig } from "../config";
import type { Notification, Role } from "../domain/models";
import type { NotificationProvider } from "../adapters/notifications/providers";
import { DeviceService, tokenIsDead } from "./device-service";

// Notifications go through a transactional outbox for external delivery, and are
// also persisted per user so every portal can render an in-app notification feed.
// Callers enqueue as part of their own work; a worker delivers later. That keeps
// user requests fast and makes delivery retryable instead of coupled to a provider.
export class NotificationService {
  constructor(
    private readonly store: DataStore,
    private readonly config: AppConfig,
    private readonly provider: NotificationProvider,
    // Where each person can actually be reached. Defaulted so a caller that
    // predates device tokens still builds; it reads the same store either way.
    private readonly devices: DeviceService = new DeviceService(store),
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
  // assigned operator and the supervisor of the order's society.
  async notifyResident(residentId: string, input: { type: string; title: string; body: string; orderId?: string | null }): Promise<void> {
    const resident = await this.store.residents.get(residentId);
    if (!resident) { await this.enqueue(input.type, { to: residentId, title: input.title, body: input.body }); return; }
    await this.notifyUser(resident.userId, input);
  }

  // Everybody in a role who works a given society. The fan-out used to be by area,
  // which meant one delayed order in one tower woke every supervisor in the
  // corridor; a society has exactly one supervisor, so it now reaches the person
  // who can actually do something about it.
  async notifyRoleInSociety(societyId: string | null, role: Role, input: { type: string; title: string; body: string; orderId?: string | null }): Promise<void> {
    if (!societyId) return;
    const users = await this.store.users.find(
      (u) => u.roles.includes(role) && (u.societyIds ?? []).includes(societyId) && u.status === "active");
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

  // Straight to the provider, without the outbox.
  //
  // The outbox exists so that a notification about something that happened survives
  // the process that noticed it. A verification code is the opposite: it is useless
  // a minute later, and somebody is waiting for it with the screen open.
  async deliverRaw(message: { channel: "sms" | "email" | "push"; to: string; title: string; body: string }): Promise<void> {
    await this.provider.send(message);
  }

  // The worker loop. Drains pending events and hands each to the channel provider,
  // honouring the notification channel toggles in configuration.
  //
  // What is on the event is a *user id*, because that is what the code raising the
  // notification knows. It is not something either channel can address: a push
  // service wants a device token and an SMS gateway wants a phone number, and both
  // used to be handed "user-res" and asked to work it out. Resolving the person
  // into the places they can actually be reached is this loop's job.
  async processOutboxOnce(): Promise<number> {
    const pending = await this.store.outbox.listPending();
    for (const event of pending) {
      const to = String(event.payload.to ?? "");
      const title = String(event.payload.title ?? "Wash N Press");
      const body = String(event.payload.body ?? "");
      const attempts = await this.deliver(to, title, body);
      // Somebody with a phone but no app installed is reached by one channel and
      // not the other, and that is a delivered notification rather than a failed
      // one. Only an event that reached nothing at all is a failure worth retrying.
      const delivered = attempts.some((a) => a);
      await this.store.outbox.mark(event.id, attempts.length === 0 || delivered ? "sent" : "failed");
    }
    return pending.length;
  }

  // Every channel this person is reachable on, tried independently. One dead
  // handset must not stop the SMS, and one gateway being down must not stop the
  // other handset.
  private async deliver(to: string, title: string, body: string): Promise<boolean[]> {
    const user = await this.store.users.get(to);
    const results: boolean[] = [];

    if (this.config.notifications.push.enabled) {
      // A device token per handset. A person with a phone and a tablet gets both,
      // which is the whole reason this is a list rather than a field on the user.
      const devices = user ? await this.devices.forUser(user.id) : [];
      for (const device of devices) {
        results.push(await this.attempt({ channel: "push", to: device.id, title, body }, device.id));
      }
      // Nothing to resolve the id against — a raw address handed in by an older
      // caller. Send it as it stands rather than dropping it.
      if (!user) results.push(await this.attempt({ channel: "push", to, title, body }));
    }

    if (this.config.notifications.sms.enabled) {
      results.push(await this.attempt({ channel: "sms", to: user?.phone ?? to, title, body }));
    }
    return results;
  }

  private async attempt(
    message: { channel: "sms" | "whatsapp" | "push" | "email"; to: string; title: string; body: string },
    deviceToken?: string,
  ): Promise<boolean> {
    try {
      await this.provider.send(message);
      return true;
    } catch (error) {
      // A push service refusing a token because the token is finished — the app was
      // uninstalled, or this is the old one after a rotation — is not a delivery to
      // retry. It is a handset to stop writing to, and the only thing the service
      // told us about it is the token itself.
      if (deviceToken && tokenIsDead(error)) await this.devices.revoke(deviceToken, "rejected by the push service");
      return false;
    }
  }
}
