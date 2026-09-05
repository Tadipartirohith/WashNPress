// Shared across the supervisor portal's tab components so a screen can navigate
// another tab (e.g. "view all delayed orders" from the dashboard) without a
// circular import back to supervisor-portal.tsx.
export type TabId = "overview" | "society" | "slots" | "operators" | "orders" | "issues" | "plans";
