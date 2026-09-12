"use client";

import * as React from "react";
import { Search, Send, AlertTriangle, ShieldAlert, Clock, CheckCircle2 } from "lucide-react";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { StatCard } from "@/components/portal/stat-card";
import { ResolveIssueDialog } from "@/components/portal/resolve-issue-dialog";
import { useToast } from "@/components/portal/toast";
import { useAsync, useAction } from "@/lib/use-async";
import { adminApi, type Issue } from "@/lib/api/admin";
import { formatDateTime, stateLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_TONE = {
  open: "warning", in_progress: "primary", waiting_resident: "warning", waiting_operator: "warning",
  escalated_supervisor: "danger", escalated_admin: "danger", resolved: "success", closed: "muted",
} as const;
const PRIORITY_TONE = { emergency: "danger", high: "warning", normal: "primary", low: "muted" } as const;
// The backend priority key "normal" reads as "Medium" to the admin.
const PRIORITY_LABEL: Record<string, string> = { low: "Low", normal: "Medium", high: "High", emergency: "Emergency" };
const priorityLabel = (p: string) => PRIORITY_LABEL[p] ?? stateLabel(p);
const issueTitle = (r: Issue) => stateLabel(r.type ?? r.category ?? "issue");
const raisedBy = (r: Issue) => (r.residentName as string) ?? (r.raisedByName as string) ?? "—";

// `focus` is the filter a dashboard card asked for (I-105). It is read once, as the
// initial state, so the admin can then clear or change it like any other filter
// instead of being stuck in the view the card chose.
export function IssuesSection({ focus }: { focus?: { status?: string; priority?: string } }) {
  const [status, setStatus] = React.useState(focus?.status ?? "");
  const [priority, setPriority] = React.useState(focus?.priority ?? "");
  const [societyId, setSocietyId] = React.useState("");
  const [q, setQ] = React.useState("");
  const [openOnly, setOpenOnly] = React.useState(false);
  const query = { status: status || undefined, priority: priority || undefined, societyId: societyId || undefined, q: q || undefined, open: openOnly ? "true" : undefined };
  const { data, loading, error, reload } = useAsync(() => adminApi.issues.list(query), [status, priority, societyId, q, openOnly]);
  const analytics = useAsync(() => adminApi.issues.analytics(query), [status, priority, societyId, q, openOnly]);
  const societies = useAsync(() => adminApi.societies.list(), []);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const societyName = React.useMemo(() => new Map((societies.data?.societies ?? []).map((s) => [s.id, s.name])), [societies.data]);

  const a = (analytics.data?.analytics ?? {}) as Record<string, number>;
  // The society filter is also enforced client-side so it works regardless of backend support.
  const rows = (data?.issues ?? []).filter((r) => !societyId || r.societyId === societyId);

  const columns: Column<Issue>[] = [
    { header: "ID", cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.id.slice(0, 8)}</span> },
    { header: "Title", cell: (r) => <div><p className="font-medium">{issueTitle(r)}</p><p className="max-w-xs truncate text-xs text-muted-foreground">{r.description}</p></div> },
    { header: "Society", cell: (r) => (r.societyId ? societyName.get(r.societyId) ?? "—" : "—") },
    { header: "Raised by", cell: (r) => raisedBy(r) },
    { header: "Priority", cell: (r) => <StatusBadge status={r.priority} label={priorityLabel(r.priority)} toneMap={PRIORITY_TONE} /> },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} toneMap={STATUS_TONE} /> },
    { header: "Created on", cell: (r) => r.createdAt ? formatDateTime(r.createdAt) : "—" },
  ];

  const cards: { key: string; icon: typeof Clock; label: string; value: number; tint: "warning" | "danger" | "success"; status: string }[] = [
    { key: "pending", icon: Clock, label: "Pending", value: a.pending ?? 0, tint: "warning", status: "open" },
    { key: "escalated", icon: ShieldAlert, label: "Escalated", value: a.escalated ?? 0, tint: "danger", status: "escalated_admin" },
    { key: "emergency", icon: AlertTriangle, label: "Emergency", value: a.emergency ?? 0, tint: "danger", status: "" },
    { key: "resolved", icon: CheckCircle2, label: "Resolved", value: a.resolved ?? 0, tint: "success", status: "resolved" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <button key={c.key} onClick={() => { if (c.key === "emergency") { setPriority("emergency"); setStatus(""); } else { setStatus(status === c.status ? "" : c.status); setPriority(""); } }}
            className={cn("text-left transition-transform hover:-translate-y-0.5", (c.status && status === c.status) || (c.key === "emergency" && priority === "emergency") ? "ring-2 ring-primary/40 rounded-2xl" : "")}>
            <StatCard icon={c.icon} label={c.label} value={String(c.value)} tint={c.tint} />
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2 text-sm text-muted-foreground sm:max-w-xs">
          <Search className="size-4 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by ID, title, resident, society or order" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">All statuses</option>
          {["open", "in_progress", "waiting_resident", "waiting_operator", "escalated_supervisor", "escalated_admin", "resolved", "closed"].map((s) => <option key={s} value={s}>{stateLabel(s)}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">All priorities</option>
          {(data?.priorities ?? ["low", "normal", "high", "emergency"]).map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}
        </select>
        <select value={societyId} onChange={(e) => setSocietyId(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">All societies</option>
          {(societies.data?.societies ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} className="size-4 rounded border-border" /> Open only
        </label>
      </div>

      <DataTable columns={columns} rows={rows} keyField={(r) => r.id} loading={loading} error={error}
        onRowClick={(r) => setOpenId(r.id)} emptyTitle="No issues found" emptyDescription="Try changing your search or filters." />

      {openId && <IssueDrawer id={openId} assignees={data?.assignees ?? []} societyName={societyName} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}

type Msg = { authorName?: string; body: string; at: string };
type Event = { label: string; at: string; note?: string | null };

function IssueDrawer({ id, assignees, societyName, onClose, onChanged }: {
  id: string; assignees: { id: string; name: string; role: string | null }[]; societyName: Map<string, string>; onClose: () => void; onChanged: () => void;
}) {
  const detail = useAsync(() => adminApi.issues.get(id), [id]);
  const toast = useToast();
  const [tab, setTab] = React.useState<"details" | "conversation" | "timeline">("details");
  const [reply, setReply] = React.useState("");
  const [reallocating, setReallocating] = React.useState(false);
  const [resolving, setResolving] = React.useState(false);
  const [findings, setFindings] = React.useState("");

  const sendReply = useAction(() => adminApi.issues.reply(id, reply));
  const setStatus = useAction((status: string) => adminApi.issues.setStatus(id, status));
  const setPriority = useAction((priority: string) => adminApi.issues.setPriority(id, priority));
  const close = useAction(() => adminApi.issues.close(id));

  const refresh = () => { detail.reload(); onChanged(); };
  const issue = detail.data?.issue;
  const messages: Msg[] = ((issue as unknown as { messages?: Msg[] })?.messages) ?? ((detail.data as unknown as { thread?: Msg[] })?.thread as Msg[]) ?? [];
  // A best-effort event history: the created event, plus each message as a touch point.
  const timeline: Event[] = issue ? [
    ...(issue.createdAt ? [{ label: "Issue raised", at: issue.createdAt as string }] : []),
    ...(((issue as unknown as { history?: Event[] }).history) ?? messages.map((m) => ({ label: `${m.authorName ?? "Staff"} replied`, at: m.at, note: m.body }))),
  ].sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime()) : [];

  return (
    <Modal open onClose={onClose} variant="drawer" title={issue ? issueTitle(issue) : "Issue"} description={issue?.description}>
      {detail.loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl glass" />)}</div>
      ) : detail.error ? (
        <div className="rounded-2xl glass p-4 text-sm text-danger">Unable to load issue. <button onClick={() => detail.reload()} className="underline">Retry</button></div>
      ) : issue ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={issue.status} toneMap={STATUS_TONE} />
            <StatusBadge status={issue.priority} label={priorityLabel(issue.priority)} toneMap={PRIORITY_TONE} />
          </div>

          <div className="flex gap-1.5">
            {(["details", "conversation", "timeline"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cn("rounded-full px-3 py-1.5 text-xs font-medium capitalize", tab === t ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground hover:text-foreground")}>{t}</button>
            ))}
          </div>

          {tab === "details" && (
            <div className="space-y-4">
              <section className="rounded-2xl glass p-3">
                {[["Issue ID", id.slice(0, 8)], ["Title", issueTitle(issue)], ["Raised by", raisedBy(issue)],
                  ["Society", issue.societyId ? societyName.get(issue.societyId) ?? "—" : "—"], ["Related order", (issue.orderCode as string) ?? issue.orderId ?? "—"],
                  ["Assigned to", issue.assignedToName ?? "Unassigned"], ["Created", issue.createdAt ? formatDateTime(issue.createdAt) : "—"],
                  ["Updated", issue.updatedAt ? formatDateTime(issue.updatedAt as string) : null]].filter(([, v]) => v != null).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 py-1.5 text-sm"><span className="text-muted-foreground">{k}</span><span className="text-right font-medium">{v as string}</span></div>
                ))}
              </section>
              {(issue.resolution as string) && <section className="rounded-2xl glass p-3"><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resolution</h3><p className="text-sm">{issue.resolution as string}</p>{((issue.resolvedByName as string | null) || (issue.resolvedAt as string | null)) ? <p className="mt-1 text-xs text-muted-foreground">Resolved{(issue.resolvedByName as string | null) ? ` by ${issue.resolvedByName as string}` : ""}{(issue.resolvedAt as string | null) ? ` on ${new Date(issue.resolvedAt as string).toLocaleString("en-IN")}` : ""}</p> : null}</section>}

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Priority</h3>
                <div className="flex flex-wrap gap-1.5">
                  {["low", "normal", "high", "emergency"].map((p) => (
                    <button key={p} disabled={setPriority.busy || issue.priority === p}
                      onClick={() => setPriority.run(p).then(() => { toast.push("Priority updated"); refresh(); }).catch(() => {})}
                      className="rounded-full glass px-3 py-1.5 text-xs font-medium hover:ring-1 hover:ring-primary/40 disabled:opacity-40">{priorityLabel(p)}</button>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</h3>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setReallocating(true)} className="rounded-full glass px-4 py-2 text-xs font-medium hover:ring-1 hover:ring-primary/40">Reallocate</button>
                  {issue.status !== "in_progress" && issue.status !== "resolved" && issue.status !== "closed" && (
                    <button onClick={() => setStatus.run("in_progress").then(() => { toast.push("Marked in progress"); refresh(); }).catch(() => {})} className="rounded-full glass px-4 py-2 text-xs font-medium hover:ring-1 hover:ring-primary/40">Mark in progress</button>
                  )}
                  {issue.status !== "resolved" && issue.status !== "closed" && (
                    <button onClick={() => setResolving(true)} className="rounded-full bg-success/15 px-4 py-2 text-xs font-medium text-success ring-1 ring-success/30 hover:brightness-110">Resolve</button>
                  )}
                  {issue.status !== "closed" && issue.status !== "resolved" && (
                    <button onClick={() => close.run().then(() => { toast.push("Closed"); refresh(); }).catch(() => {})} disabled={close.busy} className="rounded-full glass px-4 py-2 text-xs font-medium text-danger hover:ring-1 hover:ring-danger/40">Close</button>
                  )}
                </div>
              </section>
            </div>
          )}

          {tab === "conversation" && (
            <section className="space-y-2">
              <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl bg-foreground/5 p-3">
                {messages.length === 0 ? <p className="text-sm text-muted-foreground">No messages yet.</p> : messages.map((m, i) => (
                  <div key={i} className="rounded-lg bg-background/60 px-3 py-2 text-xs">
                    <p className="font-medium">{m.authorName ?? "Staff"}</p>
                    <p className="text-muted-foreground">{m.body}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{formatDateTime(m.at)}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply" className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                <button onClick={() => sendReply.run().then(() => { setReply(""); refresh(); }).catch(() => {})} disabled={sendReply.busy || !reply.trim()}
                  className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50"><Send className="size-4" /></button>
              </div>
              {sendReply.error && <p className="text-xs text-danger">{sendReply.error}</p>}
            </section>
          )}

          {tab === "timeline" && (
            <section className="space-y-3">
              {timeline.length === 0 ? <p className="text-sm text-muted-foreground">No events recorded.</p> : (
                <ol className="space-y-3 border-l border-border pl-4">
                  {timeline.map((ev, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[21px] top-1 size-2.5 rounded-full bg-primary" />
                      <p className="text-sm font-medium">{ev.label}</p>
                      {ev.note && <p className="text-xs text-muted-foreground">{ev.note}</p>}
                      <p className="text-[11px] text-muted-foreground">{formatDateTime(ev.at)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          {reallocating && <ReallocateDialog id={id} assignees={assignees} current={issue.assignedToUserId ?? ""} onClose={() => setReallocating(false)} onDone={() => { setReallocating(false); toast.push("Issue reallocated successfully"); refresh(); }} />}
          {resolving && (
            <ResolveIssueDialog
              // Findings are appended to the note rather than stored apart: the
              // ticket has one resolution field, and this is what used to be sent.
              onResolve={(note) => adminApi.issues.setStatus(id, "resolved", [note, findings.trim() ? `Findings: ${findings.trim()}` : ""].filter(Boolean).join("\n"))}
              onResolved={() => { setResolving(false); setFindings(""); toast.push("Issue resolved successfully"); refresh(); }}
              onClose={() => { setResolving(false); setFindings(""); }}
            >
              <FormField as="textarea" label="Investigation findings (optional)" value={findings} onChange={(e) => setFindings(e.target.value)} />
            </ResolveIssueDialog>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function ReallocateDialog({ id, assignees, current, onClose, onDone }: {
  id: string; assignees: { id: string; name: string; role: string | null }[]; current: string; onClose: () => void; onDone: () => void;
}) {
  const [to, setTo] = React.useState(current);
  const [reason, setReason] = React.useState("");
  const run = useAction(async () => {
    await adminApi.issues.assign(id, to || null);
    if (reason.trim()) await adminApi.issues.reply(id, `Reallocated: ${reason.trim()}`);
  });
  const currentName = assignees.find((a) => a.id === current)?.name ?? "Unassigned";

  return (
    <Modal open onClose={onClose} title="Reallocate issue">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Currently assigned to <span className="font-medium text-foreground">{currentName}</span>.</p>
        <FormField as="select" label="Reallocate to" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Unassigned</option>
          {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}{a.role ? ` (${a.role})` : ""}</option>)}
        </FormField>
        <FormField as="textarea" label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being reallocated?" />
        {run.error && <p className="text-sm text-danger">{run.error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl glass py-2.5 text-sm font-medium">Cancel</button>
          <button onClick={() => run.run().then(onDone).catch(() => {})} disabled={run.busy || to === current}
            className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50">{run.busy ? "Reallocating…" : "Reallocate"}</button>
        </div>
      </div>
    </Modal>
  );
}
