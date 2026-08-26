import { randomUUID } from "node:crypto";
import { loadConfig, resetConfigCache } from "../../src/config";
import { today } from "../../src/services/scheduling-service";
import { buildContainer, type Container } from "../../src/container";
import { buildApp } from "../../src/app/build-app";
import type { Slot, Subscription } from "../../src/domain/models";

export async function makeTestContainer(): Promise<Container> {
  resetConfigCache();
  const config = loadConfig({ reload: true, env: { WNP_APP__ENV: "test" } });
  return buildContainer(config);
}

export async function makeTestApp() {
  const container = await makeTestContainer();
  const app = buildApp(container);
  await app.ready();
  return { app, container };
}

export function seedSlot(container: Container, id: string, capacity: number, societyId = "soc-demo"): Promise<Slot> {
  return container.store.slots.put({
    id, societyId, date: "2099-01-01", window: "Morning",
    startTime: "08:00", endTime: "11:00", capacityTotal: capacity, capacityRemaining: capacity, isActive: true,
  });
}

// Puts an active subscription on a resident without going through the wallet, so
// a test can start from a known allowance and usage.
export async function giveSubscription(container: Container, residentId: string, planId: string, garmentsUsed = 0): Promise<Subscription> {
  const now = new Date().toISOString();
  return container.store.subscriptions.put({
    id: `sub-${residentId}-${planId}`, residentId, planId, status: "active", cycle: "monthly",
    cycleStart: now, cycleEnd: new Date(Date.now() + 30 * 86400_000).toISOString(),
    garmentsUsed, autoRenew: true, pendingPlanId: null, pauseUntil: null, cancelReason: null,
  });
}

// Logs a resident in and returns a bearer token for authenticated requests.
export async function loginResident(app: Awaited<ReturnType<typeof makeTestApp>>["app"], phone = "9876543210"): Promise<string> {
  const send = await app.inject({ method: "POST", url: "/v1/auth/otp/send", headers: { "content-type": "application/json" }, payload: JSON.stringify({ phone }) });
  const otp = send.json().otpForTesting as string;
  const verify = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { "content-type": "application/json" }, payload: JSON.stringify({ phone, otp }) });
  return verify.json().token as string;
}

export async function loginOperator(app: Awaited<ReturnType<typeof makeTestApp>>["app"], phone = "9876500002"): Promise<string> {
  return loginResident(app, phone);
}

// The operator in the other area, used to prove the area boundary holds.
export async function loginOtherOperator(app: Awaited<ReturnType<typeof makeTestApp>>["app"]): Promise<string> {
  return loginResident(app, "9876500003");
}

export async function loginSupervisor(app: Awaited<ReturnType<typeof makeTestApp>>["app"], phone = "9876500011"): Promise<string> {
  return loginResident(app, phone);
}

export async function loginOtherSupervisor(app: Awaited<ReturnType<typeof makeTestApp>>["app"]): Promise<string> {
  return loginResident(app, "9876500012");
}

export async function loginAdmin(app: Awaited<ReturnType<typeof makeTestApp>>["app"]): Promise<string> {
  return loginResident(app, "9876500001");
}

// Proving a number and an address, the way the application does before it makes a
// staff account against them.
//
// Every staff creation goes through this because every staff creation now requires
// it: a wrong digit used to make an account nobody could sign into, and nobody found
// out until the person tried.
export async function proveContact(
  app: Awaited<ReturnType<typeof makeTestApp>>["app"],
  token: string,
  channel: "phone" | "email",
  value: string,
): Promise<string> {
  const sent = await app.inject({
    method: "POST", url: "/v1/admin/verifications/send",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: JSON.stringify({ channel, value }),
  });
  const { verificationId, otpForTesting } = sent.json() as { verificationId: string; otpForTesting: string };
  await app.inject({
    method: "POST", url: "/v1/admin/verifications/confirm",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: JSON.stringify({ verificationId, otp: otpForTesting }),
  });
  return verificationId;
}

// A staff creation body with both proofs attached.
export async function staffBody(
  app: Awaited<ReturnType<typeof makeTestApp>>["app"],
  token: string,
  input: { firstName: string; lastName: string; phone: string; email?: string; areaId?: string; region?: string } & Record<string, unknown>,
): Promise<string> {
  // Kept unique per person and always a valid address: stripping digits turned
  // "Operator 03" into "operator." and every creation failed validation.
  const email = input.email
    ?? `${input.firstName}.${input.lastName}.${input.phone}`
      .toLowerCase().replace(/[^a-z0-9.]/g, "").replace(/\.+/g, ".") + "@washnpress.example";
  // The state follows from the area rather than being restated: the two have to
  // agree, and a test that hard-codes one of them is a test that breaks when the
  // seed moves an area to another state.
  let region = input.region;
  if (!region && input.areaId) {
    const areas = await app.inject({
      method: "GET", url: "/v1/admin/areas", headers: { authorization: `Bearer ${token}` },
    });
    region = (areas.json().areas as { id: string; region: string }[])
      .find((a) => a.id === input.areaId)?.region;
  }
  return JSON.stringify({
    ...input,
    email,
    ...(region ? { region } : {}),
    phoneVerificationId: await proveContact(app, token, "phone", input.phone),
    emailVerificationId: await proveContact(app, token, "email", email),
  });
}

// The operator identity the service level tests act as.
export const OPERATOR = { userId: "user-op" };

export function bearer(token: string) { return { "content-type": "application/json", authorization: `Bearer ${token}` }; }
export function uuid() { return randomUUID(); }

// Time passes between booking a slot and collecting from it. A slot has to be in the
// future to be bookable and has to have started to be collectable, so a test that
// does both has to say the clock moved — otherwise it is asking an operator to
// collect garments the resident has not put out yet.
export async function openSlotNow(container: Container, slotId: string): Promise<void> {
  const slot = await container.store.slots.get(slotId);
  if (!slot) return;
  slot.date = today();
  slot.startTime = "00:01";
  // And runs to the end of the day. Leaving the original end time meant the window
  // had already finished whenever the suite happened to run after it, so this passed
  // in the morning and failed in the afternoon.
  slot.endTime = "23:59";
  await container.store.slots.put(slot);
  for (const pickup of await container.store.pickups.find((p) => p.slotId === slotId)) {
    pickup.scheduledFor = new Date(Date.now() - 3600_000).toISOString();
    await container.store.pickups.put(pickup);
  }
}

// A staff account exists as soon as it is created but cannot be used until somebody
// with the authority vouches for it. A test that creates staff and then acts as them
// has to approve them first, which is the real workflow rather than a test detail.
export async function approveStaff(
  app: Awaited<ReturnType<typeof makeTestApp>>["app"],
  userId: string,
  adminToken?: string,
): Promise<void> {
  const token = adminToken ?? (await loginAdmin(app));
  const response = await app.inject({
    method: "POST", url: `/v1/admin/staff/${userId}/verification`,
    headers: bearer(token), payload: JSON.stringify({ status: "approved" }),
  });
  if (response.statusCode !== 200) {
    throw new Error(`Could not approve ${userId}: ${response.statusCode} ${response.payload}`);
  }
}
