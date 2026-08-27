import { ForbiddenScopeError, allowsBlock, allowsSociety, scopeFor, type Scope } from "../domain/access";
import type { Order, Session, Society, User } from "../domain/models";
import type { DataStore } from "../ports/repositories";

export { ForbiddenScopeError };

// Resolves the concrete set of societies and orders a session may act on. The
// route handlers call this instead of filtering by hand, so a society boundary is
// enforced identically on every endpoint including direct lookups by id.
export class AccessService {
  constructor(private readonly store: DataStore) {}

  scope(session: Session): Scope { return scopeFor(session); }

  async visibleSocieties(session: Session): Promise<Society[]> {
    const scope = this.scope(session);
    const societies = await this.store.societies.all();
    return societies.filter((s) => allowsSociety(scope, s.id));
  }

  async visibleSocietyIds(session: Session): Promise<Set<string>> {
    return new Set((await this.visibleSocieties(session)).map((s) => s.id));
  }

  async canSeeSociety(session: Session, societyId: string): Promise<boolean> {
    const society = await this.store.societies.get(societyId);
    if (!society) return false;
    return allowsSociety(this.scope(session), society.id);
  }

  async requireSociety(session: Session, societyId: string): Promise<Society> {
    const society = await this.store.societies.get(societyId);
    if (!society) throw new ForbiddenScopeError("Society not found in your scope");
    if (!allowsSociety(this.scope(session), society.id)) {
      throw new ForbiddenScopeError("That society is run by somebody else");
    }
    return society;
  }

  // Orders are scoped by their society and then by their block, and additionally by
  // resident for residents. The block narrowing bites for an operator, whose blocks
  // are their assignment; a supervisor's blockIds are null, meaning the whole of the
  // society they run.
  async visibleOrders(session: Session): Promise<Order[]> {
    const scope = this.scope(session);
    const orders = await this.store.orders.all();
    if (scope.residentId) return orders.filter((o) => o.residentId === scope.residentId);
    const allowed = await this.visibleSocietyIds(session);
    return orders.filter((o) => allowed.has(o.societyId) && allowsBlock(scope, o.blockId));
  }

  async requireOrder(session: Session, orderId: string): Promise<Order> {
    const order = await this.store.orders.get(orderId);
    // A not-found and an out-of-scope order return the same failure on purpose, so
    // guessing an order id cannot confirm that it exists in another society.
    if (!order) throw new ForbiddenScopeError("Order not found in your scope");
    const scope = this.scope(session);
    if (scope.residentId) {
      if (order.residentId !== scope.residentId) throw new ForbiddenScopeError("Order not found in your scope");
      return order;
    }
    if (!allowsSociety(scope, order.societyId)) {
      throw new ForbiddenScopeError("Order not found in your scope");
    }
    // An operator assigned to two towers of three does not reach the third, and is
    // told the same thing they would be told about an order that does not exist.
    if (!allowsBlock(scope, order.blockId)) {
      throw new ForbiddenScopeError("Order not found in your scope");
    }
    return order;
  }

  async visibleUsers(session: Session): Promise<User[]> {
    const scope = this.scope(session);
    const users = await this.store.users.all();
    if (scope.societyIds === null) return users;
    const societyIds = await this.visibleSocietyIds(session);
    return users.filter((u) => u.societyIds.some((id) => societyIds.has(id)));
  }

  async residentsInScope(session: Session) {
    const scope = this.scope(session);
    const societyIds = await this.visibleSocietyIds(session);
    return this.store.residents.find(
      (r) => societyIds.has(r.societyId) && allowsBlock(scope, r.blockId),
    );
  }
}
