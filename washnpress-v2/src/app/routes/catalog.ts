import type { FastifyInstance } from "fastify";
import type { Container } from "../../container";
import { optionalSession } from "../guards";
import { garmentPricePaise, servicePricePaise } from "../../domain/pricing";
import type { Society } from "../../domain/models";

export function registerCatalogRoutes(app: FastifyInstance, container: Container): void {
  app.get("/v1/plans", async (_req, _reply) => ({ plans: await container.subscriptions.listPlans() }));
  app.get("/v1/addons", async () => ({ addons: (await container.store.addons.all()).filter((a) => a.isActive) }));
  // The processing services a resident can pick per garment split, with the price
  // charged per garment on top of anything a subscription covers.
  app.get("/v1/services", async () => {
    const config = await container.systemConfig.get();
    return { services: config.garmentServices.filter((s) => s.isActive) };
  });
  // The whole price list, per garment category and per service, so the resident is
  // told what each garment costs before they book rather than one flat rate that
  // matches nothing. A signed in resident also gets their own plan against it.
  app.get("/v1/pricing", async (req) => {
    const config = await container.systemConfig.get();
    const services = config.garmentServices.filter((s) => s.isActive);
    const categories = config.garmentCategories;

    // Optional: without a session this is simply the public price list.
    const session = await optionalSession(req, container);
    const usage = session?.residentId ? await container.subscriptions.usage(session.residentId) : null;
    const covered = new Set(usage?.coveredServiceIds ?? []);

    return {
      // What a garment costs on its own, for a resident paying as they go.
      garments: categories.map((category) => ({
        category,
        payAsYouGoPaise: garmentPricePaise(config.garmentPricesPaise, category, config.nonSubscriberGarmentRatePaise),
      })),
      // And what each service adds, per category, plus whether a plan covers it.
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        isBase: service.isBase,
        requiresClean: service.requiresClean,
        cleanStage: service.cleanStage,
        requiresPress: service.requiresPress,
        coveredBySubscription: covered.has(service.id),
        perGarment: categories.map((category) => ({
          category,
          payAsYouGoPaise: servicePricePaise(service, category),
        })),
      })),
      subscription: usage
        ? {
            planTier: usage.planTier,
            allowance: usage.allowance,
            used: usage.used,
            remaining: usage.remaining,
            coveredServiceIds: usage.coveredServiceIds ?? [],
            additionalRatePaise: config.additionalGarmentRatePaise,
          }
        : null,
      hasSubscription: Boolean(usage),
      nonSubscriberGarmentRatePaise: config.nonSubscriberGarmentRatePaise,
      additionalGarmentRatePaise: config.additionalGarmentRatePaise,
    };
  });

  // Onboarding needs to offer a list of societies before anybody has signed in, so
  // these stay public — but they answer with only what choosing a society requires.
  // The full record carries the whole postal address, which is more than an
  // anonymous caller needs to pick their building from a list.
  const publicSociety = (s: Society) => ({
    id: s.id, name: s.name, city: s.address?.city ?? "", status: s.status,
  });

  app.get("/v1/societies", async () => ({
    societies: (await container.store.societies.all()).filter((s) => s.status !== "inactive").map(publicSociety),
  }));

  // Nearby means nearby: societies in the same city as the one asked about, or in
  // the city named outright. Without either it is the plain active list, and says so
  // rather than pretending a filter was applied.
  app.get<{ Querystring: { city?: string; societyId?: string } }>("/v1/societies/nearby", async (req) => {
    const active = (await container.store.societies.all()).filter((s) => s.status === "active");
    let city = req.query.city?.trim() ?? null;
    if (!city && req.query.societyId) {
      city = (await container.store.societies.get(req.query.societyId))?.address?.city ?? null;
    }
    const near = city ? active.filter((s) => (s.address?.city ?? "").toLowerCase() === city!.toLowerCase()) : active;
    return { societies: near.map(publicSociety), city, filtered: Boolean(city) };
  });
}
