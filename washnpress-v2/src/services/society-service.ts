import { randomUUID } from "node:crypto";
import type { Society } from "../domain/models";
import type { DataStore } from "../ports/repositories";

export class SocietyConflictError extends Error {
  constructor(message: string) { super(message); this.name = "SocietyConflictError"; }
}

export class SocietyService {
  constructor(private readonly store: DataStore) {}

  async create(input: { name: string; code: string; areaId: string; address?: string; city?: string; state?: string }): Promise<Society> {
    const clash = (await this.store.societies.find((s) => s.code.toLowerCase() === input.code.toLowerCase()))[0];
    if (clash) throw new SocietyConflictError("A society with this code already exists");
    const area = await this.store.areas.get(input.areaId);
    if (!area) throw new SocietyConflictError("Area not found");
    const society: Society = {
      id: randomUUID(), name: input.name, code: input.code.toUpperCase(), areaId: input.areaId,
      address: input.address ?? null, city: input.city ?? area.region ?? "Hyderabad", state: input.state ?? "Telangana",
      status: "active", createdAt: new Date().toISOString(),
    };
    return this.store.societies.put(society);
  }

  async update(id: string, patch: Partial<Pick<Society, "name" | "address" | "city" | "state" | "status" | "areaId">>): Promise<{ previous: Society; current: Society } | null> {
    const previous = await this.store.societies.get(id);
    if (!previous) return null;
    const current: Society = { ...previous, ...patch };
    await this.store.societies.put(current);
    return { previous, current };
  }

  // The society row every portal renders: identity plus the live operational counts.
  async summary(society: Society) {
    const area = society.areaId ? await this.store.areas.get(society.areaId) : null;
    const supervisor = area?.supervisorUserId ? await this.store.users.get(area.supervisorUserId) : null;
    const residents = await this.store.residents.find((r) => r.societyId === society.id);
    const operators = await this.store.users.find((u) => u.roles.includes("operator") && u.societyIds.includes(society.id));
    const orders = await this.store.orders.find((o) => o.societyId === society.id);
    const today = new Date().toISOString().slice(0, 10);
    const slots = await this.store.slots.find((s) => s.societyId === society.id && s.date >= today && s.isActive);
    const activeStates = ["scheduled", "picked_up", "in_wash", "ironing", "qc", "qc_hold", "ready_for_delivery", "out_for_delivery"];
    return {
      ...society,
      areaName: area?.name ?? null,
      supervisorUserId: area?.supervisorUserId ?? null,
      supervisorName: supervisor?.fullName ?? null,
      residentCount: residents.length,
      operationsStaffCount: operators.length,
      orderCount: orders.length,
      activeOrderCount: orders.filter((o) => activeStates.includes(o.state)).length,
      availableSlots: slots.reduce((sum, s) => sum + s.capacityRemaining, 0),
    };
  }

  async summaries(societies: Society[]) {
    return Promise.all(societies.map((s) => this.summary(s)));
  }
}
