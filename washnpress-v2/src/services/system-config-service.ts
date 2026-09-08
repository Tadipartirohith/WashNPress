import { randomUUID } from "node:crypto";
import type { AdditionalCharge, CategoryGarment, GarmentGroup, GarmentService, SystemConfig, WorkingHours } from "../domain/models";
import type { DataStore } from "../ports/repositories";
import { ACTIVE_STATES } from "../domain/order-state-machine";

export const SYSTEM_CONFIG_ID = "system";

export class DuplicateChargeError extends Error {
  constructor(name: string) { super(`A charge named "${name}" already exists`); this.name = "DuplicateChargeError"; }
}
export class InvalidChargeError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidChargeError"; }
}

// Monday to Friday open 08:00–20:00, the weekend closed — the working week a new
// deployment starts from until an admin says otherwise.
export function defaultWorkingHours(): WorkingHours {
  const open = { enabled: true, start: "08:00", end: "20:00" };
  const closed = { enabled: false, start: "08:00", end: "20:00" };
  return { mon: { ...open }, tue: { ...open }, wed: { ...open }, thu: { ...open }, fri: { ...open }, sat: { ...closed }, sun: { ...closed } };
}

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
  // Ordinary washing is weighed. A bag of mixed laundry has a weight; counting it
  // as garments made "40 garments" mean something different for a household of
  // shirts than for one of bedsheets.
  { id: "wash_iron", name: "Wash and Iron", unitPricePaise: 8000, pricesPaise: {},
    unit: "kg", minimumBillable: 1, subscriberUnitPricePaise: 6000,
    requiresClean: true, cleanStage: "wash", requiresPress: true, isBase: true, isActive: true },
  { id: "wash_only", name: "Wash only", unitPricePaise: 6000, pricesPaise: {},
    unit: "kg", minimumBillable: 1, subscriberUnitPricePaise: 4500,
    requiresClean: true, cleanStage: "wash", requiresPress: false, isBase: false, isActive: true },
  { id: "iron_only", name: "Iron only", unitPricePaise: 1500, unit: "piece",
    pricesPaise: { Shirts: 1500, "T-Shirts": 1200, Trousers: 2000, Jeans: 2000, Dresses: 2500, Sarees: 6000, Bedsheets: 3000, Towels: 1000, Jackets: 3000 },
    requiresClean: false, cleanStage: "wash", requiresPress: true, isBase: false, isActive: true },
  { id: "dryclean_iron", name: "Dry Clean and Iron", unitPricePaise: 8000, unit: "piece",
    pricesPaise: { Shirts: 8000, "T-Shirts": 7000, Trousers: 9000, Jeans: 9000, Dresses: 14000, Sarees: 25000, Bedsheets: 12000, Towels: 5000, Jackets: 18000 },
    subscriberPricesPaise: { Shirts: 6000, "T-Shirts": 5000, Trousers: 7000, Jeans: 7000, Dresses: 11000, Sarees: 20000, Bedsheets: 9000, Towels: 4000, Jackets: 14000 },
    requiresClean: true, cleanStage: "dry_clean", requiresPress: true, isBase: false, isActive: true },
  { id: "premium_care", name: "Premium care", unitPricePaise: 12000, unit: "piece",
    pricesPaise: { Shirts: 12000, Dresses: 20000, Sarees: 35000, Jackets: 25000 },
    // A subscriber pays less for the specialised services, which is a large part of
    // what a plan is for.
    subscriberUnitPricePaise: 9000,
    subscriberPricesPaise: { Shirts: 9000, Dresses: 15000, Sarees: 26000, Jackets: 18000 },
    requiresClean: true, cleanStage: "premium", requiresPress: true, isBase: false, isActive: true },
  // Priced by the kilogram rather than by the garment: a bag of mixed washing is
  // weighed, not counted.
  { id: "bulk_wash", name: "Bulk wash by weight", unitPricePaise: 8000, pricesPaise: {},
    unit: "kg", minimumBillable: 2, pricingBasis: "per_kg", subscriberUnitPricePaise: 6000,
    requiresClean: true, cleanStage: "wash", requiresPress: false, isBase: false, isActive: true },
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
    // A service written before these existed is priced per garment, at one price for
    // everybody, which is exactly what it was.
    pricingBasis: service.pricingBasis ?? known?.pricingBasis ?? "per_garment",
    // A service written before units existed was counted in pieces, which is what
    // per-garment meant. Read it as that rather than as a missing value.
    unit: service.unit ?? known?.unit ?? (service.pricingBasis === "per_kg" ? "kg" : "piece"),
    minimumBillable: service.minimumBillable ?? known?.minimumBillable ?? null,
    subscriberUnitPricePaise: service.subscriberUnitPricePaise ?? known?.subscriberUnitPricePaise,
    subscriberPricesPaise: service.subscriberPricesPaise ?? known?.subscriberPricesPaise,
    requiresClean: service.requiresClean ?? known?.requiresClean ?? true,
    cleanStage: service.cleanStage ?? known?.cleanStage ?? "wash",
    requiresPress: service.requiresPress ?? known?.requiresPress ?? true,
    isBase: service.isBase ?? known?.isBase ?? false,
    isActive: service.isActive ?? true,
  };
}

