import { randomUUID } from "node:crypto";
import { loadConfig, resetConfigCache } from "../../src/config";
import { buildContainer, type Container } from "../../src/container";
import { buildApp } from "../../src/app/build-app";
import type { Slot } from "../../src/domain/models";

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

export function seedSlot(container: Container, id: string, capacity: number): Promise<Slot> {
  return container.store.slots.put({
    id, societyId: "soc-demo", date: "2099-01-01", window: "Morning",
    startTime: "08:00", endTime: "11:00", capacityTotal: capacity, capacityRemaining: capacity, isActive: true,
  });
}

// Logs a resident in and returns a bearer token for authenticated requests.
export async function loginResident(app: Awaited<ReturnType<typeof makeTestApp>>["app"], phone = "9876543210"): Promise<string> {
  const send = await app.inject({ method: "POST", url: "/v1/auth/otp/send", headers: { "content-type": "application/json" }, payload: JSON.stringify({ phone }) });
  const otp = send.json().otpForTesting as string;
  const verify = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { "content-type": "application/json" }, payload: JSON.stringify({ phone, otp }) });
  return verify.json().token as string;
}

export async function loginOperator(app: Awaited<ReturnType<typeof makeTestApp>>["app"]): Promise<string> {
  return loginResident(app, "9876500002");
}

export function bearer(token: string) { return { "content-type": "application/json", authorization: `Bearer ${token}` }; }
export function uuid() { return randomUUID(); }
