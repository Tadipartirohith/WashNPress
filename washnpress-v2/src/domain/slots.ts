// Pure capacity rules. The atomic guarantee under concurrency is provided by the
// storage adapter (a conditional UPDATE in Postgres, a synchronous check in memory);
// these functions express the business rule the adapter enforces.
export interface Slot {
  id: string;
  capacityTotal: number;
  capacityRemaining: number;
  isActive: boolean;
}

export function reserve(slot: Slot): Slot {
  if (!slot.isActive) throw new Error("Slot is not active");
  if (slot.capacityRemaining <= 0) throw new Error("Slot is full");
  return { ...slot, capacityRemaining: slot.capacityRemaining - 1 };
}

export function release(slot: Slot): Slot {
  return {
    ...slot,
    capacityRemaining: Math.min(slot.capacityTotal, slot.capacityRemaining + 1),
  };
}