// What a resident with no plan pays per garment, before any service charge. These
// are the prices the admin edits under Config, and they are entirely separate from
// what a subscription covers.
export const DEFAULT_GARMENT_PRICES_PAISE: Record<string, number> = {
  Shirts: 3000, "T-Shirts": 2500, Trousers: 4000, Jeans: 5000, Dresses: 5500,
  Sarees: 6000, Bedsheets: 7000, Towels: 2000, Jackets: 8000, Other: 3000,
};

// I-71: the default two-level garment categories. Each category groups garment items
// with a per-piece price, so a fresh install shows real categories with a garment
// count and a price range rather than one flat list.
export const DEFAULT_GARMENT_GROUPS: GarmentGroup[] = [
  { id: "grp-tops", name: "Tops", description: "Upper-body wear", status: "active", items: [
    { name: "Shirts", pricePaise: 3000 }, { name: "T-Shirts", pricePaise: 2500 }, { name: "Jackets", pricePaise: 8000 } ] },
  { id: "grp-bottoms", name: "Bottoms", description: "Lower-body wear", status: "active", items: [
    { name: "Trousers", pricePaise: 4000 }, { name: "Jeans", pricePaise: 5000 } ] },
  { id: "grp-ethnic", name: "Ethnic & Dresses", description: "Ethnic wear and dresses", status: "active", items: [
    { name: "Dresses", pricePaise: 5500 }, { name: "Sarees", pricePaise: 6000 } ] },
  { id: "grp-home", name: "Home Linen", description: "Bedsheets, towels and household linen", status: "active", items: [
    { name: "Bedsheets", pricePaise: 7000 }, { name: "Towels", pricePaise: 2000 } ] },
  { id: "grp-other", name: "Other", description: "Anything else", status: "active", items: [
    { name: "Other", pricePaise: 3000 } ] },
];

function cloneGroups(groups: GarmentGroup[]): GarmentGroup[] {
  return groups.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i })) }));
}

// The flat garment fields every pricing path already reads, DERIVED from the
// two-level categories so the two can never drift. A garment belongs to an active
// category is available; the same name in two categories takes the last price.
export function garmentFieldsFromGroups(groups: GarmentGroup[]): Pick<SystemConfig, "garmentCategories" | "garmentPricesPaise" | "garmentCategoryStatus"> {
  const garmentCategories: string[] = [];
  const garmentPricesPaise: Record<string, number> = {};
  const garmentCategoryStatus: Record<string, boolean> = {};
  for (const g of groups) for (const it of g.items) {
    if (!garmentCategories.includes(it.name)) garmentCategories.push(it.name);
    garmentPricesPaise[it.name] = it.pricePaise;
    garmentCategoryStatus[it.name] = g.status === "active";
  }
  return { garmentCategories, garmentPricesPaise, garmentCategoryStatus };
}

// A config written before two-level categories existed is presented as a single
// "General" category, so the redesigned screen always has something to show.
function synthesiseGroups(config: Pick<SystemConfig, "garmentCategories" | "garmentPricesPaise">): GarmentGroup[] {
  return [{
    id: "grp-general", name: "General", status: "active",
    items: (config.garmentCategories ?? []).map((n) => ({ name: n, pricePaise: config.garmentPricesPaise?.[n] ?? 0 })),
  }];
}

