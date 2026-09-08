// Money is stored in paise everywhere and shown in rupees, formatted the Indian way.
export function rupees(paise: number): string {
  return "₹" + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// Backend state/status strings are snake_case (e.g. "in_wash", "on_leave"). Every
// portal renders them the same way, so it lives once here.
export function stateLabel(state: string): string {
  return state.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Both formatters guard against missing or unparseable input: a null, undefined,
// empty or malformed value returns the fallback ("—" by default) rather than the
// literal "Invalid Date" that new Date(bad).toLocale…() would otherwise produce
// (I-79). Callers that want their own wording — e.g. "Not scheduled" — pass it in.
export function formatDate(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
