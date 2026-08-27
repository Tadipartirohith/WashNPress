import { operatorForBlock } from "../domain/order-assignment";
import type { DataStore } from "../ports/repositories";
import type { User } from "../domain/models";

// Keeping `Tower → Operator → Order` true after the fact.
//
// An order is assigned the moment it is booked, from the tower it is collected
// from. Two things can happen afterwards that make that assignment stale, and both
// are ordinary: a supervisor changes who covers the tower, and a resident tells us
// they have moved to a different one. Neither should leave an order pointing at
// somebody who no longer goes there.
//
// Only orders that have not been collected yet are touched. Once an operator has
// been to the door, the block and the operator on the order are a record of what
// happened rather than a plan for what will, and rewriting history to match a new
// assignment would lose that.
const NOT_YET_COLLECTED = "scheduled";

async function operatorsById(store: DataStore): Promise<Map<string, User>> {
  const operators = await store.users.find((u) => u.roles.includes("operator"));
  return new Map(operators.map((u) => [u.id, u]));
}

// After the operators on a block change. An order already assigned to somebody who
// still covers the tower is left alone — a reshuffle should not move work that is
// already in the right hands.
export async function reassignBlock(store: DataStore, blockId: string): Promise<number> {
  const block = await store.blocks.get(blockId);
  if (!block) return 0;
  const operators = await operatorsById(store);
  const covering = new Set(block.operatorUserIds ?? []);
  const chosen = operatorForBlock(block, operators);
  const orders = await store.orders.find((o) => o.blockId === blockId && o.state === NOT_YET_COLLECTED);

  let moved = 0;
  for (const order of orders) {
    const current = order.assignedOperatorUserId;
    if (current && covering.has(current)) continue;
    if (current === chosen) continue;
    await store.orders.put({ ...order, assignedOperatorUserId: chosen });
    moved += 1;
  }
  return moved;
}

// After a resident says which tower they live in. Their uncollected orders move
// with them: the collection has not happened yet, so the tower on it is still a
// plan, and the operator has to be the one who goes to the new door.
export async function reassignResident(store: DataStore, residentId: string): Promise<number> {
  const resident = await store.residents.get(residentId);
  if (!resident) return 0;
  const block = resident.blockId ? await store.blocks.get(resident.blockId) : null;
  // A block belongs to one society, so a resident's block only applies to orders in
  // the society they now live in.
  const blockId = block && block.societyId === resident.societyId ? block.id : null;
  const operators = await operatorsById(store);
  const chosen = operatorForBlock(block, operators);
  const orders = await store.orders.find(
    (o) => o.residentId === residentId && o.state === NOT_YET_COLLECTED,
  );

  let moved = 0;
  for (const order of orders) {
    const nextBlockId = order.societyId === resident.societyId ? blockId : order.blockId ?? null;
    const nextOperator = order.societyId === resident.societyId ? chosen : order.assignedOperatorUserId;
    if (order.blockId === nextBlockId && order.assignedOperatorUserId === nextOperator) continue;
    await store.orders.put({ ...order, blockId: nextBlockId, assignedOperatorUserId: nextOperator });
    moved += 1;
  }
  return moved;
}

// At boot, for orders booked before any of this existed. The same lookup, applied
// once to everything still waiting to be collected that nobody is on.
export async function backfillOrderOperators(store: DataStore): Promise<number> {
  const orders = await store.orders.find(
    (o) => o.state === NOT_YET_COLLECTED && !o.assignedOperatorUserId && Boolean(o.blockId),
  );
  if (!orders.length) return 0;
  const operators = await operatorsById(store);
  const blocks = new Map((await store.blocks.all()).map((b) => [b.id, b]));

  let assigned = 0;
  for (const order of orders) {
    const chosen = operatorForBlock(blocks.get(order.blockId!), operators);
    if (!chosen) continue;
    await store.orders.put({ ...order, assignedOperatorUserId: chosen });
    assigned += 1;
  }
  return assigned;
}
