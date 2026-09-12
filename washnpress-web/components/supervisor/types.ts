// Shared across the supervisor portal's tab components so a screen can navigate
// another tab (e.g. "view all delayed orders" from the dashboard) without a
// circular import back to supervisor-portal.tsx.
export type TabId = "overview" | "society" | "slots" | "operators" | "orders" | "services" | "issues" | "plans";

// I-105: a dashboard tile says where to go *and* how the screen it opens should be
// narrowed when it gets there — "QC failed" opens Orders on its Quality checks view
// rather than on an unfiltered list the supervisor then has to narrow by hand. Read
// once by the destination as its initial state, so it stays a filter that can be
// cleared. Choosing a tab from the left nav passes nothing.
export interface SupervisorFocus {
  orders?: { view: "orders" | "pickups" | "processing" | "qc" | "delayed" };
  issues?: { status?: string; emergency?: boolean };
}
export type SupervisorNavigate = (tab: TabId, focus?: SupervisorFocus) => void;
