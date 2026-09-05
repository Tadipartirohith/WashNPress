"use client";

import { useState } from "react";
import { AlertTriangle, ArrowUpCircle, Send } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { useAsync, useAction } from "@/lib/use-async";
import { useToast } from "@/components/portal/toast";
import { formatDateTime, stateLabel } from "@/lib/format";
import { supervisorApi, type IssueSummary } from "@/lib/api/supervisor";

// Everything the PATCH /status route accepts as a target. A ticket's actual status
// can also be "open" — its state at creation, before anyone has acted on it — which
// is not itself a legal target (see issueStatusSchema in supervisor.ts), so it is
// added to the dropdown only when that is the current value, and left unselectable.
const STATUS_OPTIONS = ["in_progress", "waiting_resident", "waiting_operator", "escalated_supervisor", "escalated_admin", "resolved", "closed"];

// Full lifecycle: read, reply, reprioritise, reassign, change status and, when it's
// beyond what this supervisor can resolve, escalate to the admin — the top of the
// chain, so escalating from here is refused rather than silently accepted once
// there's nowhere higher to send it (see supervisor.ts's escalate route).
export function IssuesTab() {
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [emergencyOnly, setEmergencyOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useAsync(() => supervisorApi.issues({
    status: status === "all" ? undefined : status,
    priority: priority === "all" ? undefined : priority,
    emergency: emergencyOnly || undefined,
  }), [status, priority, emergencyOnly]);

  const columns: Column<IssueSummary>[] = [
    { header: "Issue", cell: (i) => <div><p className="font-medium">{stateLabel(i.category)}</p><p className="text-xs text-muted-foreground">{formatDateTime(i.createdAt)}</p></div> },
    { header: "Priority", cell: (i) => <StatusBadge status={i.priority} toneMap={{ emergency: "danger", high: "warning", normal: "primary", low: "muted" }} /> },
    { header: "Status", cell: (i) => <StatusBadge status={i.status} /> },
    { header: "Assigned to", cell: (i) => i.assignedToName ?? <span className="text-muted-foreground">Unassigned</span> },
    { header: "Responsible", cell: (i) => stateLabel(i.responsibleRole ?? "unassigned") },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <FormField as="select" label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{stateLabel(s)}</option>)}
        </FormField>
        <FormField as="select" label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="w-40">
          <option value="all">All priorities</option>
          {(list.data?.priorities ?? ["low", "normal", "high", "emergency"]).map((p) => <option key={p} value={p}>{stateLabel(p)}</option>)}
        </FormField>
        <label className="flex cursor-pointer items-center gap-2 self-end pb-2.5 text-sm">
          <input type="checkbox" checked={emergencyOnly} onChange={(e) => setEmergencyOnly(e.target.checked)} className="size-4 accent-danger" />
          Emergency only
        </label>
      </div>
      <Panel loading={list.loading} error={list.error} onRetry={list.reload}>
        <DataTable
          columns={columns}
          rows={list.data?.issues ?? []}
          keyField={(i) => i.id}
          onRowClick={(i) => setOpenId(i.id)}
          emptyTitle="No issues match"
          emptyDescription="Your society has no tickets in this filter right now."
        />
      </Panel>
      {openId && (
        <IssueDrawer
          issueId={openId}
          assignees={list.data?.assignees ?? []}
          priorities={list.data?.priorities ?? ["low", "normal", "high", "emergency"]}
          onClose={() => setOpenId(null)}
          onChanged={list.reload}
        />
      )}
    </div>
  );
}

