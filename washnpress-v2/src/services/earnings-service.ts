import type { DataStore } from "../ports/repositories";
import { withinServiceDays } from "./scheduling-service";

// Operator earnings: a base draw plus a share of the revenue their unit actually
// brought in. The share percentage is a business decision that lives in unit
// configuration; the revenue it applies to is read from the orders, not invented.
export class EarningsService {
  constructor(private readonly store: DataStore) {}

  async forUnit(unitId: string, range: { from?: string; to?: string } = {}) {
    const unit = await this.store.units.get(unitId);
    if (!unit) return null;
    const delivered = (await this.store.orders.find((o) => o.societyId === unit.societyId && o.state === "delivered"))
      .filter((o) => withinServiceDays(o.deliveredAt ?? o.createdAt, range.from, range.to));

    // Only money that was actually collected. A charge still pending is not revenue
    // and must not be paid a share on. This used to be a flat 20,000 paise assumed
    // for every delivered order, which bore no relation to what the order was worth.
    const revenuePaise = delivered
      .filter((o) => o.additionalChargeStatus === "paid")
      .reduce((sum, o) => sum + (o.additionalChargePaise ?? 0), 0);
    const pendingRevenuePaise = delivered
      .filter((o) => o.additionalChargeStatus === "pending" || o.additionalChargeStatus === "failed")
      .reduce((sum, o) => sum + (o.additionalChargePaise ?? 0), 0);

    const sharePaise = Math.round(revenuePaise * (unit.revenueSharePercent / 100));
    return {
      baseDrawPaise: unit.baseDrawPaise,
      ordersProcessed: delivered.length,
      revenuePaise,
      // Shown so the operator can see what is not yet earning them anything.
      pendingRevenuePaise,
      revenueSharePercent: unit.revenueSharePercent,
      sharePaise,
      projectedPayoutPaise: unit.baseDrawPaise + sharePaise,
      from: range.from ?? null,
      to: range.to ?? null,
    };
  }
}
