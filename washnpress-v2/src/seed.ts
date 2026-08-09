import { randomUUID } from "node:crypto";
import type { DataStore } from "./ports/repositories";
import type { AppConfig } from "./config";
import { addDaysIso } from "./domain/subscriptions";

export const SEED_IDS = {
  societyId: "soc-demo", unitId: "unit-demo", adminUserId: "user-admin", operatorUserId: "user-op",
  residentUserId: "user-res", residentId: "res-demo", planBasicId: "plan-basic", planStandardId: "plan-standard",
} as const;

export interface SeedIds {
  societyId: string; unitId: string; adminUserId: string; operatorUserId: string;
  residentUserId: string; residentId: string; planBasicId: string; planStandardId: string;
}

// Populates a store with a demo society, unit, staff, plans, add-ons and slots so the
// platform is usable immediately. All values are illustrative and safe to change.
export async function seedStore(store: DataStore, config: AppConfig): Promise<SeedIds> {
  const societyId = "soc-demo";
  await store.societies.put({ id: societyId, name: "Green Meadows", city: "Hyderabad", state: "Telangana", status: "active" });

  const adminUserId = "user-admin";
  await store.users.put({ id: adminUserId, phone: "9876500001", fullName: "Admin", status: "active", roles: ["admin"], lastLoginAt: null });
  const operatorUserId = "user-op";
  await store.users.put({ id: operatorUserId, phone: "9876500002", fullName: "Unit Operator", status: "active", roles: ["operator"], lastLoginAt: null });

  const unitId = "unit-demo";
  await store.units.put({ id: unitId, societyId, name: "Green Meadows Unit", operatorUserIds: [operatorUserId], waterRecyclingEnabled: true, baseDrawPaise: 1500000, revenueSharePercent: 15, status: "active" });

  const residentUserId = "user-res";
  await store.users.put({ id: residentUserId, phone: "9876543210", fullName: "Asha", status: "active", roles: ["resident"], lastLoginAt: null });
  const residentId = "res-demo";
  await store.residents.put({ id: residentId, userId: residentUserId, societyId, unitNumber: "A-101", towerBlock: "A", preferredWindows: ["Morning"] });

  const planBasicId = "plan-basic";
  const planStandardId = "plan-standard";
  await store.plans.put({ id: planBasicId, tier: "Basic", garmentCap: 40, turnaroundHours: 48, monthlyPaise: 49900, annualDiscountPercent: 15, isActive: true });
  await store.plans.put({ id: planStandardId, tier: "Standard", garmentCap: 80, turnaroundHours: 36, monthlyPaise: 89900, annualDiscountPercent: 15, isActive: true });
  await store.plans.put({ id: "plan-premium", tier: "Premium", garmentCap: 120, turnaroundHours: 24, monthlyPaise: 129900, annualDiscountPercent: 20, isActive: true });
  await store.plans.put({ id: "plan-family", tier: "Family Pack", garmentCap: 200, turnaroundHours: 36, monthlyPaise: 199900, annualDiscountPercent: 20, isActive: true });

  await store.addons.put({ id: "addon-dryclean", name: "Dry cleaning", pricePaise: 15000, isActive: true });
  await store.addons.put({ id: "addon-express", name: "Express delivery", pricePaise: 9900, isActive: true });
  await store.addons.put({ id: "addon-shoe", name: "Shoe and bag cleaning", pricePaise: 19900, isActive: true });

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = addDaysIso(new Date().toISOString(), 1).slice(0, 10);
  for (const date of [today, tomorrow]) {
    for (const window of config.scheduling.slotWindows) {
      await store.slots.put({
        id: randomUUID(), societyId, date, window,
        startTime: window === "Morning" ? "08:00" : window === "Afternoon" ? "13:00" : "17:00",
        endTime: window === "Morning" ? "11:00" : window === "Afternoon" ? "16:00" : "20:00",
        capacityTotal: config.scheduling.defaultSlotCapacity, capacityRemaining: config.scheduling.defaultSlotCapacity, isActive: true,
      });
    }
  }

  return { societyId, unitId, adminUserId, operatorUserId, residentUserId, residentId, planBasicId, planStandardId };
}

