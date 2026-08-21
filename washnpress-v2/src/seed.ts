import { randomUUID } from "node:crypto";
import type { DataStore } from "./ports/repositories";
import type { AppConfig } from "./config";
import { addDaysIso } from "./domain/subscriptions";
import { serviceDay } from "./services/scheduling-service";
import { defaultSystemConfig } from "./services/system-config-service";

export const SEED_IDS = {
  areaMadhapurId: "area-madhapur",
  areaGachibowliId: "area-gachibowli",
  societyId: "soc-demo",
  societyTwoId: "soc-aparna",
  societyOtherAreaId: "soc-gachibowli",
  unitId: "unit-demo",
  adminUserId: "user-admin",
  supervisorUserId: "user-sup",
  supervisorTwoUserId: "user-sup-2",
  operatorUserId: "user-op",
  operatorTwoUserId: "user-op-2",
  residentUserId: "user-res",
  residentId: "res-demo",
  planBasicId: "plan-basic",
  planStandardId: "plan-standard",
} as const;

export type SeedIds = { -readonly [K in keyof typeof SEED_IDS]: string };

// Populates a store with two operational areas, their supervisors, societies,
// operations staff, plans, add-ons and slots so every portal is usable straight
// away and the area boundary is demonstrable. All values are illustrative.
export async function seedStore(store: DataStore, config: AppConfig): Promise<SeedIds> {
  const ids: SeedIds = { ...SEED_IDS };
  const now = new Date().toISOString();

  await store.systemConfig.put({
    ...defaultSystemConfig(),
    defaultSlotCapacity: config.scheduling.defaultSlotCapacity,
  });

  await store.areas.put({
    id: ids.areaMadhapurId, name: "Madhapur", code: "MDH", description: "Madhapur and Hitec City corridor",
    region: "Hyderabad", status: "active", supervisorUserId: ids.supervisorUserId, createdAt: now,
  });
  await store.areas.put({
    id: ids.areaGachibowliId, name: "Gachibowli", code: "GCB", description: "Gachibowli and Financial District",
    region: "Hyderabad", status: "active", supervisorUserId: ids.supervisorTwoUserId, createdAt: now,
  });
  // Three more areas with no supervisor yet, so the admin coverage view and the
  // "create an operator before a supervisor exists" flow both have something real
  // to work with rather than needing one to be invented during a demo.
  for (const [id, name, code, description] of [
    ["area-kondapur", "Kondapur", "KDP", "Kondapur and Botanical Garden road"],
    ["area-kphb", "KPHB", "KPH", "Kukatpally Housing Board colony"],
    ["area-manikonda", "Manikonda", "MNK", "Manikonda and Puppalguda"],
  ] as const) {
    await store.areas.put({
      id, name, code, description, region: "Hyderabad",
      status: "active", supervisorUserId: null, createdAt: now,
    });
  }

  await store.users.put({
    id: ids.adminUserId, phone: "9876500001", fullName: "Platform Admin", email: "admin@washnpress.example",
    employeeId: "WNP-ADM-01", status: "active", roles: ["admin"], lastLoginAt: null,
    areaId: null, societyIds: [], createdAt: now,
  });
  await store.users.put({
    id: ids.supervisorUserId, phone: "9876500011", fullName: "Ravi Kumar", email: "ravi@washnpress.example",
    employeeId: "WNP-SUP-01", status: "active", roles: ["supervisor"], lastLoginAt: null,
    areaId: ids.areaMadhapurId, societyIds: [], createdAt: now,
  });
  await store.users.put({
    id: ids.supervisorTwoUserId, phone: "9876500012", fullName: "Meera Nair", email: "meera@washnpress.example",
    employeeId: "WNP-SUP-02", status: "active", roles: ["supervisor"], lastLoginAt: null,
    areaId: ids.areaGachibowliId, societyIds: [], createdAt: now,
  });

  await store.societies.put({
    id: ids.societyId, name: "My Home Bhooja", code: "MHB", areaId: ids.areaMadhapurId,
    address: "Kavuri Hills, Madhapur", city: "Hyderabad", state: "Telangana", status: "active", createdAt: now,
  });
  await store.societies.put({
    id: ids.societyTwoId, name: "Aparna Heights", code: "APH", areaId: ids.areaMadhapurId,
    address: "Madhapur Main Road", city: "Hyderabad", state: "Telangana", status: "active", createdAt: now,
  });
  // A society in the other area, so the area boundary is visible in the demo data.
  await store.societies.put({
    id: ids.societyOtherAreaId, name: "Gachibowli Society", code: "GBS", areaId: ids.areaGachibowliId,
    address: "Financial District", city: "Hyderabad", state: "Telangana", status: "active", createdAt: now,
  });

  await store.users.put({
    id: ids.operatorUserId, phone: "9876500002", fullName: "Operator 01", email: null,
    employeeId: "WNP-OPS-01", status: "active", roles: ["operator"], lastLoginAt: null,
    areaId: ids.areaMadhapurId, societyIds: [ids.societyId, ids.societyTwoId], createdAt: now,
  });
  await store.users.put({
    id: ids.operatorTwoUserId, phone: "9876500003", fullName: "Operator 02", email: null,
    employeeId: "WNP-OPS-02", status: "active", roles: ["operator"], lastLoginAt: null,
    areaId: ids.areaGachibowliId, societyIds: [ids.societyOtherAreaId], createdAt: now,
  });

  await store.units.put({
    id: ids.unitId, societyId: ids.societyId, name: "My Home Bhooja Unit",
    operatorUserIds: [ids.operatorUserId], waterRecyclingEnabled: true,
    baseDrawPaise: 1500000, revenueSharePercent: 15, status: "active",
  });

  await store.users.put({
    id: ids.residentUserId, phone: "9876543210", fullName: "Anusha", email: "anusha@example.com",
    employeeId: null, status: "active", roles: ["resident"], lastLoginAt: null,
    areaId: null, societyIds: [], createdAt: now,
  });
  await store.residents.put({
    id: ids.residentId, userId: ids.residentUserId, societyId: ids.societyId, unitNumber: "A-402",
    towerBlock: "A", preferredWindows: ["Morning"], address: "A-402, My Home Bhooja, Kavuri Hills",
    pickupAddress: "A-402, My Home Bhooja, Kavuri Hills", onboardingCompleted: true, onboardedAt: now,
  });

  await store.plans.put({ id: ids.planBasicId, tier: "Basic", garmentCap: 40, turnaroundHours: 48, monthlyPaise: 49900, annualDiscountPercent: 15, isActive: true, coveredServiceIds: ["wash_iron", "wash_only"] });
  await store.plans.put({ id: ids.planStandardId, tier: "Standard", garmentCap: 80, turnaroundHours: 36, monthlyPaise: 89900, annualDiscountPercent: 15, isActive: true, coveredServiceIds: ["wash_iron", "wash_only", "iron_only"] });
  await store.plans.put({ id: "plan-premium", tier: "Premium", garmentCap: 120, turnaroundHours: 24, monthlyPaise: 129900, annualDiscountPercent: 20, isActive: true, coveredServiceIds: ["wash_iron", "wash_only", "iron_only", "dryclean_iron"] });
  await store.plans.put({ id: "plan-family", tier: "Family Pack", garmentCap: 200, turnaroundHours: 36, monthlyPaise: 199900, annualDiscountPercent: 20, isActive: true, coveredServiceIds: ["wash_iron", "wash_only", "iron_only"] });

  await store.addons.put({ id: "addon-dryclean", name: "Dry cleaning", pricePaise: 15000, isActive: true });
  await store.addons.put({ id: "addon-express", name: "Express delivery", pricePaise: 9900, isActive: true });
  await store.addons.put({ id: "addon-shoe", name: "Shoe and bag cleaning", pricePaise: 19900, isActive: true });

  // The operation's own calendar day, not UTC. Seeding by UTC would put half the
  // slots on a day that has already ended locally, so a freshly seeded database
  // would come up with nothing bookable for the first five and a half hours after
  // midnight.
  const today = serviceDay(new Date());
  const tomorrow = serviceDay(addDaysIso(new Date().toISOString(), 1));
  for (const societyId of [ids.societyId, ids.societyTwoId, ids.societyOtherAreaId]) {
    for (const date of [today, tomorrow]) {
      for (const window of config.scheduling.slotWindows) {
        await store.slots.put({
          id: randomUUID(), societyId, date, window,
          startTime: window === "Morning" ? "08:00" : window === "Afternoon" ? "13:00" : "17:00",
          endTime: window === "Morning" ? "11:00" : window === "Afternoon" ? "16:00" : "20:00",
          capacityTotal: config.scheduling.defaultSlotCapacity,
          capacityRemaining: config.scheduling.defaultSlotCapacity,
          isActive: true,
        });
      }
    }
  }

  return ids;
}
