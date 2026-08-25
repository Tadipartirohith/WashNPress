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
    // Seeded accounts are the ones already in use, so they are already vouched for.
    verificationStatus: "approved", verifiedByUserId: null, verifiedAt: now, verificationNote: null,
    areaId: null, societyIds: [], createdAt: now,
  });
  await store.users.put({
    id: ids.supervisorUserId, phone: "9876500011", fullName: "Ravi Kumar", email: "ravi@washnpress.example",
    employeeId: "WNP-SUP-01", status: "active", roles: ["supervisor"], lastLoginAt: null,
    // Seeded accounts are the ones already in use, so they are already vouched for.
    verificationStatus: "approved", verifiedByUserId: null, verifiedAt: now, verificationNote: null,
    areaId: ids.areaMadhapurId, societyIds: [], createdAt: now,
  });
  await store.users.put({
    id: ids.supervisorTwoUserId, phone: "9876500012", fullName: "Meera Nair", email: "meera@washnpress.example",
    employeeId: "WNP-SUP-02", status: "active", roles: ["supervisor"], lastLoginAt: null,
    // Seeded accounts are the ones already in use, so they are already vouched for.
    verificationStatus: "approved", verifiedByUserId: null, verifiedAt: now, verificationNote: null,
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
    // Seeded accounts are the ones already in use, so they are already vouched for.
    verificationStatus: "approved", verifiedByUserId: null, verifiedAt: now, verificationNote: null,
    areaId: ids.areaMadhapurId, societyIds: [ids.societyId, ids.societyTwoId], createdAt: now,
  });
  await store.users.put({
    id: ids.operatorTwoUserId, phone: "9876500003", fullName: "Operator 02", email: null,
    employeeId: "WNP-OPS-02", status: "active", roles: ["operator"], lastLoginAt: null,
    // Seeded accounts are the ones already in use, so they are already vouched for.
    verificationStatus: "approved", verifiedByUserId: null, verifiedAt: now, verificationNote: null,
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
    // Seeded accounts are the ones already in use, so they are already vouched for.
    verificationStatus: "approved", verifiedByUserId: null, verifiedAt: now, verificationNote: null,
    areaId: null, societyIds: [], createdAt: now,
  });
  await store.residents.put({
    id: ids.residentId, userId: ids.residentUserId, societyId: ids.societyId, unitNumber: "A-402",
    towerBlock: "A", preferredWindows: ["Morning"], address: "A-402, My Home Bhooja, Kavuri Hills",
    pickupAddress: "A-402, My Home Bhooja, Kavuri Hills", onboardingCompleted: true, onboardedAt: now,
  });

  // The services that are not laundry. Configuration rather than code, so a third
  // line would be added here rather than in a release.
  await store.offerings.put({
    id: "wash-car", kind: "vehicle_wash", name: "Car wash",
    description: "Exterior wash and interior vacuum, at your parking space.",
    pricingBasis: "per_job", unitPricePaise: 39900,
    vehicleTypes: ["Car"], minimumHours: null, isActive: true,
  });
  await store.offerings.put({
    id: "wash-bike", kind: "vehicle_wash", name: "Bike wash",
    description: "Exterior wash and chain clean, at your parking space.",
    pricingBasis: "per_job", unitPricePaise: 19900,
    vehicleTypes: ["Bike"], minimumHours: null, isActive: true,
  });
  await store.offerings.put({
    id: "iron-at-home", kind: "home_ironing", name: "At-home ironing",
    description: "Ironing done at your flat, charged by the hour.",
    pricingBasis: "per_hour", unitPricePaise: 29900,
    vehicleTypes: [], minimumHours: 1, isActive: true,
  });

  // A plan is a set of services, each allowanced in its own unit. Washing is
  // weighed, ironing is counted, and using one never eats into the other.
  const planService = (
    serviceId: string, serviceName: string, unit: "kg" | "piece",
    includedQuantity: number, additionalRatePaise: number,
    frequency: "one_time" | "alternate_days" | "twice_weekly" | "weekly" = "weekly",
    frequencyDays: number[] = [1],
  ) => ({
    serviceId, serviceName, unit, includedQuantity, frequency, frequencyDays,
    maxPerFrequency: null, maxPerCycle: null, carryForward: false,
    additionalUsage: "pay_per_use" as const, additionalRatePaise,
  });

  await store.plans.put({
    id: ids.planBasicId, tier: "Basic", name: "Basic",
    description: "Weekly washing for a small household.",
    garmentCap: 40, turnaroundHours: 48, pickupsPerCycle: 4,
    services: [
      planService("wash_iron", "Wash and Iron", "kg", 20, 6000),
      planService("iron_only", "Iron only", "piece", 15, 1500),
    ],
    monthlyPaise: 49900, annualDiscountPercent: 15, isActive: true,
    coveredServiceIds: ["wash_iron", "wash_only"],
  });
  await store.plans.put({
    id: ids.planStandardId, tier: "Standard", name: "Standard",
    description: "More washing, and ironing twice a week.",
    garmentCap: 80, turnaroundHours: 36, pickupsPerCycle: 8,
    services: [
      planService("wash_iron", "Wash and Iron", "kg", 40, 6000),
      planService("wash_only", "Wash only", "kg", 20, 4500),
      planService("iron_only", "Iron only", "piece", 30, 1500, "twice_weekly", [2, 5]),
    ],
    monthlyPaise: 89900, annualDiscountPercent: 15, isActive: true,
    coveredServiceIds: ["wash_iron", "wash_only", "iron_only"],
  });
  await store.plans.put({
    id: "plan-premium", tier: "Premium", name: "Premium Care",
    description: "Everything, including dry cleaning.",
    garmentCap: 120, turnaroundHours: 24, pickupsPerCycle: 15,
    services: [
      planService("wash_iron", "Wash and Iron", "kg", 60, 6000, "alternate_days", []),
      planService("wash_only", "Wash only", "kg", 30, 4500),
      planService("iron_only", "Iron only", "piece", 40, 1500, "twice_weekly", [2, 5]),
      { ...planService("dryclean_iron", "Dry Clean and Iron", "piece", 10, 6000), carryForward: true },
    ],
    monthlyPaise: 129900, annualDiscountPercent: 20, isActive: true,
    coveredServiceIds: ["wash_iron", "wash_only", "iron_only", "dryclean_iron"],
  });
  await store.plans.put({
    id: "plan-family", tier: "Family Pack", name: "Family Pack",
    description: "Built for a full household.",
    garmentCap: 200, turnaroundHours: 36, pickupsPerCycle: 15,
    services: [
      planService("wash_iron", "Wash and Iron", "kg", 100, 5500, "alternate_days", []),
      planService("wash_only", "Wash only", "kg", 50, 4000),
      planService("iron_only", "Iron only", "piece", 60, 1200, "twice_weekly", [2, 5]),
    ],
    monthlyPaise: 199900, annualDiscountPercent: 20, isActive: true,
    coveredServiceIds: ["wash_iron", "wash_only", "iron_only"],
  });

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
