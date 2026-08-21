import { randomUUID } from "node:crypto";
import type { Society } from "../domain/models";
import type { DataStore } from "../ports/repositories";

// Creating a society can fail in three different ways, and a client can only react
// sensibly if it can tell them apart. A duplicate is not a missing area, and neither
// of them is a server fault.
export class SocietyConflictError extends Error {
  constructor(message: string) { super(message); this.name = "SocietyConflictError"; }
}
export class AreaNotFoundError extends Error {
  constructor() { super("The selected area does not exist"); this.name = "AreaNotFoundError"; }
}
export class AreaNotActiveError extends Error {
  constructor(name: string) {
    super(`${name} is not an active area, so a society cannot be created in it`);
    this.name = "AreaNotActiveError";
  }
}

export class SocietyService {
  constructor(private readonly store: DataStore) {}

  async create(input: { name: string; code: string; areaId: string; address?: string; city?: string; state?: string }): Promise<Society> {
    // Checked in the order a person would: is this name or code already taken, does
    // the area exist, and is it an area we can actually operate in.
    const existing = await this.store.societies.all();
    const code = input.code.trim();
    const name = input.name.trim();
    if (existing.some((s) => s.code.toLowerCase() === code.toLowerCase())) {
      throw new SocietyConflictError("A society with this code already exists");
    }
    // Two societies with the same name in the same area are indistinguishable to an
    // operator reading a pickup list. The same name in a different area is fine.
    if (existing.some((s) => s.areaId === input.areaId && s.name.trim().toLowerCase() === name.toLowerCase())) {
      throw new SocietyConflictError("A society with this name already exists in that area");
    }
    const area = await this.store.areas.get(input.areaId);
    if (!area) throw new AreaNotFoundError();
    if (area.status !== "active") throw new AreaNotActiveError(area.name);
    const society: Society = {
      id: randomUUID(), name, code: code.toUpperCase(), areaId: input.areaId,
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
