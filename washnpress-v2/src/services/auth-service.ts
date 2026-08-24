import { randomUUID } from "node:crypto";
import { addDaysIso } from "../domain/subscriptions";
import type { Resident, Session, User } from "../domain/models";
import type { DataStore, SessionRepository } from "../ports/repositories";
import type { OtpService } from "./otp-service";
import type { AppConfig } from "../config";

export class AccountDisabledError extends Error {
  constructor() { super("This account has been deactivated"); this.name = "AccountDisabledError"; }
}

export interface OnboardingInput {
  fullName: string; societyId: string; unitNumber: string;
  email?: string; towerBlock?: string; address?: string; pickupAddress?: string; preferredWindows?: string[];
}

export class AuthService {
  constructor(private readonly store: DataStore, private readonly otp: OtpService, private readonly config: AppConfig, private readonly sessions: SessionRepository = store.sessions) {}

  sendOtp(phone: string) { return this.otp.send(phone); }

  async verifyOtp(phone: string, code: string): Promise<{ session: Session; user: User; resident: Resident | null } | { error: string }> {
    const check = this.otp.verify(phone, code);
    if (!check.verified) return { error: check.reason ?? "Invalid OTP" };

    let user = (await this.store.users.find((u) => u.phone === phone))[0] ?? null;
    if (!user) {
      // An unknown phone number is a new resident. Staff accounts are only ever
      // created by an admin or a supervisor, never implicitly at sign in.
      user = {
        id: randomUUID(), phone, fullName: null, email: null, employeeId: null,
        status: "active", roles: ["resident"], lastLoginAt: null,
        areaId: null, societyIds: [], createdAt: new Date().toISOString(),
      };
    }
    // A deactivated account cannot obtain a session, whatever its role.
    if (user.status !== "active") return { error: "Account is not active" };

    user.lastLoginAt = new Date().toISOString();
    await this.store.users.put(user);

    const session = await this.issueSession(user);
    const resident = session.residentId ? await this.store.residents.get(session.residentId) : null;
    return { session, user, resident };
  }

  // The session carries the scope so the guards never have to reload the user on
  // every request. It is rebuilt whenever the user's scope changes.
  async issueSession(user: User): Promise<Session> {
    const resident = (await this.store.residents.find((r) => r.userId === user.id))[0] ?? null;
    const session: Session = {
      token: randomUUID(), userId: user.id, roles: user.roles,
      residentId: resident?.id ?? null, societyId: resident?.societyId ?? null,
      areaId: user.areaId ?? null, societyIds: user.societyIds ?? [],
      expiresAt: addDaysIso(new Date().toISOString(), this.config.auth.sessionTtlSeconds / 86400),
    };
    await this.sessions.create(session);
    return session;
  }

  // Onboarding status drives the resident app: an incomplete profile is redirected
  // to onboarding, and a completed one is never asked again.
  async onboardingStatus(userId: string): Promise<{ completed: boolean; resident: Resident | null; requiredFields: string[] }> {
    const resident = (await this.store.residents.find((r) => r.userId === userId))[0] ?? null;
    const user = await this.store.users.get(userId);
    const requiredFields: string[] = [];
    if (!user?.fullName) requiredFields.push("fullName");
    if (!resident?.societyId) requiredFields.push("societyId");
    if (!resident?.unitNumber) requiredFields.push("unitNumber");
    if (!resident?.pickupAddress) requiredFields.push("pickupAddress");
    return { completed: Boolean(resident?.onboardingCompleted) && requiredFields.length === 0, resident, requiredFields };
  }

  async completeOnboarding(userId: string, input: OnboardingInput): Promise<Resident> {
    const user = await this.store.users.get(userId);
    if (!user) throw new Error("User not found");
    const society = await this.store.societies.get(input.societyId);
    if (!society || society.status === "inactive") throw new Error("Society is not available");
    user.fullName = input.fullName;
    if (input.email) user.email = input.email;
    await this.store.users.put(user);

    const existing = (await this.store.residents.find((r) => r.userId === userId))[0] ?? null;
    const resident: Resident = {
      id: existing?.id ?? randomUUID(), userId, societyId: input.societyId, unitNumber: input.unitNumber,
      towerBlock: input.towerBlock ?? existing?.towerBlock ?? null,
      preferredWindows: input.preferredWindows ?? existing?.preferredWindows ?? [],
      address: input.address ?? existing?.address ?? null,
      pickupAddress: input.pickupAddress ?? input.address ?? existing?.pickupAddress ?? null,
      onboardingCompleted: true,
      onboardedAt: existing?.onboardedAt ?? new Date().toISOString(),
    };
    return this.store.residents.put(resident);
  }

  // A resident may edit their own contact details. Society and unit assignment are
  // deliberately not editable here: they are controlled by the admin or supervisor
  // workflow so a resident cannot move themselves into another society.
  async updateResidentProfile(userId: string, patch: { fullName?: string; email?: string; address?: string; pickupAddress?: string; preferredWindows?: string[] }): Promise<{ user: User; resident: Resident | null }> {
    const user = await this.store.users.get(userId);
    if (!user) throw new Error("User not found");
    if (patch.fullName !== undefined) user.fullName = patch.fullName;
    if (patch.email !== undefined) user.email = patch.email;
    await this.store.users.put(user);
    const resident = (await this.store.residents.find((r) => r.userId === userId))[0] ?? null;
    if (resident) {
      if (patch.address !== undefined) resident.address = patch.address;
      if (patch.pickupAddress !== undefined) resident.pickupAddress = patch.pickupAddress;
      if (patch.preferredWindows !== undefined) resident.preferredWindows = patch.preferredWindows;
      await this.store.residents.put(resident);
    }
    return { user, resident };
  }

  // Staff may edit their own contact details, never their own area or permissions.
  async updateStaffProfile(userId: string, patch: { fullName?: string; email?: string }): Promise<User> {
    const user = await this.store.users.get(userId);
    if (!user) throw new Error("User not found");
    if (patch.fullName !== undefined) user.fullName = patch.fullName;
    if (patch.email !== undefined) user.email = patch.email;
    return this.store.users.put(user);
  }

  async sessionFromToken(token: string | undefined): Promise<Session | null> {
    if (!token) return null;
    const session = await this.sessions.findByToken(token);
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() < Date.now()) { await this.sessions.delete(token); return null; }
    // A session is only as valid as the account behind it, so deactivating a user
    // takes effect immediately rather than at the end of their session lifetime.
    const user = await this.store.users.get(session.userId);
    if (!user || user.status !== "active") { await this.sessions.delete(token); return null; }
    // Authorisation follows the account as it stands now, not as it stood at login.
    // Roles, area and societies were previously frozen into the session document and
    // could be up to a session lifetime out of date, so somebody moved out of an area
    // kept that area's access until their session expired.
    return {
      ...session,
      roles: user.roles,
      areaId: user.areaId,
      societyIds: user.societyIds,
      areaWideAccess: user.areaWideAccess ?? false,
    };
  }

  async logout(token: string): Promise<void> { await this.sessions.delete(token); }
}
