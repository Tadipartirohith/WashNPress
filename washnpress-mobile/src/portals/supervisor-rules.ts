// What a supervisor's portal is made of, and what a tower has to say about itself.
//
// Both are decisions rather than drawing, so they live outside the screen that
// renders them and can be read — and tested — without a React tree around them.

export type SupervisorTab =
  | "home" | "mysociety" | "slots" | "operators" | "orders" | "pickups"
  | "services" | "delayed" | "refunds" | "plans" | "issues" | "reports" | "profile";

// Three sections have gone from this list. Search duplicated the filters on every
// list that has them and reached nothing they could not; QC Monitoring was a
// read-only copy of a screen the operations staff work in; Processing was five
// sub-tabs of the same. None of them was a decision a supervisor makes, and each
// one was a tab in the way of the ones that are.
export const SUPERVISOR_TABS: { key: SupervisorTab; label: string }[] = [
  { key: "home", label: "Dashboard" },
  { key: "mysociety", label: "My society" },
  { key: "slots", label: "Slots" },
  { key: "operators", label: "Operations" },
  { key: "pickups", label: "Pickups" },
  { key: "orders", label: "Orders" },
  // Car washes, at-home ironing and the rest. A supervisor could not see these at
  // all: a booking went into the operator's queue and the only way to find out who
  // was doing it was to ask them.
  { key: "services", label: "Services" },
  { key: "delayed", label: "Delayed" },
  // Refunds raised on orders in this supervisor's societies, to approve or turn down.
  { key: "refunds", label: "Refunds" },
  // Subscription plans. System-wide, and managed with the same two-step wizard the
  // admin uses, so a supervisor can create and edit plans without waiting on an admin.
  { key: "plans", label: "Plans" },
  { key: "issues", label: "Issues" },
  { key: "reports", label: "Reports" },
  { key: "profile", label: "Profile" },
];

// A count somebody typed into a form. Blank, zero, a decimal and a negative are all
// the same answer: not a number of floors or of flats.
export function isPositiveCount(value: string): boolean {
  const n = Number(value);
  return value.trim().length > 0 && Number.isInteger(n) && n > 0;
}

// Adding a tower. Said on the form rather than as a rejection afterwards, and said
// as one problem at a time because the fields are filled in left to right.
export function towerProblem(name: string, floors: string, flats: string): string | null {
  if (!name.trim()) return "A tower needs a name.";
  if (!isPositiveCount(floors)) return "Floors must be a positive number.";
  if (!isPositiveCount(flats)) return "Flats must be a positive number.";
  return null;
}
