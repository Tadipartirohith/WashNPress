// Operator navigation — the same destinations, labels and page titles as
// Web's OperationsWorkspace + PortalShell. Mobile cannot copy the eight-item
// sidebar into a five-slot bar, so Dashboard / Pickups / Active / Issues stay
// on the bar and the rest live behind More, in Web's remaining order.

export const OPERATIONS_SHELL_TITLE = "Operations";
export const OPERATIONS_SHELL_SUBTITLE_FALLBACK = "Pickups, processing and delivery";

export const OPERATIONS_NAV = [
  { id: "dashboard", tab: "home", label: "Dashboard" },
  { id: "pickups", tab: "pickups", label: "Pickups" },
  { id: "active", tab: "active", label: "Active" },
  { id: "queue", tab: "claimable", label: "Claimable" },
  { id: "history", tab: "history", label: "History" },
  { id: "services", tab: "services", label: "Services" },
  { id: "issues", tab: "issues", label: "Issues" },
  { id: "profile", tab: "profile", label: "Profile" },
] as const;

export type OperatorNavTab = (typeof OPERATIONS_NAV)[number]["tab"] | "more";

// The pickup-to-delivery loop and live issues are what a shift actually is.
// Claimable / History / Services / Profile are the overflow, in Web order.
export const OPERATIONS_PRIMARY_TABS = ["home", "pickups", "active", "issues"] as const;
export const OPERATIONS_MORE_TABS = ["claimable", "history", "services", "profile"] as const;

export const OPERATIONS_PAGE = {
  dashboard: { title: OPERATIONS_SHELL_TITLE },
  pickups: { title: "Pickups" },
  active: { title: "Active Orders", subtitle: "Collected orders in processing, by stage." },
  claimable: { title: "Claimable", subtitle: "Unclaimed work available in your societies." },
  history: { title: "History", subtitle: "Completed and cancelled orders and service bookings." },
  services: { title: "Additional Services", subtitle: "Manage scheduled additional service bookings." },
  issues: { title: "Issues", subtitle: "Take one, answer the resident, resolve it." },
  profile: { title: "Profile", subtitle: "View your operator and assigned coverage details." },
} as const;

export function operationsCoveringSubtitle(
  societyName?: string | null,
  societyNames?: Array<string | null | undefined>,
): string {
  const single = societyName?.trim();
  if (single) return `Covering ${single}`;
  const names = (societyNames ?? []).map((name) => name?.trim()).filter(Boolean) as string[];
  if (names.length) return `Covering ${names.join(", ")}`;
  return OPERATIONS_SHELL_SUBTITLE_FALLBACK;
}

export function operationsBarValue(tab: string): OperatorNavTab {
  return (OPERATIONS_PRIMARY_TABS as readonly string[]).includes(tab)
    ? tab as OperatorNavTab
    : "more";
}

export function operationsMoreOrder(): readonly string[] {
  return OPERATIONS_MORE_TABS;
}

export function operationsMoreItems(): { key: (typeof OPERATIONS_MORE_TABS)[number]; label: string }[] {
  const overflow = new Set<string>(OPERATIONS_MORE_TABS);
  return OPERATIONS_NAV
    .filter((item) => overflow.has(item.tab))
    .map((item) => ({ key: item.tab as (typeof OPERATIONS_MORE_TABS)[number], label: item.label }));
}