function IssueDrawer({ issueId, assignees, priorities, onClose, onChanged }: {
  issueId: string;
  assignees: { id: string; name: string | null; role: string | null }[];
  priorities: readonly string[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const detail = useAsync(() => supervisorApi.issueDetail(issueId), [issueId]);
  const toast = useToast();
  const [reply, setReply] = useState("");
  const [escalateOpen, setEscalateOpen] = useState(false);

  const sendReply = useAction((body: string) => supervisorApi.replyIssue(issueId, body));
  const setStatus = useAction((s: string) => supervisorApi.setIssueStatus(issueId, s));
  const setPriority = useAction((p: string) => supervisorApi.setIssuePriority(issueId, p as never));
  const assign = useAction((userId: string) => supervisorApi.assignIssue(issueId, userId));

  const messages = detail.data?.issue.messages ?? [];
  const closed = detail.data?.issue.status === "closed";
  const canEscalateFurther = detail.data?.issue.responsibleRole !== "admin";

  const submitReply = async () => {
    if (!reply.trim()) return;
    try { await sendReply.run(reply.trim()); setReply(""); detail.reload(); }
    catch (e) { toast.push(e instanceof Error ? e.message : "Could not send reply", "danger"); }
  };

  const changeStatus = async (s: string) => {
    try { await setStatus.run(s); toast.push(`Marked ${stateLabel(s).toLowerCase()}.`); detail.reload(); onChanged(); }
    catch (e) { toast.push(e instanceof Error ? e.message : "Could not update status", "danger"); }
  };

  const changePriority = async (p: string) => {
    try { await setPriority.run(p); toast.push(`Priority set to ${stateLabel(p)}.`); detail.reload(); onChanged(); }
    catch (e) { toast.push(e instanceof Error ? e.message : "Could not update priority", "danger"); }
  };

  const changeAssignee = async (userId: string) => {
    try { await assign.run(userId); toast.push("Ticket reassigned."); detail.reload(); onChanged(); }
    catch (e) { toast.push(e instanceof Error ? e.message : "Could not reassign", "danger"); }
  };

  return (
    <Modal open onClose={onClose} variant="drawer" title={detail.data ? stateLabel(detail.data.issue.category) : "Issue"} description={detail.data?.issue.description}>
      <Panel loading={detail.loading} error={detail.error} onRetry={detail.reload}>
        {detail.data && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.data.issue.status} />
              <StatusBadge status={detail.data.issue.priority} toneMap={{ emergency: "danger", high: "warning", normal: "primary", low: "muted" }} />
              {detail.data.issue.escalatedToAdmin && <span className="rounded-full bg-danger/15 px-2.5 py-1 text-xs text-danger">Escalated to admin</span>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField as="select" label="Status" value={detail.data.issue.status} onChange={(e) => changeStatus(e.target.value)} disabled={setStatus.busy}>
                {!STATUS_OPTIONS.includes(detail.data.issue.status) && (
                  <option value={detail.data.issue.status} disabled>{stateLabel(detail.data.issue.status)} (initial)</option>
                )}
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{stateLabel(s)}</option>)}
              </FormField>
              <FormField as="select" label="Priority" value={detail.data.issue.priority} onChange={(e) => changePriority(e.target.value)} disabled={setPriority.busy}>
                {priorities.map((p) => <option key={p} value={p}>{stateLabel(p)}</option>)}
              </FormField>
            </div>

            <FormField as="select" label="Assigned to" value={detail.data.issue.assignedToUserId ?? ""} onChange={(e) => changeAssignee(e.target.value)} disabled={assign.busy}>
              <option value="" disabled>Choose someone…</option>
              {assignees.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
            </FormField>

            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Conversation</p>
              {messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">No messages yet.</p>
              ) : (
                <ul className="space-y-2">
                  {messages.map((m, i) => (
                    <li key={i} className="rounded-xl bg-foreground/5 p-3 text-sm">
                      <p className="text-xs font-semibold text-muted-foreground">{stateLabel(m.authorRole ?? "system")} · {formatDateTime(m.at)}</p>
                      <p className="mt-1">{m.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {closed ? (
              <p className="rounded-xl bg-foreground/5 p-3 text-sm text-muted-foreground">This ticket is closed. It's read-only from here.</p>
            ) : (
              <div className="flex items-end gap-2">
                <FormField as="textarea" label="Reply" className="flex-1" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Message the resident through this ticket…" />
                <button onClick={submitReply} disabled={!reply.trim() || sendReply.busy} className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50" aria-label="Send reply">
                  <Send className="size-4" />
                </button>
              </div>
            )}
            {sendReply.error && <p className="text-sm text-danger">{sendReply.error}</p>}

            {!closed && canEscalateFurther && (
              <button onClick={() => setEscalateOpen(true)} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-danger/10 py-2.5 text-sm font-semibold text-danger hover:bg-danger/20 focus-visible:ring-2 focus-visible:ring-ring">
                <ArrowUpCircle className="size-4" /> Escalate to admin
              </button>
            )}
            {!canEscalateFurther && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><AlertTriangle className="size-3.5" /> Already at the admin — there's nowhere higher to escalate.</p>
            )}
          </div>
        )}
      </Panel>
      {escalateOpen && (
        <EscalateModal issueId={issueId} onClose={() => setEscalateOpen(false)} onEscalated={() => { setEscalateOpen(false); detail.reload(); onChanged(); }} />
      )}
    </Modal>
  );
}

function EscalateModal({ issueId, onClose, onEscalated }: { issueId: string; onClose: () => void; onEscalated: () => void }) {
  const [note, setNote] = useState("");
  const toast = useToast();
  const escalate = useAction(() => supervisorApi.escalateIssue(issueId, note.trim()));

  const submit = async () => {
    try { await escalate.run(); toast.push("Escalated to admin."); onEscalated(); }
    catch { /* surfaced below */ }
  };

  return (
    <Modal open onClose={onClose} title="Escalate to admin" description="Explain why this needs the admin's attention — it's added to the ticket for them.">
      <div className="space-y-4">
        <FormField as="textarea" label="Note" required value={note} onChange={(e) => setNote(e.target.value)} placeholder="What have you tried, and why does this need the admin?" />
        {escalate.error && <p className="text-sm text-danger">{escalate.error}</p>}
        <button onClick={submit} disabled={!note.trim() || escalate.busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-danger py-3 font-semibold text-white shadow-glow hover:brightness-110 disabled:opacity-50">
          {escalate.busy ? "Escalating…" : "Escalate"}
        </button>
      </div>
    </Modal>
  );
}
