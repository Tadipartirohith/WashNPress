import { randomUUID } from "node:crypto";
import type { DataStore } from "./ports/repositories";
import type { AppConfig } from "./config";
import { addDaysIso } from "./domain/subscriptions";
import { serviceDay } from "./services/scheduling-service";
import { defaultSystemConfig } from "./services/system-config-service";

export const SEED_IDS = {
  societyId: "soc-demo",
  societyTwoId: "soc-aparna",
  societyThreeId: "soc-gachibowli",
  blockAId: "block-demo-a",
  blockBId: "block-demo-b",
  blockCId: "block-demo-c",
  unitId: "unit-demo",
  adminUserId: "user-admin",
  supervisorUserId: "user-sup",
  supervisorTwoUserId: "user-sup-2",
  operatorUserId: "user-op",
  operatorTwoUserId: "user-op-2",
  operatorThreeUserId: "user-op-3",
  residentUserId: "user-res",
  residentId: "res-demo",
  planBasicId: "plan-basic",
  planStandardId: "plan-standard",
} as const;

export type SeedIds = { -readonly [K in keyof typeof SEED_IDS]: string };

// Populates a store with three societies, their supervisors, blocks, operations
// staff, plans, add-ons and slots, so every portal is usable straight away and the
// society boundary is demonstrable. All values are illustrative.
export async function seedStore(store: DataStore, config: AppConfig): Promise<SeedIds> {
  const ids: SeedIds = { ...SEED_IDS };
  const now = new Date().toISOString();

  await store.systemConfig.put({
    ...defaultSystemConfig(),
    defaultSlotCapacity: config.scheduling.defaultSlotCapacity,
  });

  await store.users.put({
    id: ids.adminUserId, phone: "9876500001", fullName: "Platform Admin", email: "admin@washnpress.example",
    employeeId: "WNP-ADM-01", status: "active", roles: ["admin"], lastLoginAt: null,
    // Seeded accounts are the ones already in use, so they are already vouched for.
    verificationStatus: "approved", verifiedByUserId: null, verifiedAt: now, verificationNote: null,
    societyIds: [], createdAt: now,
  });
  await store.users.put({
    id: ids.supervisorUserId, phone: "9876500011", fullName: "Ravi Kumar", email: "ravi@washnpress.example",
    employeeId: "SUP-001", status: "active", roles: ["supervisor"], lastLoginAt: null,
    // Seeded accounts are the ones already in use, so they are already vouched for.
    verificationStatus: "approved", verifiedByUserId: null, verifiedAt: now, verificationNote: null,
    // A supervisor runs exactly one society, and that is the whole of their scope.
    societyIds: [ids.societyId], createdAt: now,
  });
  await store.users.put({
    id: ids.supervisorTwoUserId, phone: "9876500012", fullName: "Meera Nair", email: "meera@washnpress.example",
    employeeId: "SUP-002", status: "active", roles: ["supervisor"], lastLoginAt: null,
    // Seeded accounts are the ones already in use, so they are already vouched for.
    verificationStatus: "approved", verifiedByUserId: null, verifiedAt: now, verificationNote: null,
    societyIds: [ids.societyThreeId], createdAt: now,
  });

  await store.societies.put({
    id: ids.societyId, name: "My Home Bhooja",
    address: {
      house: "My Home Bhooja", street: "Kavuri Hills Road", locality: "Madhapur",
      city: "Hyderabad", state: "Telangana", pincode: "500081",
    },
    status: "active", supervisorUserId: ids.supervisorUserId, createdAt: now,
  });
  await store.societies.put({
    id: ids.societyTwoId, name: "Aparna Heights",
    address: {
      house: "Aparna Heights", street: "Madhapur Main Road", locality: "Madhapur",
      city: "Hyderabad", state: "Telangana", pincode: "500081",
    },
    // Deliberately left without a supervisor, so the assignment screens have a
    // society actually waiting for one rather than only societies already covered.
    status: "active", supervisorUserId: null, createdAt: now,
  });
  // A third society under a different supervisor, so the society boundary is visible
  // in the demo data rather than having to be set up during a demo.
  await store.societies.put({
    id: ids.societyThreeId, name: "Gachibowli Society",
    address: {
      house: "Tower 5", street: "Financial District Road", locality: "Gachibowli",
      city: "Hyderabad", state: "Telangana", pincode: "500032",
    },
    status: "active", supervisorUserId: ids.supervisorTwoUserId, createdAt: now,
  });

  // Societies nobody runs yet, so the assignment screens and the "societies waiting
  // for a supervisor" tile have something real to work with rather than needing one
  // to be invented during a demo. Each has its towers, because a society whose
  // blocks were never named is a society whose work cannot be given to anybody.
  for (const [id, name, house, locality, pincode, blocks] of [
    ["soc-green-meadows", "Green Meadows", "Green Meadows", "Kondapur", "500084", ["A", "B"]],
    ["soc-lakeview", "Lakeview Enclave", "Lakeview Enclave", "KPHB", "500072", ["Tower 1", "Tower 2"]],
    ["soc-whitefield", "Whitefield Residency", "Whitefield Residency", "Whitefield", "560066", ["East", "West"]],
  ] as const) {
    await store.societies.put({
      id, name,
      address: {
        house, street: "Main Road", locality,
        city: pincode.startsWith("56") ? "Bengaluru" : "Hyderabad",
        state: pincode.startsWith("56") ? "Karnataka" : "Telangana",
        pincode,
      },
      status: "active", supervisorUserId: null, createdAt: now,
    });
    for (const blockName of blocks) {
      await store.blocks.put({
        id: `block-${id}-${blockName.toLowerCase().replace(/\s+/g, "-")}`,
        societyId: id, name: blockName, flatCount: 24,
        operatorUserIds: [], status: "active", createdAt: now,
      });
    }
  }

  // The towers work is actually divided by. Three of them, of different sizes, so
  // the assignment screens show a real allocation rather than one block per society.
  for (const [id, societyId, name, flatCount, operatorUserIds] of [
    // Blocks are what an operator is actually given, so the demo data divides My
    // Home Bhooja between two of them rather than handing one person all of it.
    [ids.blockAId, ids.societyId, "A", 40, [ids.operatorUserId]],
    [ids.blockBId, ids.societyId, "B", 30, [ids.operatorUserId]],
    [ids.blockCId, ids.societyId, "C", 50, [ids.operatorThreeUserId]],
    ["block-aparna-1", ids.societyTwoId, "Tower 1", 64, []],
    ["block-aparna-2", ids.societyTwoId, "Tower 2", 48, []],
    ["block-gcb-north", ids.societyThreeId, "North Wing", 36, [ids.operatorTwoUserId]],
    ["block-gcb-south", ids.societyThreeId, "South Wing", 36, [ids.operatorTwoUserId]],
  ] as const) {
    await store.blocks.put({
      id, societyId, name, flatCount, operatorUserIds: [...operatorUserIds],
      status: "active", createdAt: now,
    });
  }

  await store.users.put({
    id: ids.operatorUserId, phone: "9876500002", fullName: "Operator 01", email: null,
    employeeId: "WNP-OPS-001", status: "active", roles: ["operator"], lastLoginAt: null,
    // Seeded accounts are the ones already in use, so they are already vouched for.
    verificationStatus: "approved", verifiedByUserId: null, verifiedAt: now, verificationNote: null,
    // One society, and two of its three towers.
    societyIds: [ids.societyId], blockIds: [ids.blockAId, ids.blockBId], createdAt: now,
  });
  await store.users.put({
    id: ids.operatorTwoUserId, phone: "9876500003", fullName: "Operator 02", email: null,
    employeeId: "WNP-OPS-002", status: "active", roles: ["operator"], lastLoginAt: null,
    // Seeded accounts are the ones already in use, so they are already vouched for.
    verificationStatus: "approved", verifiedByUserId: null, verifiedAt: now, verificationNote: null,
    societyIds: [ids.societyThreeId], blockIds: ["block-gcb-north", "block-gcb-south"], createdAt: now,
  });
  // The third tower of My Home Bhooja, and the reason handover has somewhere to go.
  // Cover comes from inside the society now — an operator from the next society
  // along has no blocks here and could not act on the work even if it were handed
  // to them — so a society with one operator is a society whose work strands the
  // moment they go on leave.
  await store.users.put({
    id: ids.operatorThreeUserId, phone: "9876500004", fullName: "Operator 03", email: null,
    employeeId: "WNP-OPS-003", status: "active", roles: ["operator"], lastLoginAt: null,
    verificationStatus: "approved", verifiedByUserId: null, verifiedAt: now, verificationNote: null,
    societyIds: [ids.societyId], blockIds: [ids.blockCId], createdAt: now,
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
    societyIds: [], createdAt: now,
  });
  await store.residents.put({
    id: ids.residentId, userId: ids.residentUserId, societyId: ids.societyId, unitNumber: "A-402",
    towerBlock: "A", blockId: ids.blockAId, preferredWindows: ["Morning"], address: "A-402, My Home Bhooja, Kavuri Hills",
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
    // Daily by default, meaning any day of the week. A plan's frequency now decides
    // which days a resident may book that service on, so seeding "weekly on Monday"
    // would ship a demo where washing can only be collected on Mondays. A plan that
    // genuinely restricts the days is configured to, rather than falling into it.
    frequency: "one_time" | "daily" | "alternate_days" | "twice_weekly" | "weekly" | "custom" = "daily",
    frequencyDays: number[] = [],
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
      planService("iron_only", "Iron only", "piece", 30, 1500),
    ],
    monthlyPaise: 89900, annualDiscountPercent: 15, isActive: true,
    coveredServiceIds: ["wash_iron", "wash_only", "iron_only"],
  });
  await store.plans.put({
    id: "plan-premium", tier: "Premium", name: "Premium Care",
    description: "Everything, including dry cleaning.",
    garmentCap: 120, turnaroundHours: 24, pickupsPerCycle: 15,
    services: [
      planService("wash_iron", "Wash and Iron", "kg", 60, 6000),
      planService("wash_only", "Wash only", "kg", 30, 4500),
      planService("iron_only", "Iron only", "piece", 40, 1500),
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
      planService("wash_iron", "Wash and Iron", "kg", 100, 5500),
      planService("wash_only", "Wash only", "kg", 50, 4000),
      // Kept on a restricted cadence so a seeded system shows the rule working:
      // this plan collects ironing on Tuesdays and Fridays and refuses other days.
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
  for (const societyId of [ids.societyId, ids.societyTwoId, ids.societyThreeId]) {
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
