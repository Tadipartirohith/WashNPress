"use client";

import { useState } from "react";
import { Loader2, Plus, Send, ArrowUpCircle } from "lucide-react";
import { DataTable, type Column } from "@/components/portal/data-table";
import { StatusBadge } from "@/components/portal/status-badge";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { Button } from "@/components/ui/button";
import { useAsync, useAction } from "@/lib/use-async";
import { useToast } from "@/components/portal/toast";
import { formatDateTime } from "@/lib/format";
import { operationsApi, type Issue } from "@/lib/api/operations";

const STATUSES = ["open", "in_progress", "waiting_resident", "waiting_operator", "escalated_supervisor", "escalated_admin", "resolved", "closed"];

// Own issues raised, plus anything assigned to this operator — one screen to take a
// ticket, work it, answer the resident, and close it out.
export function IssuesTab({ onActivity }: { onActivity: () => void }) {
  const [mine, setMine] = useState(false);
  const [status, setStatus] = useState("");
  const issues = useAsync(() => operationsApi.issues({ mine: mine || undefined, status: status || undefined }), [mine, status]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  const columns: Column<Issue>[] = [
    {
      header: "Issue",
      cell: (i) => (
        <div>
          <p className="font-medium">{i.category.replace(/_/g, " ")}</p>
          <p className="max-w-xs truncate text-xs text-muted-foreground">{i.description}</p>
        </div>
      ),
    },
    { header: "Order", cell: (i) => <span className="text-sm">{i.order?.orderCode ?? "—"}</span> },
    { header: "Priority", cell: (i) => <StatusBadge status={i.priority} toneMap={{ high: "danger", emergency: "danger", normal: "muted", low: "muted" }} /> },
    { header: "Status", cell: (i) => <StatusBadge status={i.status} toneMap={{ resolved: "success", closed: "muted", open: "warning" }} /> },
    { header: "Opened", cell: (i) => <span className="text-sm">{formatDateTime(i.createdAt)}</span> },
    { header: "", align: "right", cell: (i) => <Button size="sm" variant="outline" onClick={() => setOpenId(i.id)}>Open</Button> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-full glass px-3.5 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-ring">
            <option value="">All statuses</option>
            {(issues.data?.statuses ?? STATUSES).map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="size-4 rounded border-border" />
            Assigned to me
          </label>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}><Plus className="size-4" /> Raise issue</Button>
      </div>
      <DataTable
        columns={columns}
        rows={issues.data?.issues ?? []}
        keyField={(i) => i.id}
        loading={issues.loading}
        error={issues.error}
        emptyTitle="No issues"
        emptyDescription="Tickets you raise or that reach you will show up here."
      />
      {openId && (
        <IssueDrawer
          issueId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => { issues.reload(); onActivity(); }}
        />
      )}
      {creating && (
        <CreateIssueModal
          onClose={() => setCreating(false)}
          onDone={() => { setCreating(false); issues.reload(); onActivity(); toast.push("Issue raised"); }}
        />
      )}
    </div>
  );
}

function IssueDrawer({ issueId, onClose, onChanged }: { issueId: string; onClose: () => void; onChanged: () => void }) {
  const issue = useAsync(() => operationsApi.issue(issueId), [issueId]);
  const [reply, setReply] = useState("");
  const [escalateNote, setEscalateNote] = useState("");
  const [escalating, setEscalating] = useState(false);
  const [resolution, setResolution] = useState("");

  const take = useAction(operationsApi.takeIssue);
  const replyAction = useAction(operationsApi.replyIssue);
  const escalate = useAction(operationsApi.escalateIssue);
  const setStatus = useAction(operationsApi.setIssueStatus);

  const refresh = () => { issue.reload(); onChanged(); };
  const i = issue.data?.issue;

  return (
    <Modal open onClose={onClose} variant="drawer" title={i ? i.category.replace(/_/g, " ") : "Issue"} description={i?.order?.orderCode ?? undefined}>
      {issue.loading ? (
        <div className="grid place-items-center py-12"><Loader2 className="size-5 animate-spin text-primary" /></div>
      ) : issue.error ? (
        <p className="text-sm text-danger">{issue.error}</p>
      ) : i && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={i.status} toneMap={{ resolved: "success", closed: "muted", open: "warning" }} />
            <StatusBadge status={i.priority} toneMap={{ high: "danger", emergency: "danger", normal: "muted", low: "muted" }} />
            {!i.assignedToUserId && (
              <Button size="sm" variant="outline" disabled={take.busy} onClick={() => take.run(i.id).then(refresh)}>
                {take.busy ? <Loader2 className="size-4 animate-spin" /> : "Take this ticket"}
              </Button>
            )}
          </div>

          <p className="text-sm">{i.description}</p>

          <div className="space-y-2 rounded-2xl glass p-4">
            <p className="text-xs font-medium text-muted-foreground">Conversation</p>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {i.messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">No messages yet.</p>
              ) : i.messages.map((m, idx) => (
                <div key={idx} className="rounded-xl bg-foreground/5 px-3 py-2 text-sm">
                  <p className="text-xs font-medium text-muted-foreground">{m.authorName ?? m.authorRole ?? m.author} · {formatDateTime(m.at)}</p>
                  <p>{m.body}</p>
                </div>
              ))}
            </div>
            {i.status !== "closed" && (
              <div className="flex gap-2 pt-2">
                <input
                  value={reply} onChange={(e) => setReply(e.target.value)}
                  placeholder="Write a reply…"
                  className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <Button
                  size="sm" disabled={replyAction.busy || !reply.trim()}
                  onClick={() => replyAction.run(i.id, reply.trim()).then(() => { setReply(""); refresh(); }).catch(() => {})}
                >
                  {replyAction.busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </Button>
              </div>
            )}
            {replyAction.error && <p className="text-xs text-danger">{replyAction.error}</p>}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Change status</p>
            <div className="flex flex-wrap gap-2">
              {["in_progress", "resolved", "closed"].map((s) => (
                <Button
                  key={s} size="sm" variant="outline" disabled={setStatus.busy}
                  onClick={() => { if (s === "resolved" && !resolution.trim()) return; setStatus.run(i.id, s, s === "resolved" ? resolution.trim() : undefined).then(refresh).catch(() => {}); }}
                >
                  {s.replace(/_/g, " ")}
                </Button>
              ))}
            </div>
            <FormField label="Resolution note (needed to resolve)" value={resolution} onChange={(e) => setResolution(e.target.value)} />
            {setStatus.error && <p className="text-xs text-danger">{setStatus.error}</p>}
          </div>

          {i.status !== "closed" && i.status !== "resolved" && (
            <div className="space-y-2 rounded-2xl bg-warning/10 p-4 ring-1 ring-warning/30">
              <p className="flex items-center gap-2 text-sm font-medium text-warning"><ArrowUpCircle className="size-4" /> Can&apos;t resolve this yourself?</p>
              {!escalating ? (
                <Button size="sm" variant="outline" onClick={() => setEscalating(true)}>Escalate to supervisor</Button>
              ) : (
                <div className="space-y-2">
                  <FormField as="textarea" label="Note for the supervisor" value={escalateNote} onChange={(e) => setEscalateNote(e.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEscalating(false)}>Cancel</Button>
                    <Button size="sm" disabled={escalate.busy} onClick={() => escalate.run(i.id, escalateNote.trim()).then(() => { setEscalating(false); refresh(); }).catch(() => {})}>
                      {escalate.busy ? <Loader2 className="size-4 animate-spin" /> : "Send to supervisor"}
                    </Button>
                  </div>
                  {escalate.error && <p className="text-xs text-danger">{escalate.error}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function CreateIssueModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const config = useAsync(() => operationsApi.config(), []);
  const [type, setType] = useState("");
  const [description, setDescription] = useState("");
  const [orderId, setOrderId] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  const action = useAction(operationsApi.createIssue);

  return (
    <Modal open onClose={onClose} title="Raise an issue">
      <div className="space-y-4">
        <FormField as="select" label="Type" required value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Choose a type</option>
          {config.data?.issueTypes.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </FormField>
        <FormField label="Order ID (optional)" value={orderId} onChange={(e) => setOrderId(e.target.value)} hint="Leave blank if this isn't about a specific order." />
        <FormField as="select" label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as "low" | "normal" | "high")}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </FormField>
        <FormField as="textarea" label="Description" required value={description} onChange={(e) => setDescription(e.target.value)} />
        {action.error && <p className="text-sm text-danger">{action.error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button
            className="flex-1" disabled={action.busy || !type || !description.trim()}
            onClick={() => action.run({ type, description: description.trim(), orderId: orderId.trim() || undefined, priority }).then(onDone)}
          >
            {action.busy ? <Loader2 className="size-4 animate-spin" /> : "Raise issue"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
