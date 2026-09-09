// What a supervisor's portal is made of, and what a tower has to say about itself.
//
// Both are decisions rather than drawing, so they live outside the screen that
// renders them and can be read — and tested — without a React tree around them.

export type SupervisorTab =
  | "home" | "mysociety" | "slots" | "operators" | "orders" | "pickups"
  | "services" | "delayed" | "plans" | "issues" | "profile"
  | "search" | "qc"
  | "more";

// Orders, pickups and issues are what a supervisor's day is made of, alongside
// the dashboard; everything else — running the society, staff, catalogue,
// reporting, the profile — sits one tap further in, behind "More".
export const SUPERVISOR_PRIMARY: readonly SupervisorTab[] = ["home", "orders", "pickups", "issues"];

// Search is back, but not as the thing that was removed. The old header search
// duplicated the per-list filters and reached nothing they could not — so it went.
// What is here now is a global, cross-entity search (GET /v1/supervisor/search):
// it answers "where is this order / resident / operator / society" without you
// having to already be in the right list, which the per-list filters cannot do.
// QC Monitoring is likewise re-added — the supervisor's paged, filterable view of
// every quality check in their society, backed by GET /v1/supervisor/qc, matching
// the web portal. Processing is reached by tapping a dashboard pipeline stage,
// which opens the Orders list already filtered to that stage rather than being a
// tab of its own.
export const SUPERVISOR_TABS: { key: SupervisorTab; label: string }[] = [
  { key: "home", label: "Dashboard" },
  { key: "search", label: "Search" },
  { key: "mysociety", label: "My society" },
  { key: "slots", label: "Slots" },
  { key: "operators", label: "Operations" },
  { key: "pickups", label: "Pickups" },
  { key: "orders", label: "Orders" },
  { key: "qc", label: "Quality checks" },
  // Car washes, at-home ironing and the rest. A supervisor could not see these at
  // all: a booking went into the operator's queue and the only way to find out who
  // was doing it was to ask them.
  { key: "services", label: "Services" },
  { key: "delayed", label: "Delayed" },
  // Subscription plans. System-wide, and managed with the same two-step wizard the
  // admin uses, so a supervisor can create and edit plans without waiting on an admin.
  { key: "plans", label: "Plans" },
  { key: "issues", label: "Issues" },
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
