import type { GarmentItem } from "./models";

// Backend Rule 1 to Rule 4 from the specification.
//
// The operator only ever enters the actual accepted garment quantity. The split
// between what the subscription covers and what is billed as additional, and the
// resulting charge, are computed here and nowhere else. Neither the operator nor
// the resident can supply these values.
export interface GarmentSplit {
  acceptedCount: number;
  subscriptionCoveredCount: number;
  additionalCount: number;
  additionalRatePaise: number;
  additionalChargePaise: number;
}

export function totalQuantity(items: GarmentItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

export function splitGarments(input: {
  acceptedCount: number;
  remainingAllowance: number;
  additionalRatePaise: number;
}): GarmentSplit {
  const accepted = Math.max(0, Math.trunc(input.acceptedCount));
  const remaining = Math.max(0, Math.trunc(input.remainingAllowance));
  const covered = Math.min(accepted, remaining);
  const additional = accepted - covered;
  const rate = Math.max(0, Math.trunc(input.additionalRatePaise));
  return {
    acceptedCount: accepted,
    subscriptionCoveredCount: covered,
    additionalCount: additional,
    additionalRatePaise: rate,
    additionalChargePaise: additional * rate,
  };
}

export function remainingAllowance(garmentCap: number, garmentsUsed: number): number {
  return Math.max(0, garmentCap - garmentsUsed);
}

// A subscription is not required to book. Without one the resident has no covered
// allowance at all, so every garment is billed as additional.
export function splitWithoutSubscription(acceptedCount: number, additionalRatePaise: number): GarmentSplit {
  return splitGarments({ acceptedCount, remainingAllowance: 0, additionalRatePaise });
}
