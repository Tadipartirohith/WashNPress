import type { AppConfig } from "../config";
import type { NotificationService } from "../services/notification-service";
import type { ReconciliationService } from "../services/reconciliation-service";
import type { RecurringService } from "../services/recurring-service";
import type { RenewalService } from "../services/renewal-service";

type Logger = { info: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };

// How often to look for cycles that have ended. A cycle boundary is a date, so hourly
// is close enough to it and far enough from the wallet. Stated here rather than in
// configuration because `jobs` has no key for it yet; add one and this moves.
const RENEWAL_INTERVAL_SECONDS = 3600;

// Starts the background jobs on the intervals defined in configuration. Each timer is
// unreferenced so it never keeps the process alive on its own, and stop clears them.
export class JobRunner {
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    private readonly config: AppConfig,
    // `renewal` is optional only until the composition root passes it. A deployment
    // running without it bills nobody for a second cycle, so its absence is announced
    // rather than left to be noticed a month later.
    private readonly deps: {
      notifications: NotificationService; reconciliation: ReconciliationService;
      recurring: RecurringService; renewal?: RenewalService;
    },
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
    const renewal = this.deps.renewal;
    if (renewal) {
      this.every(RENEWAL_INTERVAL_SECONDS, async () => {
        const r = await renewal.runOnce();
        if (r.renewed > 0 || r.expired > 0) this.log.info(r, "subscription cycles rolled");
      }, "renewal");
    } else {
      this.log.error({}, "no renewal service wired: subscriptions will never be billed for a second cycle");
    }
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
