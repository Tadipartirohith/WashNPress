// What a supervisor's portal is made of, and what a tower has to say about itself.
//
// Both are decisions rather than drawing, so they live outside the screen that
// renders them and can be read — and tested — without a React tree around them.

export type SupervisorTab =
  | "home" | "mysociety" | "slots" | "operators" | "orders"
  | "services" | "plans" | "issues" | "profile"
  | "search"
  | "more";

// The five views of the same work, grouped the way the web portal groups them.
//
// Pickups, processing, quality checks and delayed orders were four separate
// destinations on mobile, three of them behind "More" — so a supervisor chasing a
// late order had to remember which of nine menu rows it lived under. They are one
// question asked at different points of the same pipeline, and the web portal has
// always treated them as one tab with a switcher across the top.
//
// Processing is a view again rather than only a dashboard drill-down. The drill-down
// still works and still lands on the orders for a stage; what it could not do was
// let somebody go and look at what is in the machines without first noticing a
// number on the dashboard worth tapping.
export type SupervisorOrderView = "orders" | "pickups" | "processing" | "qc" | "delayed";

export const SUPERVISOR_ORDER_VIEWS: { key: SupervisorOrderView; label: string }[] = [
  { key: "orders", label: "Orders" },
  { key: "pickups", label: "Pickups" },
  { key: "processing", label: "Processing" },
  { key: "qc", label: "Quality checks" },
  { key: "delayed", label: "Delayed" },
];

// Orders, pickups and issues are what a supervisor's day is made of, alongside
// the dashboard; everything else — running the society, staff, catalogue,
// reporting, the profile — sits one tap further in, behind "More".
// Folding pickups into Orders freed the slot it held. The society took it rather
// than leaving a gap: it is the supervisor's standing context, and the web portal
// ranks it second of eight.
export const SUPERVISOR_PRIMARY: readonly SupervisorTab[] = ["home", "orders", "mysociety", "issues"];

// Search is back, but not as the thing that was removed. The old header search
// duplicated the per-list filters and reached nothing they could not — so it went.
// What is here now is a global, cross-entity search (GET /v1/supervisor/search):
// it answers "where is this order / resident / operator / society" without you
// having to already be in the right list, which the per-list filters cannot do.
// QC Monitoring is likewise re-added — the supervisor's paged, filterable view of
// every quality check in their society, backed by GET /v1/supervisor/qc, matching
// the web portal. It lives inside Orders now rather than beside it.
export const SUPERVISOR_TABS: { key: SupervisorTab; label: string }[] = [
  { key: "home", label: "Dashboard" },
  { key: "search", label: "Search" },
  { key: "mysociety", label: "My society" },
  { key: "slots", label: "Slots" },
  { key: "operators", label: "Operations" },
  // Pickups, processing, quality checks and delayed orders are views inside this
  // one rather than destinations of their own. See SUPERVISOR_ORDER_VIEWS.
  { key: "orders", label: "Orders" },
  // Car washes, at-home ironing and the rest. A supervisor could not see these at
  // all: a booking went into the operator's queue and the only way to find out who
  // was doing it was to ask them.
  { key: "services", label: "Services" },
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
