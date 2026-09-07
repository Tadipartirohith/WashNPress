"use client";

import * as React from "react";
import { Search, ChevronLeft, ChevronRight, Download, RefreshCw, ArrowRight } from "lucide-react";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { useAsync } from "@/lib/use-async";
import { adminApi, type AuditEntry } from "@/lib/api/admin";
import { formatDateTime } from "@/lib/format";

const PAGE_SIZE = 25;

// The resources an admin thinks in, mapped from the backend's resource keys. Anything
// not listed falls back to a title-cased version of the key rather than the raw word.
const RESOURCE_LABELS: Record<string, string> = {
  society: "Societies", user: "Users", supervisor: "Supervisors", operator: "Operators",
  resident: "Residents", order: "Orders", service: "Services", booking: "Bookings",
  subscription: "Subscriptions", revenue: "Revenue", refund: "Refunds", plan: "Subscription Plans",
  slot: "Slots", issue: "Issues", config: "Configuration", block: "Societies",
  garment_service: "Garments", additional_charge: "Additional Charges", system_config: "Configuration",
};
const RESOURCE_OPTIONS = ["service", "booking", "plan", "garment_service", "additional_charge", "slot", "user", "supervisor", "operator", "resident", "society", "subscription", "refund", "order", "issue", "system_config"];
const ROLE_OPTIONS = ["admin", "supervisor", "operator", "resident"];

// "What happened" — the verb an admin filters by, and the words a backend action can
// use for it. Matched against the last segment of an action like "plan.created".
const ACTION_OPTIONS: { value: string; label: string; match: RegExp }[] = [
  { value: "created", label: "Created", match: /creat/ },
  { value: "updated", label: "Updated", match: /(updat|edit|chang)/ },
  { value: "deleted", label: "Deleted", match: /(delet|remov)/ },
  { value: "activated", label: "Activated", match: /(^|[^e])activat/ },
  { value: "deactivated", label: "Deactivated", match: /(deactivat|retir)/ },
  { value: "status", label: "Status Changed", match: /status/ },
  { value: "assigned", label: "Assigned", match: /assign/ },
  { value: "reallocated", label: "Reallocated", match: /(realloc|reassign)/ },
  { value: "cancelled", label: "Cancelled", match: /cancel/ },
  { value: "refunded", label: "Refunded", match: /refund/ },
];
function matchesAction(action: string, filter: string): boolean {
  if (!filter) return true;
  const opt = ACTION_OPTIONS.find((o) => o.value === filter);
  if (!opt) return true;
  const verb = action.includes(".") ? action.slice(action.lastIndexOf(".") + 1) : action;
  return opt.match.test(verb);
}