export function defaultSystemConfig(): SystemConfig {
  return {
    id: SYSTEM_CONFIG_ID,
    additionalGarmentRatePaise: 2000,
    nonSubscriberGarmentRatePaise: 3000,
    garmentPricesPaise: { ...DEFAULT_GARMENT_PRICES_PAISE },
    garmentServices: DEFAULT_GARMENT_SERVICES.map((s) => ({ ...s })),
    garmentCategories: [...DEFAULT_GARMENT_CATEGORIES],
    garmentGroups: cloneGroups(DEFAULT_GARMENT_GROUPS),
    defaultSlotCapacity: 20,
    defaultTurnaroundHours: 48,
    delayGraceHours: 2,
    slotDurationMinutes: 60,
    workingHours: defaultWorkingHours(),
    advanceBookingDays: 7,
    cancellationWindowHours: 2,
    autoClosePastSlots: true,
    qcRequired: true,
    notificationsEnabled: true,
    additionalCharges: [],
    // GST is off out of the box: a deployment is tax-free until an admin turns it
    // on. The rate carries the conventional 18% so switching it on is one toggle,
    // not a rate the admin also has to know to type.
    gstEnabled: false,
    gstRatePercent: 18,
    cancellationFreeWindowMinutes: 60,
    cancellationFeePaise: 9900,
    rescheduleFeePaise: 4900,
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
      // A config written before per garment prices existed is filled in rather than
      // left empty, so nothing suddenly falls back to one flat rate for everything.
      garmentPricesPaise: existing.garmentPricesPaise && Object.keys(existing.garmentPricesPaise).length
        ? existing.garmentPricesPaise
        : defaults.garmentPricesPaise,
      // A config written before GST existed reads as tax-free, which is what it was,
      // rather than silently picking up the default rate as an active tax.
      gstEnabled: existing.gstEnabled ?? false,
      gstRatePercent: existing.gstRatePercent ?? defaults.gstRatePercent,
      // Scheduling and charges settings arrived after the first configs were written,
      // so a config that predates them is filled in with the working-week default and
      // an empty charge catalogue rather than left with holes.
      slotDurationMinutes: existing.slotDurationMinutes ?? defaults.slotDurationMinutes,
      workingHours: existing.workingHours ?? defaults.workingHours,
      advanceBookingDays: existing.advanceBookingDays ?? defaults.advanceBookingDays,
      cancellationWindowHours: existing.cancellationWindowHours ?? defaults.cancellationWindowHours,
      autoClosePastSlots: existing.autoClosePastSlots ?? defaults.autoClosePastSlots,
      additionalCharges: existing.additionalCharges ?? [],
    };
    // The two-level categories are the source of truth; the flat garment fields are
    // always re-derived from them so every per-garment pricing path stays in step.
    const groups = merged.garmentGroups?.length ? merged.garmentGroups : synthesiseGroups(merged);
    return { ...merged, garmentGroups: groups, ...garmentFieldsFromGroups(groups) };
  }

  async update(patch: Partial<Omit<SystemConfig, "id">>, updatedByUserId: string): Promise<{ previous: SystemConfig; current: SystemConfig }> {
    const previous = await this.get();
    const current: SystemConfig = {
      ...previous, ...patch, id: SYSTEM_CONFIG_ID,
      updatedAt: new Date().toISOString(), updatedByUserId,
    };
    // Editing the two-level categories re-derives the flat garment fields so per-
    // garment pricing everywhere reflects the change immediately. A legacy direct
    // patch of the flat per-garment prices is folded into the matching category items
    // first, so the old flat API keeps working through the derived source of truth.
    if (patch.garmentGroups) {
      Object.assign(current, garmentFieldsFromGroups(patch.garmentGroups));
    } else if (patch.garmentPricesPaise) {
      const groups = cloneGroups(current.garmentGroups ?? []);
      for (const g of groups) {
        for (const it of g.items) {
          const price = patch.garmentPricesPaise[it.name];
          if (price != null) it.pricePaise = Math.max(0, Math.round(price));
        }
      }
      current.garmentGroups = groups;
      Object.assign(current, garmentFieldsFromGroups(groups));
    }
    await this.store.systemConfig.put(current);
    return { previous, current };
  }

  // ------------------------------------------------------ garment categories (I-71)

  // Create or update a two-level garment category. The flat garment fields are
  // re-derived by update() so per-garment pricing follows automatically.
  async saveGarmentGroup(
    input: { id?: string; name: string; description?: string; status: "active" | "inactive"; items: CategoryGarment[] },
    updatedByUserId: string,
  ): Promise<GarmentGroup> {
    const config = await this.get();
    const groups = cloneGroups(config.garmentGroups ?? []);
    const name = input.name.trim();
    if (!name) throw new Error("A category needs a name");
    if (groups.some((g) => g.id !== input.id && g.name.trim().toLowerCase() === name.toLowerCase())) {
      throw new Error(`A category called "${name}" already exists`);
    }
    const items = input.items
      .filter((i) => i.name.trim())
      .map((i) => ({ name: i.name.trim(), pricePaise: Math.max(0, Math.round(i.pricePaise)) }));
    let group: GarmentGroup;
    if (input.id) {
      const idx = groups.findIndex((g) => g.id === input.id);
      if (idx < 0) throw new Error("Category not found");
      group = { ...groups[idx], name, description: input.description, status: input.status, items };
      groups[idx] = group;
    } else {
      group = { id: `grp-${randomUUID().slice(0, 8)}`, name, description: input.description, status: input.status, items };
      groups.push(group);
    }
    await this.update({ garmentGroups: groups }, updatedByUserId);
    return group;
  }

  // Deletes a category unless one of its garments is on an active order — deleting it
  // then would strip a garment somebody's live order is priced against. The caller is
  // told which garments block it so the admin can deactivate the category instead.
  async deleteGarmentGroup(id: string, updatedByUserId: string): Promise<{ deleted: boolean; found: boolean; blockedBy: string[] }> {
    const config = await this.get();
    const groups = config.garmentGroups ?? [];
    const group = groups.find((g) => g.id === id);
    if (!group) return { deleted: false, found: false, blockedBy: [] };
    const names = new Set(group.items.map((i) => i.name));
    const activeOrders = await this.store.orders.find(
      (o) => ACTIVE_STATES.includes(o.state) && (o.items ?? []).some((it) => names.has(it.category)),
    );
    if (activeOrders.length > 0) {
      const blocked = [...new Set(activeOrders.flatMap((o) => (o.items ?? []).map((it) => it.category).filter((c) => names.has(c))))];
      return { deleted: false, found: true, blockedBy: blocked };
    }
    await this.update({ garmentGroups: groups.filter((g) => g.id !== id) }, updatedByUserId);
    return { deleted: true, found: true, blockedBy: [] };
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

  // ---------------------------------------------------- additional charges

  private static normaliseChargeName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, " ");
  }

  async addCharge(input: { name: string; chargingType: AdditionalCharge["chargingType"]; amountPaise: number; isActive?: boolean }, updatedByUserId: string): Promise<{ previous: SystemConfig; current: SystemConfig; charge: AdditionalCharge }> {
    const previous = await this.get();
    const name = input.name.trim();
    if (!name) throw new InvalidChargeError("A charge needs a name");
    if (input.amountPaise <= 0) throw new InvalidChargeError("A charge amount must be greater than zero");
    const key = SystemConfigService.normaliseChargeName(name);
    if ((previous.additionalCharges ?? []).some((c) => SystemConfigService.normaliseChargeName(c.name) === key)) {
      throw new DuplicateChargeError(name);
    }
    const now = new Date().toISOString();
    const charge: AdditionalCharge = {
      id: randomUUID(), name, chargingType: input.chargingType, amountPaise: input.amountPaise,
      isActive: input.isActive ?? true, createdAt: now, updatedAt: now,
    };
    const { current } = await this.update({ additionalCharges: [...(previous.additionalCharges ?? []), charge] }, updatedByUserId);
    return { previous, current, charge };
  }

  async updateCharge(chargeId: string, patch: Partial<Pick<AdditionalCharge, "name" | "chargingType" | "amountPaise" | "isActive">>, updatedByUserId: string): Promise<{ previous: SystemConfig; current: SystemConfig; charge: AdditionalCharge } | null> {
    const previous = await this.get();
    const list = previous.additionalCharges ?? [];
    const existing = list.find((c) => c.id === chargeId);
    if (!existing) return null;
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new InvalidChargeError("A charge needs a name");
      const key = SystemConfigService.normaliseChargeName(name);
      if (list.some((c) => c.id !== chargeId && SystemConfigService.normaliseChargeName(c.name) === key)) {
        throw new DuplicateChargeError(name);
      }
    }
    if (patch.amountPaise !== undefined && patch.amountPaise <= 0) throw new InvalidChargeError("A charge amount must be greater than zero");
    const charge: AdditionalCharge = {
      ...existing,
      name: patch.name?.trim() ?? existing.name,
      chargingType: patch.chargingType ?? existing.chargingType,
      amountPaise: patch.amountPaise ?? existing.amountPaise,
      isActive: patch.isActive ?? existing.isActive,
      updatedAt: new Date().toISOString(),
    };
    const additionalCharges = list.map((c) => (c.id === chargeId ? charge : c));
    const { current } = await this.update({ additionalCharges }, updatedByUserId);
    return { previous, current, charge };
  }
}
