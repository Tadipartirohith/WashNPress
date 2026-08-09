import { randomUUID } from "node:crypto";
import type { WaterLog } from "../domain/models";
import type { DataStore } from "../ports/repositories";

export class SustainabilityService {
  constructor(private readonly store: DataStore) {}

  async log(unitId: string, litersUsed: number, litersSaved: number, orderId?: string): Promise<WaterLog> {
    const entry: WaterLog = { id: randomUUID(), unitId, orderId: orderId ?? null, litersUsed, litersSaved, createdAt: new Date().toISOString() };
    return this.store.waterLogs.put(entry);
  }

  // The resident-facing widget: total litres saved by the resident's society unit.
  async impactForSociety(societyId: string): Promise<{ litersSaved: number }> {
    const units = await this.store.units.find((u) => u.societyId === societyId);
    const unitIds = new Set(units.map((u) => u.id));
    const logs = await this.store.waterLogs.find((l) => unitIds.has(l.unitId));
    return { litersSaved: logs.reduce((a, l) => a + l.litersSaved, 0) };
  }
}
