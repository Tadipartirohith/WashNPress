import { addDaysIso } from "../domain/subscriptions";
import type { DataStore } from "../ports/repositories";
import type { SchedulingService } from "./scheduling-service";

// Generates the next occurrence for recurring pickups. For each recurring pickup it
// looks one week ahead, and if that date falls inside the configured horizon and an
// active slot with capacity exists, it books the occurrence. A guard prevents making
// a duplicate when the occurrence already exists.
export class RecurringService {
  constructor(
    private readonly store: DataStore,
    private readonly scheduling: SchedulingService,
    private readonly horizonDays: number,
  ) {}

  async generateUpcoming(now: Date = new Date()): Promise<{ created: number }> {
    const recurring = await this.store.pickups.find((p) => p.recurring);
    const horizonEnd = addDaysIso(now.toISOString(), this.horizonDays);
    let created = 0;

    for (const pickup of recurring) {
      const nextIso = addDaysIso(pickup.scheduledFor, 7);
      if (new Date(nextIso) < now || new Date(nextIso) > new Date(horizonEnd)) continue;
      const nextDate = nextIso.slice(0, 10);

      const already = await this.store.pickups.find(
        (p) => p.residentId === pickup.residentId && p.scheduledFor.slice(0, 10) === nextDate,
      );
      if (already.length > 0) continue;

      const current = await this.store.slots.get(pickup.slotId);
      const window = current?.window;
      const slots = await this.store.slots.find(
        (s) => s.societyId === pickup.societyId && s.date === nextDate && s.window === window && s.isActive && s.capacityRemaining > 0,
      );
      if (slots.length === 0) continue;

      await this.scheduling.book({ residentId: pickup.residentId, societyId: pickup.societyId, slotId: slots[0].id });
      created += 1;
    }
    return { created };
  }
}
