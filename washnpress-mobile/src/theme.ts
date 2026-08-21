export const theme = {
  aqua: "#00A8A8", deepTeal: "#004D4D", ice: "#B2F0EE", amber: "#F5A623",
  white: "#FFFFFF", slate: "#3F4A4A", bg: "#F3F5F5",
  muted: "#7A8686", border: "#E4E9E9", danger: "#B3261E", success: "#1E7F4F",
};

// One colour per order state, so a status reads the same in every portal.
export const stateColor: Record<string, string> = {
  scheduled: theme.aqua,
  picked_up: "#2E7DD1",
  in_wash: "#2E7DD1",
  ironing: "#6B4FD1",
  qc: theme.amber,
  qc_hold: theme.danger,
  ready_for_delivery: theme.success,
  out_for_delivery: theme.success,
  delivered: theme.success,
  pickup_failed: theme.danger,
  cancelled: theme.muted,
  disputed: theme.danger,
  // Not an order state: a pickup still waiting from an earlier day.
  overdue: theme.danger,
};

export const stateLabel: Record<string, string> = {
  overdue: "Overdue",
  scheduled: "Scheduled",
  picked_up: "Picked Up",
  in_wash: "Washing",
  ironing: "Ironing",
  qc: "QC",
  qc_hold: "QC Failed",
  ready_for_delivery: "Ready for Delivery",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  pickup_failed: "Pickup Failed",
  cancelled: "Cancelled",
  disputed: "Disputed",
};

export function labelFor(state: string): string {
  return stateLabel[state] ?? state.replace(/_/g, " ");
}

export function rupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "—";
  return `₹${(paise / 100).toFixed(2).replace(/\.00$/, "")}`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString(undefined, { day: "2-digit", month: "short" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

export function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
