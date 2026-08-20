import { randomUUID } from "node:crypto";
import type { AuditLog, Role, Session } from "../domain/models";
import type { DataStore } from "../ports/repositories";

// Every administrative and operational change is recorded with who did it, what
// changed, and the before and after values, so a change can always be explained.
export class AuditService {
  constructor(private readonly store: DataStore) {}

  async record(input: {
    session?: Session | null;
    actorUserId?: string;
    actorName?: string | null;
    role?: Role | "system" | null;
    action: string;
    resource: string;
    resourceId: string;
    previousValue?: unknown;
    newValue?: unknown;
  }): Promise<AuditLog> {
    const actor = input.actorUserId ?? input.session?.userId ?? "system";
    const role = input.role ?? input.session?.roles?.[0] ?? "system";
    const entry: AuditLog = {
      id: randomUUID(),
      actor,
      actorName: input.actorName ?? null,
      role,
      action: input.action,
      entity: `${input.resource}:${input.resourceId}`,
      resource: input.resource,
      resourceId: input.resourceId,
      previousValue: input.previousValue ?? null,
      newValue: input.newValue ?? null,
      at: new Date().toISOString(),
    };
    return this.store.audit.add(entry);
  }

  async list(filter: { resource?: string; resourceId?: string; actor?: string; action?: string; from?: string; to?: string; limit?: number } = {}): Promise<AuditLog[]> {
    let entries = await this.store.audit.all();
    if (filter.resource) entries = entries.filter((e) => e.resource === filter.resource);
    if (filter.resourceId) entries = entries.filter((e) => e.resourceId === filter.resourceId);
    if (filter.actor) entries = entries.filter((e) => e.actor === filter.actor);
    if (filter.action) entries = entries.filter((e) => e.action === filter.action);
    if (filter.from) entries = entries.filter((e) => e.at >= filter.from!);
    if (filter.to) entries = entries.filter((e) => e.at <= filter.to!);
    entries.sort((a, b) => (a.at < b.at ? 1 : -1));
    return entries.slice(0, filter.limit ?? 200);
  }
}
