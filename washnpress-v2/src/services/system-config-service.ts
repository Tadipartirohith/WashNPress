import type { GarmentService, SystemConfig } from "../domain/models";
import type { DataStore } from "../ports/repositories";

export const SYSTEM_CONFIG_ID = "system";

export class DuplicateServiceError extends Error {
  constructor(id: string) { super("A garment service with id " + id + " already exists"); this.name = "DuplicateServiceError"; }
}
export class InvalidServiceError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidServiceError"; }
}

// "Starch and Press" becomes "starch_and_press", so a service gets a stable readable
// id without the admin having to invent one.
export function slugifyServiceName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

export const DEFAULT_GARMENT_CATEGORIES = [
  "Shirts", "T-Shirts", "Trousers", "Jeans", "Dresses",
  "Sarees", "Bedsheets", "Towels", "Jackets", "Other",
];

// The base service is what a subscription covers, so it is priced at zero. Anything
// premium is charged per garment on top, whether or not the resident subscribes, and
// the price depends on the garment: pressing a saree is not pressing a shirt.
//
// Each service also declares what physically has to happen to the garment, which is
// what lets an Iron Only order skip washing entirely.
export const DEFAULT_GARMENT_SERVICES: GarmentService[] = [
  { id: "wash_iron", name: "Wash and Iron", unitPricePaise: 0, pricesPaise: {},
    requiresClean: true, cleanStage: "wash", requiresPress: true, isBase: true, isActive: true },
  { id: "wash_only", name: "Wash only", unitPricePaise: 0, pricesPaise: {},
    requiresClean: true, cleanStage: "wash", requiresPress: false, isBase: false, isActive: true },
  { id: "iron_only", name: "Iron only", unitPricePaise: 1500,
    pricesPaise: { Shirts: 1500, "T-Shirts": 1200, Trousers: 2000, Jeans: 2000, Dresses: 2500, Sarees: 6000, Bedsheets: 3000, Towels: 1000, Jackets: 3000 },
    requiresClean: false, cleanStage: "wash", requiresPress: true, isBase: false, isActive: true },
  { id: "dryclean_iron", name: "Dry Clean and Iron", unitPricePaise: 8000,
    pricesPaise: { Shirts: 8000, "T-Shirts": 7000, Trousers: 9000, Jeans: 9000, Dresses: 14000, Sarees: 25000, Bedsheets: 12000, Towels: 5000, Jackets: 18000 },
    requiresClean: true, cleanStage: "dry_clean", requiresPress: true, isBase: false, isActive: true },
  { id: "premium_care", name: "Premium care", unitPricePaise: 12000,
    pricesPaise: { Shirts: 12000, Dresses: 20000, Sarees: 35000, Jackets: 25000 },
    requiresClean: true, cleanStage: "premium", requiresPress: true, isBase: false, isActive: true },
];

// A service written by an earlier version has no processing flags and no per garment
// prices. It is filled in rather than rejected, so an upgrade never leaves an order
// unable to move: an unknown service is assumed to need the full wash and iron path.
export function normaliseService(service: Partial<GarmentService> & { id: string; name: string }): GarmentService {
  const known = DEFAULT_GARMENT_SERVICES.find((d) => d.id === service.id);
  return {
    id: service.id,
    name: service.name,
    unitPricePaise: service.unitPricePaise ?? known?.unitPricePaise ?? 0,
    pricesPaise: service.pricesPaise ?? known?.pricesPaise ?? {},
    requiresClean: service.requiresClean ?? known?.requiresClean ?? true,
    cleanStage: service.cleanStage ?? known?.cleanStage ?? "wash",
    requiresPress: service.requiresPress ?? known?.requiresPress ?? true,
    isBase: service.isBase ?? known?.isBase ?? false,
    isActive: service.isActive ?? true,
  };
}

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
      garmentServices: (existing.garmentServices?.length ? existing.garmentServices : defaults.garmentServices).map(normaliseService),
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

  // ------------------------------------------------------ service catalogue

  // Adding a service is a first class operation rather than a whole config rewrite,
  // so an admin can introduce Starch and Press without resending the entire
  // catalogue and without risking dropping a service by omission.
  async addService(input: Partial<GarmentService> & { name: string }, updatedByUserId: string): Promise<{ previous: SystemConfig; current: SystemConfig; service: GarmentService }> {
    const previous = await this.get();
    const id = (input.id ?? slugifyServiceName(input.name)).trim();
    if (!id) throw new InvalidServiceError("A service needs a name");
    if (previous.garmentServices.some((s) => s.id === id)) throw new DuplicateServiceError(id);
    const service = normaliseService({ ...input, id, name: input.name });
    // Exactly one base service, since it is what defines what a plan covers.
    const garmentServices = service.isBase
      ? [...previous.garmentServices.map((s) => ({ ...s, isBase: false })), service]
      : [...previous.garmentServices, service];
    const { current } = await this.update({ garmentServices }, updatedByUserId);
    return { previous, current, service };
  }

  async updateService(serviceId: string, patch: Partial<GarmentService>, updatedByUserId: string): Promise<{ previous: SystemConfig; current: SystemConfig; service: GarmentService } | null> {
    const previous = await this.get();
    const existing = previous.garmentServices.find((s) => s.id === serviceId);
    if (!existing) return null;
    const service = normaliseService({ ...existing, ...patch, id: existing.id, name: patch.name ?? existing.name });
    const garmentServices = previous.garmentServices.map((s) => {
      if (s.id === serviceId) return service;
      return service.isBase ? { ...s, isBase: false } : s;
    });
    const { current } = await this.update({ garmentServices }, updatedByUserId);
    return { previous, current, service };
  }

  // A service is retired rather than deleted, because orders already reference it.
  // The base service cannot be retired, or nothing would be left for a plan to cover.
  async retireService(serviceId: string, updatedByUserId: string): Promise<{ previous: SystemConfig; current: SystemConfig } | null> {
    const previous = await this.get();
    const existing = previous.garmentServices.find((s) => s.id === serviceId);
    if (!existing) return null;
    if (existing.isBase) throw new InvalidServiceError("The base service cannot be retired");
    const garmentServices = previous.garmentServices.map((s) => (s.id === serviceId ? { ...s, isActive: false } : s));
    const { current } = await this.update({ garmentServices }, updatedByUserId);
    return { previous, current };
  }
}
