import { randomUUID } from "node:crypto";
import type { Role, User, StaffVerificationStatus } from "../domain/models";
import { fullNameOf, nameOf, nextEmployeeId, splitFullName } from "../domain/staff-identity";
import type { DataStore } from "../ports/repositories";

// The account belongs to somebody else's society, or to a role this actor does not
// decide about.
export class NotYourStaffError extends Error {
  constructor() {
    super("This account is not yours to approve.");
    this.name = "NotYourStaffError";
  }
}

export class UserConflictError extends Error {
  constructor(message: string) { super(message); this.name = "UserConflictError"; }
}

export interface UserSummary extends User {
  societyNames: string[];
  // The one society a member of staff belongs to, named. Everything on a staff
  // screen is about that society, so it is given directly rather than left to be
  // read out of a list of one.
  societyId: string | null;
  societyName: string | null;
  societyCount: number;
  operationsUserCount?: number;
  // For an operator: whoever runs the society they work in, which may be nobody yet.
  supervisorUserId?: string | null;
  supervisorName?: string | null;
  // For an operator: which towers they cover and how many flats that comes to.
  // Blocks are the assignment, so an operator with none covers nothing and the
  // names say so by being empty.
  blockIds?: string[];
  blockNames?: string[];
  blockCount?: number;
  flatsCovered?: number;
}

// Staff accounts. An admin creates supervisors and gives each one a society; that
// supervisor creates operators inside it and puts them on blocks. Nobody may create
// an account with a role above their own.
export class UserService {
  constructor(private readonly store: DataStore) {}

  async byPhone(phone: string): Promise<User | null> {
    return (await this.store.users.find((u) => u.phone === phone))[0] ?? null;
  }

  async createStaff(input: {
    role: Extract<Role, "supervisor" | "operator" | "support">;
    // A name in the two parts it is made of. fullName is accepted from callers
    // written before the split and turned into the two, so nothing that used to
    // work stops working.
    fullName?: string; firstName?: string; lastName?: string;
    phone: string; email?: string;
    societyIds?: string[]; blockIds?: string[];
    // Proved before the account exists, where the caller has proof to offer. Staff
    // creation no longer asks for it — the number is proved by whoever owns it, with
    // the OTP they receive at their first sign-in — but a caller that has proof may
    // still record it.
    phoneVerifiedAt?: string | null; emailVerifiedAt?: string | null;
  }): Promise<User> {
    const existing = await this.byPhone(input.phone);
    if (existing) throw new UserConflictError("A user with this phone number already exists");
    const name = input.firstName !== undefined || input.lastName !== undefined
      ? { firstName: (input.firstName ?? "").trim(), lastName: (input.lastName ?? "").trim() }
      : splitFullName(input.fullName);
    // Generated, never typed. An id somebody types is an id somebody eventually
    // types twice, and the collision shows up as two people sharing one rather than
    // as an error at the moment it was made.
    const employeeId = nextEmployeeId(
      input.role,
      (await this.store.users.all()).map((u) => u.employeeId),
    );
    const user: User = {
      id: randomUUID(), phone: input.phone,
      fullName: fullNameOf(name) || null,
      firstName: name.firstName || null,
      lastName: name.lastName || null,
      email: input.email ?? null, employeeId,
      phoneVerifiedAt: input.phoneVerifiedAt ?? null,
      emailVerifiedAt: input.emailVerifiedAt ?? null,
      status: "active", roles: [input.role], lastLoginAt: null,
      societyIds: input.societyIds ?? [], blockIds: input.blockIds ?? [],
      // A new staff account exists but cannot yet be used. Creating somebody is not
      // the same act as vouching for them, and keeping them apart is what gives the
      // approval an audit trail worth having.
      verificationStatus: "pending",
      verifiedByUserId: null, verifiedAt: null, verificationNote: null,
      createdAt: new Date().toISOString(),
    };
    return this.store.users.put(user);
  }

  // Who may decide about whom. An admin vouches for a supervisor; a supervisor
  // vouches for the operators in their own society, and only once they have been
  // vouched for themselves.
  static mayVerify(actor: User, subject: User): boolean {
    if (subject.roles.includes("supervisor")) return actor.roles.includes("admin");
    if (subject.roles.includes("operator")) {
      if (actor.roles.includes("admin")) return true;
      if (!actor.roles.includes("supervisor")) return false;
      // An unapproved supervisor cannot approve anybody, which is what stops the
      // chain being started from the middle.
      if ((actor.verificationStatus ?? "approved") !== "approved") return false;
      const mine = actor.societyIds ?? [];
      return mine.length > 0 && (subject.societyIds ?? []).some((id) => mine.includes(id));
    }
    return false;
  }

  async setVerification(
    userId: string,
    status: StaffVerificationStatus,
    actor: User,
    note?: string,
  ): Promise<{ previous: User; current: User } | null> {
    const subject = await this.store.users.get(userId);
    if (!subject) return null;
    if (!UserService.mayVerify(actor, subject)) throw new NotYourStaffError();
    const previous = { ...subject };
    subject.verificationStatus = status;
    subject.verifiedByUserId = actor.id;
    subject.verifiedAt = new Date().toISOString();
    subject.verificationNote = note?.trim() || null;
    await this.store.users.put(subject);
    return { previous, current: subject };
  }

