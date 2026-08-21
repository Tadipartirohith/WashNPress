import { randomUUID } from "node:crypto";
import type { Role, User } from "../domain/models";
import type { DataStore } from "../ports/repositories";

export class UserConflictError extends Error {
  constructor(message: string) { super(message); this.name = "UserConflictError"; }
}

export interface UserSummary extends User {
  areaName: string | null;
  societyNames: string[];
  societyCount: number;
  operationsUserCount?: number;
  // For an operator: whoever runs their area, which may be nobody yet.
  supervisorUserId?: string | null;
  supervisorName?: string | null;
}

// Staff accounts. Admin creates supervisors, a supervisor creates operators inside
// their own area, and nobody may create an account with a role above their own.
export class UserService {
  constructor(private readonly store: DataStore) {}

  async byPhone(phone: string): Promise<User | null> {
    return (await this.store.users.find((u) => u.phone === phone))[0] ?? null;
  }

  async createStaff(input: {
    role: Extract<Role, "supervisor" | "operator" | "support">;
    fullName: string; phone: string; email?: string; employeeId?: string;
    areaId?: string | null; societyIds?: string[];
  }): Promise<User> {
    const existing = await this.byPhone(input.phone);
    if (existing) throw new UserConflictError("A user with this phone number already exists");
    const user: User = {
      id: randomUUID(), phone: input.phone, fullName: input.fullName,
      email: input.email ?? null, employeeId: input.employeeId ?? null,
      status: "active", roles: [input.role], lastLoginAt: null,
      areaId: input.areaId ?? null, societyIds: input.societyIds ?? [],
      createdAt: new Date().toISOString(),
    };
    return this.store.users.put(user);
  }

  async update(id: string, patch: Partial<Pick<User, "fullName" | "email" | "employeeId" | "status" | "societyIds" | "areaId">>): Promise<{ previous: User; current: User } | null> {
    const previous = await this.store.users.get(id);
    if (!previous) return null;
    const current: User = { ...previous, ...patch };
    await this.store.users.put(current);
    return { previous, current };
  }

  async setStatus(id: string, status: User["status"]) { return this.update(id, { status }); }

  async listByRole(role: Role): Promise<User[]> {
    return this.store.users.find((u) => u.roles.includes(role));
  }

  async decorate(user: User): Promise<UserSummary> {
    const area = user.areaId ? await this.store.areas.get(user.areaId) : null;
    const societies = await Promise.all(user.societyIds.map((id) => this.store.societies.get(id)));
    const named = societies.filter((s): s is NonNullable<typeof s> => Boolean(s));
    const summary: UserSummary = {
      ...user,
      areaName: area?.name ?? null,
      societyNames: named.map((s) => s.name),
      societyCount: named.length,
    };
    // An operator's supervisor is whoever runs their area. There is no second
    // ownership link to keep in step, which is what lets an operator be created
    // and work perfectly well before any supervisor exists for that area.
    if (user.roles.includes("operator")) {
      const supervisorUserId = area?.supervisorUserId ?? null;
      const supervisor = supervisorUserId ? await this.store.users.get(supervisorUserId) : null;
      summary.supervisorUserId = supervisorUserId;
      summary.supervisorName = supervisor?.fullName ?? null;
    }
    if (user.roles.includes("supervisor") && user.areaId) {
      const areaSocieties = await this.store.societies.find((s) => s.areaId === user.areaId);
      summary.societyCount = areaSocieties.length;
      summary.societyNames = areaSocieties.map((s) => s.name);
      summary.operationsUserCount = (await this.store.users.find((u) => u.roles.includes("operator") && u.areaId === user.areaId)).length;
    }
    return summary;
  }

  async decorateAll(users: User[]): Promise<UserSummary[]> {
    return Promise.all(users.map((u) => this.decorate(u)));
  }

  // Operator workload, used by the supervisor workload page to spot an overloaded
  // operator or one with nothing assigned.
  async operatorWorkload(areaId: string) {
    const operators = await this.store.users.find((u) => u.roles.includes("operator") && u.areaId === areaId);
    const orders = await this.store.orders.all();
    return Promise.all(operators.map(async (op) => {
      const mine = orders.filter((o) => o.assignedOperatorUserId === op.id);
      const societies = await Promise.all(op.societyIds.map((id) => this.store.societies.get(id)));
      return {
        userId: op.id, name: op.fullName, employeeId: op.employeeId, status: op.status,
        societyNames: societies.filter(Boolean).map((s) => s!.name),
        pending: mine.filter((o) => o.state === "scheduled").length,
        processing: mine.filter((o) => ["picked_up", "in_wash", "ironing", "qc", "qc_hold", "ready_for_delivery", "out_for_delivery"].includes(o.state)).length,
        completed: mine.filter((o) => o.state === "delivered").length,
        qcFailures: mine.filter((o) => o.qcPassed === false).length,
        failedPickups: mine.filter((o) => o.state === "pickup_failed").length,
      };
    }));
  }
}
