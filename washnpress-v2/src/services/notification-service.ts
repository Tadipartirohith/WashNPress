import { randomUUID } from "node:crypto";
import type { DataStore } from "../ports/repositories";
import type { AppConfig } from "../config";
import type { NotificationProvider } from "../adapters/notifications/providers";

// Notifications go through a transactional outbox. Callers enqueue an event as part
// of their own work, and a worker delivers it later. This keeps user requests fast
// and makes delivery retryable instead of coupled to a provider being online.
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
