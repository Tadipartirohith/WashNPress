// Money is stored in paise everywhere and shown in rupees, formatted the Indian way.
//
// The one formatter for the whole web app. The resident app carried a second copy
// with minimumFractionDigits: 2, so the same ₹499 plan read "₹499" on the admin
// console and "₹499.00" in the app — the sort of difference that makes a person
// wonder which figure is the real one.
//
// Paise are shown only when there are paise. Prices and plan amounts are whole
// rupees and read better without a trailing ".00"; a prorated plan change or a
// cancellation fee is not round, and rounding that to the nearest rupee would state
// a charge other than the one being taken.
export function rupees(paise: number): string {
  const rupeeValue = paise / 100;
  const hasPaise = Math.round(paise) % 100 !== 0;
  return "₹" + rupeeValue.toLocaleString("en-IN", {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: hasPaise ? 2 : 0,
  });
}

// The operation's own calendar day (Asia/Kolkata), as YYYY-MM-DD.
//
// `new Date().toISOString().slice(0, 10)` is the UTC day, and India is 5.5 hours
// ahead of it: from 05:30 IST onwards the UTC date is still yesterday. Used as the
// minimum bookable date, that offered an evening resident a pickup on a day that had
// already ended, and the backend — which works in the service day — refused it. The
// backend's serviceDay() computes the same thing the same way.
export function serviceDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(at);
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
