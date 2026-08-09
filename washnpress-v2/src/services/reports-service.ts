import { Account } from "../domain/accounts";
import type { DataStore } from "../ports/repositories";

// Read-only analytics computed from the store. In production these read from a
// replica so reporting never competes with transactional traffic.
export class ReportsService {
  constructor(private readonly store: DataStore) {}

  async subscriptions() {
    const subs = await this.store.subscriptions.all();
    return {
      total: subs.length,
      active: subs.filter((s) => s.status === "active").length,
      paused: subs.filter((s) => s.status === "paused").length,
      cancelled: subs.filter((s) => s.status === "cancelled").length,
    };
  }

  async revenue() {
    const txns = await this.store.ledger.all();
    const sum = (account: string) => txns.flatMap((t) => t.entries).filter((e) => e.account === account && e.direction === "credit").reduce((a, e) => a + e.amount, 0);
    return { subscriptionRevenuePaise: sum(Account.SubscriptionRevenue), addonRevenuePaise: sum(Account.AddonRevenue) };
  }

  async operations() {
    const orders = await this.store.orders.all();
    const byState: Record<string, number> = {};
    for (const o of orders) byState[o.state] = (byState[o.state] ?? 0) + 1;
    return { totalOrders: orders.length, byState };
  }

  async garmentRisk() {
    const tickets = await this.store.tickets.find((t) => t.category === "delivery_discrepancy" || t.category === "qc_fail" || t.category === "dispute");
    const orders = await this.store.orders.all();
    return { incidents: tickets.length, ordersProcessed: orders.length };
  }

  async sustainability() {
    const logs = await this.store.waterLogs.all();
    return {
      litersUsed: logs.reduce((a, l) => a + l.litersUsed, 0),
      litersSaved: logs.reduce((a, l) => a + l.litersSaved, 0),
    };
  }
}
