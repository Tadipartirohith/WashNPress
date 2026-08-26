import { randomUUID } from "node:crypto";
import type { Area, Society, User } from "../domain/models";
import { areaKey, stateFor } from "../domain/regions";
import type { DataStore } from "../ports/repositories";

export class AreaConflictError extends Error {
  constructor(message: string) { super(message); this.name = "AreaConflictError"; }
}

// Operational areas are the top level of the hierarchy: area -> societies ->
// residents, with exactly one responsible supervisor per area.
export class AreaService {
  constructor(private readonly store: DataStore) {}

  async list(): Promise<Area[]> {
    const areas = await this.store.areas.all();
    areas.sort((a, b) => a.name.localeCompare(b.name));
    return areas;
  }

  async get(id: string): Promise<Area | null> { return this.store.areas.get(id); }

  // A state and a name. The same name may be used again in another state — there is
  // a Gandhinagar in more than one — but not twice in the same one, where two areas
  // by that name are indistinguishable to anybody choosing between them.
  async create(input: { name: string; region: string; description?: string }): Promise<Area> {
    const region = stateFor(input.region);
    if (!region) throw new AreaConflictError("Choose the state this area is in");
    const name = input.name.trim();
    if (!name) throw new AreaConflictError("An area needs a name");
    const clash = (await this.store.areas.find((a) => areaKey(a.region, a.name) === areaKey(region, name)))[0];
    if (clash) throw new AreaConflictError(`${region} already has an area called ${clash.name}`);
    const area: Area = {
      id: randomUUID(), name, region,
      description: input.description ?? null,
      status: "active", supervisorUserId: null, createdAt: new Date().toISOString(),
    };
    return this.store.areas.put(area);
  }

  async update(id: string, patch: Partial<Pick<Area, "name" | "description" | "region" | "status">>): Promise<{ previous: Area; current: Area } | null> {
    const previous = await this.store.areas.get(id);
    if (!previous) return null;
    const region = patch.region === undefined ? previous.region : stateFor(patch.region);
    if (!region) throw new AreaConflictError("Choose the state this area is in");
    const name = (patch.name ?? previous.name).trim();
    // Renaming or moving an area has to respect the same rule creating one does,
    // or the uniqueness only holds for areas nobody has edited since.
    const clash = (await this.store.areas.find(
      (a) => a.id !== id && areaKey(a.region, a.name) === areaKey(region, name)))[0];
    if (clash) throw new AreaConflictError(`${region} already has an area called ${clash.name}`);
    const current: Area = { ...previous, ...patch, name, region };
    await this.store.areas.put(current);
    return { previous, current };
  }

  // Every state that has an area in it, so a screen can offer the states worth
  // choosing rather than all thirty.
  async regionsInUse(): Promise<string[]> {
    const areas = await this.store.areas.all();
    return [...new Set(areas.map((a) => a.region).filter(Boolean))].sort();
  }

  async setStatus(id: string, status: Area["status"]) { return this.update(id, { status }); }

  // Assigning a supervisor is a two-sided change: the area points at the supervisor
  // and the supervisor's own scope points back at the area. A supervisor may hold
  // exactly one area, so an existing assignment is released first.
  async assignSupervisor(areaId: string, supervisorUserId: string): Promise<{ area: Area; supervisor: User; previousSupervisorUserId: string | null }> {
    const area = await this.store.areas.get(areaId);
    if (!area) throw new AreaConflictError("Area not found");
    const supervisor = await this.store.users.get(supervisorUserId);
    if (!supervisor || !supervisor.roles.includes("supervisor")) throw new AreaConflictError("Supervisor not found");

    const previousSupervisorUserId = area.supervisorUserId;
    if (previousSupervisorUserId && previousSupervisorUserId !== supervisorUserId) {
      const previous = await this.store.users.get(previousSupervisorUserId);
      if (previous) { previous.areaId = null; await this.store.users.put(previous); }
    }
    // Release any other area this supervisor already held.
    for (const other of await this.store.areas.find((a) => a.supervisorUserId === supervisorUserId && a.id !== areaId)) {
      other.supervisorUserId = null;
      await this.store.areas.put(other);
    }

    area.supervisorUserId = supervisorUserId;
    await this.store.areas.put(area);
    supervisor.areaId = areaId;
    await this.store.users.put(supervisor);
    return { area, supervisor, previousSupervisorUserId };
  }

  async societiesIn(areaId: string): Promise<Society[]> {
    return this.store.societies.find((s) => s.areaId === areaId);
  }

  // A rolled-up view of one area used by the admin area list and detail pages.
  async summary(area: Area) {
    const societies = await this.societiesIn(area.id);
    const societyIds = new Set(societies.map((s) => s.id));
    const residents = await this.store.residents.find((r) => societyIds.has(r.societyId));
    const operators = await this.store.users.find((u) => u.roles.includes("operator") && u.areaId === area.id);
    const orders = await this.store.orders.find((o) => societyIds.has(o.societyId));
    const supervisor = area.supervisorUserId ? await this.store.users.get(area.supervisorUserId) : null;
    return {
      ...area,
      supervisorName: supervisor?.fullName ?? null,
      societyCount: societies.length,
      residentCount: residents.length,
      operationsStaffCount: operators.length,
      orderCount: orders.length,
    };
  }
}