const titleCase = (s: string) => s.replace(/[._]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
const actionLabel = (a: string) => titleCase(a);
const resourceLabel = (r: string) => RESOURCE_LABELS[r] ?? titleCase(r);
// High-impact actions the admin most wants to notice.
const isCritical = (a: string) => /(deactivat|cancel|retire|delet|remov|suspend|reject|refund|escalat)/i.test(a);
const isUpdate = (a: string) => /(updat|edit|chang)/i.test(a);

// The changed fields between the before and after of an update, in plain language.
function changedFields(prev: unknown, next: unknown): { field: string; from: string; to: string }[] {
  if (!prev || !next || typeof prev !== "object" || typeof next !== "object") return [];
  const p = prev as Record<string, unknown>; const n = next as Record<string, unknown>;
  const out: { field: string; from: string; to: string }[] = [];
  for (const key of new Set([...Object.keys(p), ...Object.keys(n)])) {
    const a = p[key]; const b = n[key];
    const simple = (v: unknown) => v === null || v === undefined || ["string", "number", "boolean"].includes(typeof v);
    if (!simple(a) || !simple(b)) continue;
    if (String(a ?? "") !== String(b ?? "")) out.push({ field: titleCase(key), from: String(a ?? "—"), to: String(b ?? "—") });
  }
  return out;
}
function changeSummary(e: AuditEntry): string {
  const fields = changedFields(e.previousValue, e.newValue);
  if (fields.length) return fields.slice(0, 2).map((f) => f.field).join(", ") + (fields.length > 2 ? ` +${fields.length - 2} more` : "");
  if (e.newValue && !e.previousValue) return "Created";
  return "—";
}

export function AuditSection() {
  const [q, setQ] = React.useState("");
  const [resource, setResource] = React.useState("");
  const [role, setRole] = React.useState("");
  const [action, setAction] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  const [detail, setDetail] = React.useState<AuditEntry | null>(null);

  const { data, loading, error, reload } = useAsync(
    () => adminApi.audit.list({
      q: q || undefined, resource: resource || undefined, role: role || undefined,
      from: from || undefined, to: to || undefined, limit: String(PAGE_SIZE), offset: String(offset),
    }),
    [q, resource, role, from, to, offset],
  );

  // A wide, unfiltered pull purely for the summary cards, so the numbers describe the
  // whole log rather than the current page.
  const all = useAsync(() => adminApi.audit.list({ limit: "1000" }), []);
  const summary = React.useMemo(() => {
    const entries = all.data?.entries ?? [];
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    return {
      total: all.data?.page.total ?? entries.length,
      today: entries.filter((e) => new Date(e.at) >= startOfToday).length,
      updates: entries.filter((e) => isUpdate(e.action)).length,
      critical: entries.filter((e) => isCritical(e.action)).length,
    };
  }, [all.data]);

  const resetFilters = () => { setQ(""); setResource(""); setRole(""); setAction(""); setFrom(""); setTo(""); setOffset(0); };
  // "What happened" is applied to the loaded rows: the audit API filters by resource,
  // role, text and date, so this last verb filter is narrowed on the client.
  const rows = (data?.entries ?? []).filter((e) => matchesAction(e.action, action));
  const exportCsv = () => {
    const rows = data?.entries ?? [];
    const head = ["When", "Action", "Resource", "Resource ID", "Actor", "Role", "Changed"];
    const csv = [head, ...rows.map((e) => [
      formatDateTime(e.at), actionLabel(e.action), resourceLabel(e.resource), e.resourceId ?? "",
      e.actorName ?? e.actor, e.role ?? "", changeSummary(e),
    ])].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const columns: Column<AuditEntry>[] = [
    { header: "When", cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.at)}</span> },
    { header: "Action", cell: (r) => <span className="font-medium">{actionLabel(r.action)}</span> },
    { header: "Resource", cell: (r) => <span>{resourceLabel(r.resource)}</span> },
    { header: "Actor", cell: (r) => <div><p>{r.actorName ?? r.actor}</p>{r.role && <p className="text-xs capitalize text-muted-foreground">{r.role}</p>}</div> },
    { header: "What changed", cell: (r) => <span className="text-muted-foreground">{changeSummary(r)}</span> },
    { header: "", align: "right", cell: (r) => <button onClick={() => setDetail(r)} className="rounded-full glass px-2.5 py-1 text-xs hover:ring-1 hover:ring-primary/40">Details</button> },
  ];

  const card = (label: string, value: number) => (
    <div className="rounded-2xl glass p-4">
      <p className="font-display text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">Audit &amp; Activity Log</h2>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">Every important change, with before and after details.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-full glass px-3.5 py-2 text-sm hover:ring-1 hover:ring-primary/40"><Download className="size-4" /> Export</button>
          <button onClick={() => { reload(); all.reload(); }} className="inline-flex items-center gap-1.5 rounded-full glass px-3.5 py-2 text-sm hover:ring-1 hover:ring-primary/40"><RefreshCw className="size-4" /> Refresh</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {card("Total activities", summary.total)}
        {card("Today's activity", summary.today)}
        {card("Updates", summary.updates)}
        {card("Critical actions", summary.critical)}
      </div>

      <div className="space-y-3 rounded-2xl glass p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Resource</span>
            <select value={resource} onChange={(e) => { setResource(e.target.value); setOffset(0); }} className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
              <option value="">Everything</option>
              {RESOURCE_OPTIONS.map((r) => <option key={r} value={r}>{resourceLabel(r)}</option>)}
            </select></label>
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Who</span>
            <select value={role} onChange={(e) => { setRole(e.target.value); setOffset(0); }} className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
              <option value="">Anybody</option>
              {ROLE_OPTIONS.map((r) => <option key={r} value={r} className="capitalize">{titleCase(r)}</option>)}
            </select></label>
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">What happened</span>
            <select value={action} onChange={(e) => { setAction(e.target.value); setOffset(0); }} className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
              <option value="">Anything</option>
              {ACTION_OPTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select></label>
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Search</span>
            <span className="flex items-center gap-2 rounded-xl border border-border bg-background/60 px-3 py-2 text-sm">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder="Search order, user, resource or actor" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
            </span></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Date from</span>
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" /></label>
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Date to</span>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" /></label>
          <div className="flex items-end gap-2">
            <button onClick={() => reload()} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110">Apply filters</button>
            <button onClick={resetFilters} className="rounded-xl glass px-4 py-2 text-sm hover:ring-1 hover:ring-primary/40">Reset</button>
          </div>
        </div>
      </div>

      <DataTable columns={columns} rows={rows} keyField={(r) => r.id ?? `${r.actor}-${r.action}-${r.resourceId ?? ""}-${r.at}`} loading={loading} error={error}
        emptyTitle="No activity matches" emptyDescription="Try clearing a filter." />

      {data && data.page.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, data.page.total)} of {data.page.total}</span>
          <div className="flex gap-2">
            <button onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))} disabled={offset === 0}
              className="grid size-8 place-items-center rounded-lg glass disabled:opacity-40"><ChevronLeft className="size-4" /></button>
            <button onClick={() => setOffset((o) => o + PAGE_SIZE)} disabled={!data.page.hasMore}
              className="grid size-8 place-items-center rounded-lg glass disabled:opacity-40"><ChevronRight className="size-4" /></button>
          </div>
        </div>
      )}

      {/* The technically-complete detail: who, what, when, the exact resource id, and
          the field-by-field before/after that the summary row abbreviates. */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? actionLabel(detail.action) : ""} variant="drawer">
        {detail && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">Who</dt><dd>{detail.actorName ?? detail.actor}{detail.role ? ` (${titleCase(detail.role)})` : ""}</dd>
              <dt className="text-muted-foreground">Action</dt><dd>{actionLabel(detail.action)}</dd>
              <dt className="text-muted-foreground">Resource</dt><dd>{resourceLabel(detail.resource)}</dd>
              <dt className="text-muted-foreground">Resource ID</dt><dd className="break-all font-mono text-xs">{detail.resourceId ?? "—"}</dd>
              <dt className="text-muted-foreground">When</dt><dd>{formatDateTime(detail.at)}</dd>
            </dl>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Changes</p>
              {changedFields(detail.previousValue, detail.newValue).length ? (
                <div className="space-y-2.5">
                  {changedFields(detail.previousValue, detail.newValue).map((f) => (
                    <div key={f.field} className="rounded-xl border border-border p-3">
                      <p className="text-xs font-medium text-muted-foreground">{f.field}</p>
                      <div className="mt-1.5 flex items-center gap-3">
                        <span className="rounded-lg bg-foreground/5 px-2.5 py-1 text-sm text-muted-foreground line-through decoration-danger/50">{f.from}</span>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                        <span className="rounded-lg bg-success/10 px-2.5 py-1 text-sm font-medium text-success">{f.to}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-muted-foreground">{detail.newValue ? "New record created." : "No field-level change recorded."}</p>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
