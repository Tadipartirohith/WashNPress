// Money is stored in paise everywhere and shown in rupees, formatted the Indian way.
export function rupees(paise: number): string {
  return "₹" + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// Backend state/status strings are snake_case (e.g. "in_wash", "on_leave"). Every
// portal renders them the same way, so it lives once here.
export function stateLabel(state: string): string {
  return state.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
