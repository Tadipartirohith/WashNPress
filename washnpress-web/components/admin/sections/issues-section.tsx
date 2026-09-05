"use client";

import * as React from "react";
import { Search, Send } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { StatusBadge } from "@/components/portal/status-badge";
import { StatCard } from "@/components/portal/stat-card";
import { useToast } from "@/components/portal/toast";
import { useAsync, useAction } from "@/lib/use-async";
import { adminApi, type Issue } from "@/lib/api/admin";
import { formatDateTime, stateLabel } from "@/lib/format";
import { AlertTriangle, ShieldAlert, Clock, CheckCircle2 } from "lucide-react";

const STATUS_TONE = {
  open: "warning", in_progress: "primary", waiting_resident: "warning", waiting_operator: "warning",
  escalated_supervisor: "danger", escalated_admin: "danger", resolved: "success", closed: "muted",
} as const;

export function IssuesSection() {
  const [status, setStatus] = React.useState("");
  const [priority, setPriority] = React.useState("");
  const [q, setQ] = React.useState("");
  const [openOnly, setOpenOnly] = React.useState(false);
  const query = { status: status || undefined, priority: priority || undefined, q: q || undefined, open: openOnly ? "true" : undefined };
  const { data, loading, error, reload } = useAsync(() => adminApi.issues.list(query), [status, priority, q, openOnly]);
  const analytics = useAsync(() => adminApi.issues.analytics(query), [status, priority, q, openOnly]);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const columns: Column<Issue>[] = [
    { header: "Issue", cell: (r) => <div><p className="font-medium">{stateLabel(r.type ?? r.category ?? "issue")}</p><p className="max-w-xs truncate text-xs text-muted-foreground">{r.description}</p></div> },
    { header: "Priority", cell: (r) => <StatusBadge status={r.priority} toneMap={{ emergency: "danger", high: "warning", normal: "primary", low: "muted" }} /> },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} toneMap={STATUS_TONE} /> },
    { header: "Assigned to", cell: (r) => r.assignedToName ?? <span className="text-muted-foreground">Unassigned</span> },
    { header: "Raised", cell: (r) => r.createdAt ? formatDateTime(r.createdAt) : "—" },
  ];

  return (
    <div className="space-y-5">
      {analytics.data && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Clock} label="Pending" value={String((analytics.data.analytics as Record<string, number>).pending ?? 0)} tint="warning" />
          <StatCard icon={ShieldAlert} label="Escalated" value={String((analytics.data.analytics as Record<string, number>).escalated ?? 0)} tint="danger" />
          <StatCard icon={AlertTriangle} label="Emergency" value={String((analytics.data.analytics as Record<string, number>).emergency ?? 0)} tint="danger" />
          <StatCard icon={CheckCircle2} label="Resolved" value={String((analytics.data.analytics as Record<string, number>).resolved ?? 0)} tint="success" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2 text-sm text-muted-foreground sm:max-w-xs">
          <Search className="size-4 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search issues" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">All statuses</option>
          {["open", "in_progress", "waiting_resident", "waiting_operator", "escalated_supervisor", "escalated_admin", "resolved", "closed"].map((s) => <option key={s} value={s}>{stateLabel(s)}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">All priorities</option>
          {(data?.priorities ?? ["low", "normal", "high", "emergency"]).map((p) => <option key={p} value={p}>{stateLabel(p)}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} className="size-4 rounded border-border" /> Open only
        </label>
      </div>

      <DataTable columns={columns} rows={data?.issues ?? []} keyField={(r) => r.id} loading={loading} error={error}
        onRowClick={(r) => setOpenId(r.id)} emptyTitle="No issues match" emptyDescription="Try clearing a filter." />

      {openId && <IssueDetailModal id={openId} assignees={data?.assignees ?? []} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}

function IssueDetailModal({ id, assignees, onClose, onChanged }: { id: string; assignees: { id: string; name: string; role: string | null }[]; onClose: () => void; onChanged: () => void }) {
  const detail = useAsync(() => adminApi.issues.get(id), [id]);
  const toast = useToast();
  const [reply, setReply] = React.useState("");
  const [assignee, setAssignee] = React.useState("");

  React.useEffect(() => { setAssignee(detail.data?.issue.assignedToUserId ?? ""); }, [detail.data]);

  const sendReply = useAction(() => adminApi.issues.reply(id, reply));
  const setStatus = useAction((status: string) => adminApi.issues.setStatus(id, status));
  const setPriority = useAction((priority: string) => adminApi.issues.setPriority(id, priority));
  const assign = useAction(() => adminApi.issues.assign(id, assignee || null));
  const close = useAction(() => adminApi.issues.close(id));
  const reopen = useAction(() => { const reason = window.prompt("Why is this being reopened?"); if (!reason) return Promise.reject(new Error("cancelled")); return adminApi.issues.reopen(id, reason); });

  const refresh = () => { detail.reload(); onChanged(); };

  return (
    <Modal open onClose={onClose} variant="drawer" title={stateLabel(detail.data?.issue.type ?? detail.data?.issue.category ?? "Issue")} description={detail.data?.issue.description}>
      <Panel loading={detail.loading} error={detail.error} onRetry={detail.reload}>
        {detail.data && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.data.issue.status} toneMap={STATUS_TONE} />
              <StatusBadge status={detail.data.issue.priority} toneMap={{ emergency: "danger", high: "warning", normal: "primary", low: "muted" }} />
            </div>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Priority</h3>
              <div className="flex flex-wrap gap-1.5">
                {["low", "normal", "high", "emergency"].map((p) => (
                  <button key={p} disabled={setPriority.busy || detail.data!.issue.priority === p}
                    onClick={() => setPriority.run(p).then(() => { toast.push("Priority updated"); refresh(); }).catch(() => {})}
                    className="rounded-full glass px-3 py-1.5 text-xs font-medium capitalize hover:ring-1 hover:ring-primary/40 disabled:opacity-40">
                    {p}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assignee</h3>
              <div className="flex gap-2">
                <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
                  <option value="">Unassigned</option>
                  {assignees.map((a) => <option key={a.id} value={a.id}>{a.name} {a.role ? `(${a.role})` : ""}</option>)}
                </select>
                <button onClick={() => assign.run().then(() => { toast.push("Assigned"); refresh(); }).catch(() => {})} disabled={assign.busy}
                  className="shrink-0 rounded-xl glass px-4 py-2 text-sm font-medium hover:ring-1 hover:ring-primary/40 disabled:opacity-50">Save</button>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</h3>
              <div className="flex flex-wrap gap-1.5">
                {["in_progress", "waiting_resident", "waiting_operator", "escalated_supervisor", "escalated_admin", "resolved"].map((s) => (
                  <button key={s} disabled={setStatus.busy || detail.data!.issue.status === s}
                    onClick={() => setStatus.run(s).then(() => { toast.push("Status updated"); refresh(); }).catch(() => {})}
                    className="rounded-full glass px-3 py-1.5 text-xs font-medium hover:ring-1 hover:ring-primary/40 disabled:opacity-40">
                    {stateLabel(s)}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                {detail.data.issue.status !== "closed" ? (
                  <button onClick={() => close.run().then(() => { toast.push("Closed"); refresh(); }).catch(() => {})} disabled={close.busy}
                    className="rounded-full bg-danger/15 px-3 py-1.5 text-xs font-medium text-danger ring-1 ring-danger/30 hover:brightness-110">Close</button>
                ) : (
                  <button onClick={() => reopen.run().then(() => { toast.push("Reopened"); refresh(); }).catch(() => {})} disabled={reopen.busy}
                    className="rounded-full bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary ring-1 ring-primary/30 hover:brightness-110">Reopen</button>
                )}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversation</h3>
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl bg-foreground/5 p-3">
                {((detail.data.issue as unknown as { messages?: Array<{ authorName?: string; body: string; at: string }> }).messages ?? []).map((m, i) => (
                  <div key={i} className="rounded-lg bg-background/60 px-3 py-2 text-xs">
                    <p className="font-medium">{m.authorName ?? "Staff"}</p>
                    <p className="text-muted-foreground">{m.body}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{formatDateTime(m.at)}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply"
                  className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                <button onClick={() => sendReply.run().then(() => { setReply(""); refresh(); }).catch(() => {})} disabled={sendReply.busy || !reply.trim()}
                  className="shrink-0 grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
                  <Send className="size-4" />
                </button>
              </div>
              {sendReply.error && <p className="text-xs text-danger">{sendReply.error}</p>}
            </section>
          </div>
        )}
      </Panel>
    </Modal>
  );
}
