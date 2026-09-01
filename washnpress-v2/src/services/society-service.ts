import { DEFAULT_NAMING, conventionProblems, type NamingConvention } from "../domain/naming";
import { randomUUID } from "node:crypto";
import type { Society } from "../domain/models";
import { addressProblems, formatAddress, normaliseAddress, societyKey, type SocietyAddress } from "../domain/society";
import { blockKey, blockProblems } from "../domain/assignment";
import type { DataStore } from "../ports/repositories";

// A society is the top of the operational hierarchy: society → supervisor → blocks
// → operators → residents. It used to hang off an area, and carried a code somebody
// typed to keep it unique. Both are gone: the area was a rung nobody worked at, and
// the code was a second name for a thing that already had one.

export class SocietyConflictError extends Error {
  constructor(message: string) { super(message); this.name = "SocietyConflictError"; }
}
export class SocietyInvalidError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems[0] ?? "That society cannot be created");
    this.name = "SocietyInvalidError";
    this.problems = problems;
  }
}

export interface SocietyInput {
  name: string;
  address: Partial<SocietyAddress>;
  // The towers this society is made of, named while the society is being set up.
  // Operators are assigned to blocks, so a society with none is a society whose
  // work cannot be handed to anybody.
  blocks?: { name: string; flatCount?: number; floorCount?: number }[];
  // What this society calls its towers, floors and flats.
  naming?: NamingConvention;
}

export class SocietyService {
  constructor(private readonly store: DataStore) {}

  private async assertNameFree(name: string, city: string, exceptId?: string): Promise<void> {
    const existing = await this.store.societies.all();
    // Two societies with the same name in the same city are indistinguishable to an
    // operator reading a pickup list. The same name in another city is fine.
    const clash = existing.find((s) => s.id !== exceptId
      && societyKey(s.name ?? "", s.address?.city ?? "") === societyKey(name, city));
    if (clash) throw new SocietyConflictError(`${clash.address?.city || "That city"} already has a society called ${clash.name}`);
  }

  // Blocks named twice in one form are a typo, not two towers, and it is worth
  // saying so before the society exists rather than after.
  private static blockNameProblems(blocks: { name: string; flatCount?: number; floorCount?: number }[]): string[] {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const block of blocks) {
      problems.push(...blockProblems(block));
      const key = blockKey(block.name ?? "");
      if (key && seen.has(key)) problems.push(`This society has two blocks called ${block.name.trim()}`);
      seen.add(key);
    }
    return problems;
  }

  async create(input: SocietyInput): Promise<{ society: Society; blockCount: number }> {
    const name = (input.name ?? "").trim();
    const address = normaliseAddress(input.address);
    const blocks = input.blocks ?? [];
    const problems = [
      ...(name ? [] : ["A society needs a name"]),
      ...addressProblems(address),
      ...SocietyService.blockNameProblems(blocks),
      ...(input.naming ? conventionProblems(input.naming) : []),
    ];
    if (problems.length) throw new SocietyInvalidError(problems);
    await this.assertNameFree(name, address.city);

    const society: Society = {
      id: randomUUID(), name, address, status: "active",
      naming: input.naming ?? DEFAULT_NAMING,
      supervisorUserId: null, createdAt: new Date().toISOString(),
    };
    await this.store.societies.put(society);
    for (const block of blocks) {
      await this.store.blocks.put({
        id: randomUUID(), societyId: society.id, name: block.name.trim(),
        flatCount: block.flatCount ?? 0, floorCount: block.floorCount ?? 0,
        operatorUserIds: [], status: "active",
        createdAt: society.createdAt,
      });
    }
    return { society, blockCount: blocks.length };
  }

  async update(
    id: string,
    patch: {
      name?: string; address?: Partial<SocietyAddress>; status?: Society["status"];
      // Changing the convention changes what *new* towers and flats are called. It
      // does not rewrite the ones that exist: renaming somebody's flat under them
      // is a migration, not a settings change, and the round says so explicitly.
      naming?: NamingConvention;
    },
  ): Promise<{ previous: Society; current: Society } | null> {
    const previous = await this.store.societies.get(id);
    if (!previous) return null;
    const name = (patch.name ?? previous.name).trim();
    const address = patch.address === undefined
      ? previous.address
      : normaliseAddress({ ...previous.address, ...patch.address });
    // An update is held to the fields it actually carries.
    //
    // This used to validate the merged address on every patch whatever the patch
    // contained, which made a society stored before the address had six parts —
    // a locality and a city and nothing else — impossible to deactivate: the
    // status change came back 422 for a missing house, street and pincode it had
    // not tried to set. Setting an address is still held to all six, because the
    // edit that can repair one is the edit that has to produce a complete one.
    const touchesAddress = patch.address !== undefined;
    const problems = [
      ...(name ? [] : ["A society needs a name"]),
      ...(touchesAddress ? addressProblems(address) : []),
      ...(patch.naming ? conventionProblems(patch.naming) : []),
    ];
    if (problems.length) throw new SocietyInvalidError(problems);
    // Renaming or moving a society is held to the rule creating one is held to, or
    // the uniqueness only holds for societies nobody has edited since. A patch that
    // moves neither the name nor the city leaves a pair that is already stored.
    if (patch.name !== undefined || touchesAddress) await this.assertNameFree(name, address.city, id);

    const current: Society = { ...previous, ...patch, name, address };
    await this.store.societies.put(current);
    return { previous, current };
  }

  // The society row every portal renders: identity plus the live operational counts.
  async summary(society: Society) {
    const supervisorUserId = society.supervisorUserId ?? null;
    const supervisor = supervisorUserId ? await this.store.users.get(supervisorUserId) : null;
    const blocks = await this.store.blocks.find((b) => b.societyId === society.id);
    const residents = await this.store.residents.find((r) => r.societyId === society.id);
    const operators = await this.store.users.find((u) => u.roles.includes("operator") && u.societyIds.includes(society.id));
    const orders = await this.store.orders.find((o) => o.societyId === society.id);
    const today = new Date().toISOString().slice(0, 10);
    const slots = await this.store.slots.find((s) => s.societyId === society.id && s.date >= today && s.isActive);
    const activeStates = ["scheduled", "picked_up", "in_wash", "ironing", "qc", "qc_hold", "ready_for_delivery", "out_for_delivery"];
    return {
      ...society,
      // The address as one line as well as its parts, so a card can print it
      // without every screen re-deciding how an address is joined up.
      addressLine: formatAddress(society.address),
      // Read as the default where a society predates the question, so every
      // screen gets a complete convention rather than having to decide what an
      // absent one means.
      naming: society.naming ?? DEFAULT_NAMING,
      supervisorUserId,
      supervisorName: supervisor?.fullName ?? null,
      blocks: blocks
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((b) => ({
          id: b.id, name: b.name, flatCount: b.flatCount, floorCount: b.floorCount ?? 0, status: b.status,
          // Who stands on this tower. The operators are already loaded above for
          // the staff count, so naming them here costs nothing and saves the edit
          // screen a second call to find out what it is about to change.
          operators: b.operatorUserIds
            .map((id) => operators.find((u) => u.id === id))
            .filter((u): u is NonNullable<typeof u> => Boolean(u))
            .map((u) => ({ id: u.id, fullName: u.fullName })),
        })),
      blockNames: blocks.map((b) => b.name).sort((a, b) => a.localeCompare(b)),
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