  async update(
    id: string,
    patch: Partial<Pick<User,
      "fullName" | "firstName" | "lastName" | "email" | "employeeId" | "status"
      | "societyIds" | "blockIds">>,
  ): Promise<{ previous: User; current: User } | null> {
    const previous = await this.store.users.get(id);
    if (!previous) return null;
    const current: User = { ...previous, ...patch };
    // The two parts and the joined name are one fact written twice, so changing
    // either end updates the other rather than letting them drift apart.
    if (patch.firstName !== undefined || patch.lastName !== undefined) {
      const name = {
        firstName: (patch.firstName ?? previous.firstName ?? "").trim(),
        lastName: (patch.lastName ?? previous.lastName ?? "").trim(),
      };
      current.firstName = name.firstName || null;
      current.lastName = name.lastName || null;
      current.fullName = fullNameOf(name) || null;
    } else if (patch.fullName !== undefined) {
      const name = splitFullName(patch.fullName);
      current.firstName = name.firstName || null;
      current.lastName = name.lastName || null;
    }
    // When somebody's society or blocks change, say when. An operator looking at
    // their own profile can then tell whether what they are seeing is current.
    const assignmentChanged =
      (patch.societyIds !== undefined && patch.societyIds.join(",") !== (previous.societyIds ?? []).join(",")) ||
      (patch.blockIds !== undefined && patch.blockIds.join(",") !== (previous.blockIds ?? []).join(","));
    if (assignmentChanged) current.assignmentUpdatedAt = new Date().toISOString();
    await this.store.users.put(current);
    return { previous, current };
  }

  async setStatus(id: string, status: User["status"]) { return this.update(id, { status }); }

  async listByRole(role: Role): Promise<User[]> {
    return this.store.users.find((u) => u.roles.includes(role));
  }

  async decorate(user: User): Promise<UserSummary> {
    // Defensive as well as normalised at the store: decorating one bad record must
    // never cost the caller the whole list.
    const societies = await Promise.all((user.societyIds ?? []).map((id) => this.store.societies.get(id)));
    const named = societies.filter((s): s is NonNullable<typeof s> => Boolean(s));
    const name = nameOf(user);
    const summary: UserSummary = {
      ...user,
      // Given in both forms: a screen that shows one name and a form that edits two.
      firstName: name.firstName || null,
      lastName: name.lastName || null,
      societyNames: named.map((s) => s.name),
      societyId: named[0]?.id ?? null,
      societyName: named[0]?.name ?? null,
      societyCount: named.length,
    };
    // An operator's supervisor is whoever runs the society they work in. It used to
    // be whoever ran their area, which answered a different question — who runs the
    // corridor the society sits in — and gave every operator in an area the same
    // supervisor whatever society they actually collected from. An operator whose
    // society has nobody running it still works perfectly well; they pick one up the
    // moment somebody is assigned. A society nobody runs gives its operators no
    // supervisor, which is the truth rather than a name inherited from the level
    // above; data written before societies had supervisors is given them at boot, so
    // this is not how legacy records read.
    if (user.roles.includes("operator")) {
      const supervisorUserId = named.find((s) => s.supervisorUserId)?.supervisorUserId ?? null;
      const supervisor = supervisorUserId ? await this.store.users.get(supervisorUserId) : null;
      summary.supervisorUserId = supervisorUserId;
      summary.supervisorName = supervisor?.fullName ?? null;

      // The towers they actually cover, and how much of the society that is.
      const assigned = user.blockIds ?? [];
      const blocks = (await this.store.blocks.all())
        .filter((b) => assigned.includes(b.id))
        .sort((a, b) => a.name.localeCompare(b.name));
      summary.blockIds = blocks.map((b) => b.id);
      summary.blockNames = blocks.map((b) => b.name);
      summary.blockCount = blocks.length;
      summary.flatsCovered = blocks.reduce((total, b) => total + (b.flatCount ?? 0), 0);
    }
    if (user.roles.includes("supervisor")) {
      // A supervisor runs exactly one society. This used to count every society in
      // their area, which is what supervision used to mean and is no longer what it
      // is; a supervisor nobody has given a society to runs none, and the screen
      // says so rather than inheriting a corridor.
      const run = await this.store.societies.find((s) => s.supervisorUserId === user.id);
      summary.societyCount = run.length;
      summary.societyNames = run.map((s) => s.name);
      summary.societyId = run[0]?.id ?? summary.societyId;
      summary.societyName = run[0]?.name ?? summary.societyName;
      const runIds = new Set(run.map((s) => s.id));
      summary.operationsUserCount = (await this.store.users.find(
        (u) => u.roles.includes("operator") && (u.societyIds ?? []).some((id) => runIds.has(id)),
      )).length;
    }
    return summary;
  }

  async decorateAll(users: User[]): Promise<UserSummary[]> {
    return Promise.all(users.map((u) => this.decorate(u)));
  }

  // Operator workload, used by the supervisor workload page to spot an overloaded
  // operator or one with nothing assigned.
  async operatorWorkload(societyId: string) {
    const operators = await this.store.users.find(
      (u) => u.roles.includes("operator") && (u.societyIds ?? []).includes(societyId));
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
