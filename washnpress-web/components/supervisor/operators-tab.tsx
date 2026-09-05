"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Search, ShieldCheck, ShieldX, LogOut, RotateCcw, Ban, BarChart3, Users } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { EmptyState } from "@/components/portal/empty-state";
import { useAsync, useAction } from "@/lib/use-async";
import { useToast } from "@/components/portal/toast";
import { supervisorApi, type OperatorSummary, type AvailabilityResult } from "@/lib/api/supervisor";
import { cn } from "@/lib/utils";
import { HandoverFlowModal } from "./handover-flow";

type View = "directory" | "pending" | "workload";
type TargetStatus = "on_leave" | "blocked" | "active";

const listV = { show: { transition: { staggerChildren: 0.04 } } };
const itemV = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } };

export function OperatorsTab() {
  const [view, setView] = useState<View>("directory");
  const [status, setStatus] = useState<string>("all");
  const [blockId, setBlockId] = useState<string>("all");
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<OperatorSummary | null>(null);
  const [handover, setHandover] = useState<{ operator: OperatorSummary; target: TargetStatus } | null>(null);
  const toast = useToast();

  const list = useAsync(() => supervisorApi.operators({ status: status === "all" ? undefined : status, blockId: blockId === "all" ? undefined : blockId, q: q || undefined }), [status, blockId, q]);
  const pending = useAsync(() => supervisorApi.pendingOperators("pending"), []);
  const workload = useAsync(() => supervisorApi.workload(), []);

  const reloadAll = () => { list.reload(); pending.reload(); workload.reload(); };

  const onHandoverDone = (_result: AvailabilityResult) => {
    setHandover(null);
    reloadAll();
  };

  const columns: Column<OperatorSummary>[] = [
    {
      header: "Operator", cell: (o) => (
        <div>
          <p className="font-medium">{o.fullName ?? "Unnamed"}</p>
          <p className="text-xs text-muted-foreground">{o.phone}{o.employeeId ? ` · ${o.employeeId}` : ""}</p>
        </div>
      ),
    },
    { header: "Towers", cell: (o) => (o.blockNames?.length ? o.blockNames.join(", ") : "None") },
    { header: "Status", cell: (o) => <StatusBadge status={o.status} toneMap={{ active: "success", on_leave: "warning", blocked: "danger" }} /> },
    {
      header: "Verification", cell: (o) => o.verificationStatus === "pending"
        ? <StatusBadge status="pending" toneMap={{ pending: "warning" }} />
        : o.verificationStatus === "rejected"
          ? <StatusBadge status="rejected" toneMap={{ rejected: "danger" }} />
          : <StatusBadge status="approved" toneMap={{ approved: "success" }} label="Verified" />,
    },
    {
      header: "", align: "right", cell: (o) => (
        <div className="flex justify-end gap-1.5">
          <button onClick={() => setEditing(o)} className="rounded-full glass px-3 py-1.5 text-xs font-medium hover:ring-1 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring">Edit</button>
          {o.status === "active" ? (
            <button onClick={() => setHandover({ operator: o, target: "on_leave" })} className="inline-flex items-center gap-1 rounded-full glass px-3 py-1.5 text-xs font-medium hover:ring-1 hover:ring-warning/40 focus-visible:ring-2 focus-visible:ring-ring">
              <LogOut className="size-3.5" /> Off duty
            </button>
          ) : (
            <button onClick={() => setHandover({ operator: o, target: "active" })} className="inline-flex items-center gap-1 rounded-full glass px-3 py-1.5 text-xs font-medium hover:ring-1 hover:ring-success/40 focus-visible:ring-2 focus-visible:ring-ring">
              <RotateCcw className="size-3.5" /> Reactivate
            </button>
          )}
          {o.status !== "blocked" && (
            <button onClick={() => setHandover({ operator: o, target: "blocked" })} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Block ${o.fullName ?? "operator"}`}>
              <Ban className="size-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <ViewPill active={view === "directory"} onClick={() => setView("directory")} icon={Users} label="Directory" count={list.data?.counts.all} />
        <ViewPill active={view === "pending"} onClick={() => setView("pending")} icon={ShieldCheck} label="Pending verification" count={pending.data?.operators.length} tone="warning" />
        <ViewPill active={view === "workload"} onClick={() => setView("workload")} icon={BarChart3} label="Workload" />
        <button onClick={() => setCreateOpen(true)} className="ml-auto inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring">
          <Plus className="size-4" /> Add operator
        </button>
      </div>

      {view === "directory" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2 text-sm">
              <Search className="size-4 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
            </div>
            <FormField as="select" label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
              <option value="all">All statuses ({list.data?.counts.all ?? 0})</option>
              <option value="active">Active ({list.data?.counts.active ?? 0})</option>
              <option value="on_leave">On leave ({list.data?.counts.on_leave ?? 0})</option>
              <option value="blocked">Blocked ({list.data?.counts.blocked ?? 0})</option>
            </FormField>
            <FormField as="select" label="Tower" value={blockId} onChange={(e) => setBlockId(e.target.value)} className="w-40">
              <option value="all">All towers</option>
              {list.data?.blocks.map((b) => <option key={b.id} value={b.id}>Tower {b.name}</option>)}
            </FormField>
          </div>
          <Panel loading={list.loading} error={list.error} onRetry={list.reload}>
            <DataTable
              columns={columns}
              rows={list.data?.operators ?? []}
              keyField={(o) => o.id}
              emptyTitle="No operators match"
              emptyDescription="Add your first operator or clear the filters."
            />
          </Panel>
        </div>
      )}

      {view === "pending" && (
        <Panel loading={pending.loading} error={pending.error} onRetry={pending.reload}>
          {(pending.data?.operators.length ?? 0) === 0 ? (
            <EmptyState icon={ShieldCheck} title="Nothing to verify" description="Every operator in your society has already been reviewed." />
          ) : (
            <motion.div variants={listV} initial="hidden" animate="show" className="space-y-3">
              {pending.data!.operators.map((o) => (
                <motion.div key={o.id} variants={itemV} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl glass p-4">
                  <div>
                    <p className="text-sm font-semibold">{o.fullName ?? "Unnamed"}</p>
                    <p className="text-xs text-muted-foreground">{o.phone} · {o.email ?? "no email"}</p>
                  </div>
                  <VerifyActions operator={o} onDone={reloadAll} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </Panel>
      )}

      {view === "workload" && (
        <Panel loading={workload.loading} error={workload.error} onRetry={workload.reload}>
          <DataTable
            columns={[
              { header: "Operator", cell: (w) => <div><p className="font-medium">{w.name ?? "Unnamed"}</p><p className="text-xs text-muted-foreground">{w.employeeId}</p></div> },
              { header: "Status", cell: (w) => <StatusBadge status={w.status} toneMap={{ active: "success", on_leave: "warning", blocked: "danger" }} /> },
              { header: "Pending", align: "right", cell: (w) => <span className="tabular-nums">{w.pending}</span> },
              { header: "Processing", align: "right", cell: (w) => <span className="tabular-nums">{w.processing}</span> },
              { header: "Completed", align: "right", cell: (w) => <span className="tabular-nums">{w.completed}</span> },
              { header: "QC failures", align: "right", cell: (w) => <span className={cn("tabular-nums", w.qcFailures > 0 && "text-danger")}>{w.qcFailures}</span> },
            ]}
            rows={workload.data?.workload ?? []}
            keyField={(w) => w.userId}
            emptyTitle="No operators yet"
          />
        </Panel>
      )}

      {createOpen && <CreateOperatorModal onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); reloadAll(); }} blocks={list.data?.blocks ?? []} />}
      {editing && <EditOperatorModal operator={editing} blocks={list.data?.blocks ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reloadAll(); }} />}
      {handover && <HandoverFlowModal operator={handover.operator} target={handover.target} onClose={() => setHandover(null)} onDone={onHandoverDone} />}
    </div>
  );
}

function ViewPill({ active, onClick, icon: Icon, label, count, tone }: { active: boolean; onClick: () => void; icon: typeof Users; label: string; count?: number; tone?: "warning" }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
      )}
    >
      <Icon className="size-4" /> {label}
      {count !== undefined && count > 0 && (
        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", tone === "warning" ? "bg-warning/20 text-warning" : "bg-foreground/10 text-foreground")}>{count}</span>
      )}
    </button>
  );
}

function VerifyActions({ operator, onDone }: { operator: OperatorSummary; onDone: () => void }) {
  const toast = useToast();
  const act = useAction((status: "approved" | "rejected") => supervisorApi.setVerification(operator.id, { status }));
  const run = async (status: "approved" | "rejected") => {
    try {
      await act.run(status);
      toast.push(status === "approved" ? `${operator.fullName ?? "Operator"} approved.` : `${operator.fullName ?? "Operator"} rejected.`, status === "approved" ? "success" : "danger");
      onDone();
    } catch (e) { toast.push(e instanceof Error ? e.message : "Could not update verification", "danger"); }
  };
  return (
    <div className="flex gap-2">
      <button onClick={() => run("rejected")} disabled={act.busy} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring">
        <ShieldX className="size-3.5" /> Reject
      </button>
      <button onClick={() => run("approved")} disabled={act.busy} className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3.5 py-2 text-xs font-semibold text-success hover:bg-success/25 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring">
        <ShieldCheck className="size-3.5" /> Approve
      </button>
    </div>
  );
}

function CreateOperatorModal({ onClose, onCreated, blocks }: { onClose: () => void; onCreated: () => void; blocks: { id: string; name: string }[] }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [blockIds, setBlockIds] = useState<Set<string>>(new Set());
  const toast = useToast();
  const create = useAction(() => supervisorApi.createOperator({ firstName, lastName, phone, email, blockIds: Array.from(blockIds) }));

  const toggle = (id: string) => setBlockIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submit = async () => {
    try { await create.run(); toast.push(`${firstName} added as an operator.`); onCreated(); } catch { /* surfaced below */ }
  };

  const valid = firstName.trim() && lastName.trim() && phone.length === 10 && /.+@.+\..+/.test(email);

  return (
    <Modal open onClose={onClose} title="Add an operator" description="They'll cover the towers you assign, inside your society only.">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="First name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <FormField label="Last name" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <FormField label="Phone" required inputMode="tel" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} />
        <FormField label="Email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        {blocks.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Towers covered</p>
            <div className="flex flex-wrap gap-2">
              {blocks.map((b) => (
                <button key={b.id} type="button" onClick={() => toggle(b.id)} className={cn("rounded-full px-3 py-1.5 text-xs font-medium transition", blockIds.has(b.id) ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "glass text-muted-foreground hover:text-foreground")}>
                  Tower {b.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {create.error && <p className="text-sm text-danger">{create.error}</p>}
        <button onClick={submit} disabled={!valid || create.busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {create.busy ? "Adding…" : "Add operator"}
        </button>
      </div>
    </Modal>
  );
}

function EditOperatorModal({ operator, blocks, onClose, onSaved }: { operator: OperatorSummary; blocks: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [fullName, setFullName] = useState(operator.fullName ?? "");
  const [email, setEmail] = useState(operator.email ?? "");
  const [blockIds, setBlockIds] = useState<Set<string>>(new Set(operator.blockIds));
  const toast = useToast();
  const save = useAction(() => supervisorApi.updateOperator(operator.id, { fullName, email, blockIds: Array.from(blockIds) }));

  const toggle = (id: string) => setBlockIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submit = async () => {
    try { await save.run(); toast.push("Operator updated."); onSaved(); } catch { /* surfaced below */ }
  };

  return (
    <Modal open onClose={onClose} title={`Edit ${operator.fullName ?? "operator"}`}>
      <div className="space-y-4">
        <FormField label="Full name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <FormField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        {blocks.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Towers covered</p>
            <div className="flex flex-wrap gap-2">
              {blocks.map((b) => (
                <button key={b.id} type="button" onClick={() => toggle(b.id)} className={cn("rounded-full px-3 py-1.5 text-xs font-medium transition", blockIds.has(b.id) ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "glass text-muted-foreground hover:text-foreground")}>
                  Tower {b.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {save.error && <p className="text-sm text-danger">{save.error}</p>}
        <button onClick={submit} disabled={!fullName.trim() || save.busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {save.busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}
