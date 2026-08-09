import type { DataStore } from "../ports/repositories";

// Operator earnings: a base draw plus a share of revenue above a threshold. The exact
// formula is a business decision and lives in unit configuration, not in code.
export class EarningsService {
  constructor(private readonly store: DataStore) {}

  async forUnit(unitId: string): Promise<{ baseDrawPaise: number; ordersProcessed: number; sharePaise: number; projectedPayoutPaise: number } | null> {
    const unit = await this.store.units.get(unitId);
    if (!unit) return null;
    const society = unit.societyId;
    const orders = await this.store.orders.find((o) => o.societyId === society && o.state === "delivered");
    // A deliberately simple share model for the reference build: the configured
    // percentage of a nominal per-order revenue proxy.
    const perOrderProxyPaise = 20000;
    const sharePaise = Math.round(orders.length * perOrderProxyPaise * (unit.revenueSharePercent / 100));
    return {
      baseDrawPaise: unit.baseDrawPaise, ordersProcessed: orders.length, sharePaise,
      projectedPayoutPaise: unit.baseDrawPaise + sharePaise,
    };
  }
}
