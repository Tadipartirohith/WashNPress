import { ForbiddenScopeError, allowsArea, allowsSociety, scopeFor, type Scope } from "../domain/access";
import type { Order, Session, Society, User } from "../domain/models";
import type { DataStore } from "../ports/repositories";

export { ForbiddenScopeError };

// Resolves the concrete set of societies and orders a session may act on. The
// route handlers call this instead of filtering by hand, so an area boundary is
// enforced identically on every endpoint including direct lookups by id.
export class AccessService {
  constructor(private readonly store: DataStore) {}

  scope(session: Session): Scope { return scopeFor(session); }

  async visibleSocieties(session: Session): Promise<Society[]> {
    const scope = this.scope(session);
    const societies = await this.store.societies.all();
    return societies.filter((s) => allowsSociety(scope, s.id, s.areaId));
  }

  async visibleSocietyIds(session: Session): Promise<Set<string>> {
    return new Set((await this.visibleSocieties(session)).map((s) => s.id));
  }

  async canSeeSociety(session: Session, societyId: string): Promise<boolean> {
    const society = await this.store.societies.get(societyId);
    if (!society) return false;
    return allowsSociety(this.scope(session), society.id, society.areaId);
  }

  async requireSociety(session: Session, societyId: string): Promise<Society> {
    const society = await this.store.societies.get(societyId);
    if (!society) throw new ForbiddenScopeError("Society not found in your scope");
    if (!allowsSociety(this.scope(session), society.id, society.areaId)) {
      throw new ForbiddenScopeError("Society belongs to another area");
    }
    return society;
  }

  async requireArea(session: Session, areaId: string): Promise<void> {
    if (!allowsArea(this.scope(session), areaId)) throw new ForbiddenScopeError("Area is outside your scope");
  }

  // Orders are scoped by their society, and additionally by resident for residents.
  async visibleOrders(session: Session): Promise<Order[]> {
    const scope = this.scope(session);
    const orders = await this.store.orders.all();
    if (scope.residentId) return orders.filter((o) => o.residentId === scope.residentId);
    const allowed = await this.visibleSocietyIds(session);
    return orders.filter((o) => allowed.has(o.societyId));
  }

  async requireOrder(session: Session, orderId: string): Promise<Order> {
    const order = await this.store.orders.get(orderId);
    // A not-found and an out-of-scope order return the same failure on purpose, so
    // guessing an order id cannot confirm that it exists in another area.
    if (!order) throw new ForbiddenScopeError("Order not found in your scope");
    const scope = this.scope(session);
    if (scope.residentId) {
      if (order.residentId !== scope.residentId) throw new ForbiddenScopeError("Order not found in your scope");
      return order;
    }
    const society = await this.store.societies.get(order.societyId);
    if (!allowsSociety(scope, order.societyId, society?.areaId ?? order.areaId)) {
      throw new ForbiddenScopeError("Order not found in your scope");
    }
    return order;
  }

  async visibleUsers(session: Session): Promise<User[]> {
    const scope = this.scope(session);
    const users = await this.store.users.all();
    if (scope.areaIds === null) return users;
    const societyIds = await this.visibleSocietyIds(session);
    return users.filter((u) => {
      if (u.areaId && allowsArea(scope, u.areaId)) return true;
      return u.societyIds.some((id) => societyIds.has(id));
    });
  }

  async residentsInScope(session: Session) {
    const societyIds = await this.visibleSocietyIds(session);
    return this.store.residents.find((r) => societyIds.has(r.societyId));
  }
}
