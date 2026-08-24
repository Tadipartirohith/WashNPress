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
  await container.store.slots.put(slot);
  for (const pickup of await container.store.pickups.find((p) => p.slotId === slotId)) {
    pickup.scheduledFor = new Date(Date.now() - 3600_000).toISOString();
    await container.store.pickups.put(pickup);
  }
}
