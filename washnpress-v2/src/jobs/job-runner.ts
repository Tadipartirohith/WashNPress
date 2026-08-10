import type { AppConfig } from "../config";
import type { NotificationService } from "../services/notification-service";
import type { ReconciliationService } from "../services/reconciliation-service";
import type { RecurringService } from "../services/recurring-service";

type Logger = { info: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };

// Starts the background jobs on the intervals defined in configuration. Each timer is
// unreferenced so it never keeps the process alive on its own, and stop clears them.
export class JobRunner {
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    private readonly config: AppConfig,
    private readonly deps: { notifications: NotificationService; reconciliation: ReconciliationService; recurring: RecurringService },
    private readonly log: Logger,
  ) {}

  start(): void {
    if (!this.config.jobs.enabled) {
      this.log.info({}, "background jobs are disabled by configuration");
      return;
    }
    this.every(this.config.jobs.outboxIntervalSeconds, async () => {
      await this.deps.notifications.processOutboxOnce();
    }, "outbox");
    this.every(this.config.jobs.reconciliationIntervalSeconds, async () => {
      const r = await this.deps.reconciliation.runOnce();
      if (r.credited > 0) this.log.info(r, "reconciliation credited payments");
    }, "reconciliation");
    this.every(this.config.jobs.recurringGenerationIntervalSeconds, async () => {
      const r = await this.deps.recurring.generateUpcoming();
      if (r.created > 0) this.log.info(r, "recurring pickups generated");
    }, "recurring");
    this.log.info({}, "background jobs started");
  }

  private every(seconds: number, fn: () => Promise<void>, name: string): void {
    const timer = setInterval(() => { fn().catch((err) => this.log.error(err, `${name} job failed`)); }, seconds * 1000);
    timer.unref();
    this.timers.push(timer);
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }
}
