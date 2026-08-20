import type { SystemConfig } from "../domain/models";
import type { DataStore } from "../ports/repositories";

export const SYSTEM_CONFIG_ID = "system";

export const DEFAULT_GARMENT_CATEGORIES = [
  "Shirts", "T-Shirts", "Trousers", "Jeans", "Dresses",
  "Sarees", "Bedsheets", "Towels", "Jackets", "Other",
];

export function defaultSystemConfig(): SystemConfig {
  return {
    id: SYSTEM_CONFIG_ID,
    additionalGarmentRatePaise: 2000,
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
// the system reads them, so the additional garment rate and the garment categories
// have exactly one source of truth.
export class SystemConfigService {
  constructor(private readonly store: DataStore) {}

  async get(): Promise<SystemConfig> {
    const existing = await this.store.systemConfig.get(SYSTEM_CONFIG_ID);
    if (existing) return existing;
    return this.store.systemConfig.put(defaultSystemConfig());
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
}
