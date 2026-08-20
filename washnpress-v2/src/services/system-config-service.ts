import type { GarmentService, SystemConfig } from "../domain/models";
import type { DataStore } from "../ports/repositories";

export const SYSTEM_CONFIG_ID = "system";

export const DEFAULT_GARMENT_CATEGORIES = [
  "Shirts", "T-Shirts", "Trousers", "Jeans", "Dresses",
  "Sarees", "Bedsheets", "Towels", "Jackets", "Other",
];

// The base service is what a subscription covers, so it is priced at zero. Anything
// premium is charged per garment on top, whether or not the resident subscribes.
export const DEFAULT_GARMENT_SERVICES: GarmentService[] = [
  { id: "wash_iron", name: "Wash and Iron", unitPricePaise: 0, isBase: true, isActive: true },
  { id: "wash_only", name: "Wash only", unitPricePaise: 0, isBase: false, isActive: true },
  { id: "iron_only", name: "Iron only", unitPricePaise: 0, isBase: false, isActive: true },
  { id: "dryclean_iron", name: "Dry Clean and Iron", unitPricePaise: 8000, isBase: false, isActive: true },
  { id: "premium_care", name: "Premium care", unitPricePaise: 12000, isBase: false, isActive: true },
];

export function defaultSystemConfig(): SystemConfig {
  return {
    id: SYSTEM_CONFIG_ID,
    additionalGarmentRatePaise: 2000,
    nonSubscriberGarmentRatePaise: 3000,
    garmentServices: DEFAULT_GARMENT_SERVICES.map((s) => ({ ...s })),
    garmentCategories: [...DEFAULT_GARMENT_CATEGORIES],
    defaultSlotCapacity: 20,
    defaultTurnaroundHours: 48,
    delayGraceHours: 2,
    qcRequired: true,
    notificationsEnabled: true,
    updatedAt: new Date().toISOString(),
    updatedByUserId: null,
  };
}

// Global application settings. Only an admin may change them; every other part of
// the system reads them, so the garment rates, the service catalogue and the
// garment categories have exactly one source of truth.
export class SystemConfigService {
  constructor(private readonly store: DataStore) {}

  async get(): Promise<SystemConfig> {
    const existing = await this.store.systemConfig.get(SYSTEM_CONFIG_ID);
    if (!existing) return this.store.systemConfig.put(defaultSystemConfig());
    // A config written by an earlier version is filled in rather than rejected, so
    // an upgrade never leaves the platform without a service catalogue.
    const defaults = defaultSystemConfig();
    const merged: SystemConfig = {
      ...defaults,
      ...existing,
      garmentServices: existing.garmentServices?.length ? existing.garmentServices : defaults.garmentServices,
      garmentCategories: existing.garmentCategories?.length ? existing.garmentCategories : defaults.garmentCategories,
      nonSubscriberGarmentRatePaise: existing.nonSubscriberGarmentRatePaise ?? defaults.nonSubscriberGarmentRatePaise,
    };
    return merged;
  }

  async update(patch: Partial<Omit<SystemConfig, "id">>, updatedByUserId: string): Promise<{ previous: SystemConfig; current: SystemConfig }> {
    const previous = await this.get();
    const current: SystemConfig = {
      ...previous, ...patch, id: SYSTEM_CONFIG_ID,
      updatedAt: new Date().toISOString(), updatedByUserId,
    };
    await this.store.systemConfig.put(current);
    return { previous, current };
  }

  async additionalGarmentRatePaise(): Promise<number> {
    return (await this.get()).additionalGarmentRatePaise;
  }

  async activeServices(): Promise<GarmentService[]> {
    return (await this.get()).garmentServices.filter((s) => s.isActive);
  }
}
