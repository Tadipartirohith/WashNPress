"use client";

import { useState, type ReactNode } from "react";
import { Plus, Search, LogOut, RotateCcw, Ban, Phone, Building2, CalendarDays, ClipboardList } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { useAsync, useAction } from "@/lib/use-async";
import { useToast } from "@/components/portal/toast";
import { supervisorApi, type OperatorSummary, type WorkloadRow, type AvailabilityResult } from "@/lib/api/supervisor";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { towerLabel } from "@/lib/unit";
import { HandoverFlowModal } from "./handover-flow";
import { emailProblem, isEmail, isPhone, phoneProblem } from "@/lib/contact";

type TargetStatus = "on_leave" | "blocked" | "active";

const STATUS_TONE = { active: "success", on_leave: "warning", blocked: "danger" } as const;
const STATUS_LABEL: Record<string, string> = { active: "Active", on_leave: "On leave", blocked: "Blocked" };

// Duty is derived from the account status: an active operator is on duty, anyone on
// leave or blocked is off duty. There is a single source of truth (status), shown two
// ways the supervisor thinks about it — is the account live, and are they working today.
function isOnDuty(o: { status: string }): boolean {
  return o.status === "active";
}

export function OperatorsTab() {
  const [status, setStatus] = useState<string>("all");
  const [blockId, setBlockId] = useState<string>("all");
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<OperatorSummary | null>(null);
  const [viewing, setViewing] = useState<OperatorSummary | null>(null);
  const [handover, setHandover] = useState<{ operator: OperatorSummary; target: TargetStatus } | null>(null);

  const list = useAsync(() => supervisorApi.operators({ status: status === "all" ? undefined : status, blockId: blockId === "all" ? undefined : blockId, q: q || undefined }), [status, blockId, q]);
  const workload = useAsync(() => supervisorApi.workload(), []);
  const workloadFor = (userId: string): WorkloadRow | undefined => workload.data?.workload.find((w) => w.userId === userId);

  const reloadAll = () => { list.reload(); workload.reload(); };
  const onHandoverDone = (_result: AvailabilityResult) => { setHandover(null); reloadAll(); };

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
    { header: "Status", cell: (o) => <StatusBadge status={o.status} label={STATUS_LABEL[o.status]} toneMap={STATUS_TONE} /> },
    { header: "Duty", cell: (o) => (
      isOnDuty(o)
        ? <span className="inline-flex items-center gap-1.5 text-sm text-success"><span className="size-1.5 rounded-full bg-success" /> On duty</span>
        : <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><span className="size-1.5 rounded-full bg-muted-foreground/50" /> Off duty</span>
    ) },
    {
      header: "Actions", align: "right", cell: (o) => (
        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          {isOnDuty(o) ? (
            <button onClick={() => setHandover({ operator: o, target: "on_leave" })} className="inline-flex items-center gap-1 rounded-full glass px-3 py-1.5 text-xs font-medium hover:ring-1 hover:ring-warning/40 focus-visible:ring-2 focus-visible:ring-ring">
              <LogOut className="size-3.5" /> Off duty
            </button>
          ) : (
            <button onClick={() => setHandover({ operator: o, target: "active" })} className="inline-flex items-center gap-1 rounded-full glass px-3 py-1.5 text-xs font-medium hover:ring-1 hover:ring-success/40 focus-visible:ring-2 focus-visible:ring-ring">
              <RotateCcw className="size-3.5" /> On duty
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
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
          {list.data?.blocks.map((b) => <option key={b.id} value={b.id}>{towerLabel(b.name)}</option>)}
        </FormField>
        <button onClick={() => setCreateOpen(true)} className="ml-auto inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring">
          <Plus className="size-4" /> Add operator
        </button>
      </div>

      <Panel loading={list.loading} error={list.error} onRetry={list.reload}>
        <DataTable
          columns={columns}
          rows={list.data?.operators ?? []}
          keyField={(o) => o.id}
          onRowClick={(o) => setViewing(o)}
          emptyTitle="No operators match"
          emptyDescription="Add your first operator or clear the filters."
        />
      </Panel>

      {viewing && (
        <OperatorDrawer
          operator={viewing}
          workload={workloadFor(viewing.id)}
          onClose={() => setViewing(null)}
          onEdit={() => { const o = viewing; setViewing(null); setEditing(o); }}
          onDuty={(target) => { const o = viewing; setViewing(null); setHandover({ operator: o, target }); }}
        />
      )}
      {createOpen && <CreateOperatorModal onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); reloadAll(); }} blocks={list.data?.blocks ?? []} />}
      {editing && <EditOperatorModal operator={editing} blocks={list.data?.blocks ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reloadAll(); }} />}
      {handover && <HandoverFlowModal operator={handover.operator} target={handover.target} onClose={() => setHandover(null)} onDone={onHandoverDone} />}
    </div>
  );
}

// Row-click details drawer. Shows the operator's full profile, current workload and
// the same on/off-duty quick action as the row, plus Edit and Block.
function OperatorDrawer({ operator, workload, onClose, onEdit, onDuty }: {
  operator: OperatorSummary;
  workload?: WorkloadRow;
  onClose: () => void;
  onEdit: () => void;
  onDuty: (target: TargetStatus) => void;
}) {
  const active = (workload?.pending ?? 0) + (workload?.processing ?? 0);
  const completed = workload?.completed ?? 0;
  const towers = operator.blockNames?.length ? operator.blockNames.join(", ") : "None";

  const rows: [ReactNode, ReactNode][] = [
    [<span className="inline-flex items-center gap-2"><Phone className="size-4 text-muted-foreground" />Phone</span>, operator.phone],
    ["Operator ID", operator.employeeId ?? "—"],
    [<span className="inline-flex items-center gap-2"><Building2 className="size-4 text-muted-foreground" />Assigned towers</span>, towers],
    ["Status", <StatusBadge status={operator.status} label={STATUS_LABEL[operator.status]} toneMap={STATUS_TONE} />],
    ["Duty", isOnDuty(operator) ? "On duty" : "Off duty"],
    [<span className="inline-flex items-center gap-2"><ClipboardList className="size-4 text-muted-foreground" />Workload</span>,
      active > 0 ? `${active} active · ${completed} completed` : "0 / No assigned orders"],
    [<span className="inline-flex items-center gap-2"><CalendarDays className="size-4 text-muted-foreground" />Joined</span>, formatDate(operator.createdAt)],
  ];

  return (
    <Modal open onClose={onClose} variant="drawer" title={operator.fullName ?? "Operator"} description={operator.societyName ?? undefined}>
      <div className="space-y-4">
        <section className="rounded-2xl glass p-3">
          {rows.map(([k, v], i) => (
            <div key={i} className="flex items-center justify-between gap-4 py-1.5 text-sm">
              <span className="text-muted-foreground">{k}</span>
              <span className="text-right font-medium">{v}</span>
            </div>
          ))}
        </section>
        <div className="flex flex-wrap gap-2">
          <button onClick={onEdit} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110">Edit</button>
          {isOnDuty(operator) ? (
            <button onClick={() => onDuty("on_leave")} className="inline-flex items-center gap-1.5 rounded-xl glass px-4 py-2 text-sm font-medium hover:ring-1 hover:ring-warning/40">
              <LogOut className="size-4" /> Set off duty
            </button>
          ) : (
            <button onClick={() => onDuty("active")} className="inline-flex items-center gap-1.5 rounded-xl glass px-4 py-2 text-sm font-medium hover:ring-1 hover:ring-success/40">
              <RotateCcw className="size-4" /> Set on duty
            </button>
          )}
          {operator.status !== "blocked" && (
            <button onClick={() => onDuty("blocked")} className="inline-flex items-center gap-1.5 rounded-xl glass px-4 py-2 text-sm font-medium text-danger hover:ring-1 hover:ring-danger/40">
              <Ban className="size-4" /> Block
            </button>
          )}
        </div>
      </div>
    </Modal>
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

  // /.+@.+\..+/ was looser than the rule the API applies — it accepts "a@b.c" and an
  // address with a space in it — so this form let through addresses the server then
  // refused. Both ends now ask the same question.
  const phoneError = phoneProblem(phone);
  const emailError = emailProblem(email, { required: true });
  const valid = firstName.trim() && lastName.trim() && isPhone(phone) && isEmail(email);

  return (
    <Modal open onClose={onClose} title="Add an operator" description="They'll cover the towers you assign, inside your society only." variant="drawer">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="First name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <FormField label="Last name" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <FormField label="Phone" required inputMode="tel" maxLength={10} value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} error={phoneError ?? undefined} />
        <FormField label="Email" required inputMode="email" value={email}
          onChange={(e) => setEmail(e.target.value)} error={emailError ?? undefined} />
        {blocks.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Towers covered</p>
            <div className="flex flex-wrap gap-2">
              {blocks.map((b) => (
                <button key={b.id} type="button" onClick={() => toggle(b.id)} className={cn("rounded-full px-3 py-1.5 text-xs font-medium transition", blockIds.has(b.id) ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "glass text-muted-foreground hover:text-foreground")}>
                  {towerLabel(b.name)}
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

  // Editing checked nothing at all, so an address refused at creation could be put on
  // the same account a minute later.
  const emailError = emailProblem(email, { required: true });

  return (
    <Modal open onClose={onClose} title={`Edit ${operator.fullName ?? "operator"}`} variant="drawer">
      <div className="space-y-4">
        <FormField label="Full name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <FormField label="Email" required inputMode="email" value={email}
          onChange={(e) => setEmail(e.target.value)} error={emailError ?? undefined} />
        {blocks.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Towers covered</p>
            <div className="flex flex-wrap gap-2">
              {blocks.map((b) => (
                <button key={b.id} type="button" onClick={() => toggle(b.id)} className={cn("rounded-full px-3 py-1.5 text-xs font-medium transition", blockIds.has(b.id) ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "glass text-muted-foreground hover:text-foreground")}>
                  {towerLabel(b.name)}
                </button>
              ))}
            </div>
          </div>
        )}
        {save.error && <p className="text-sm text-danger">{save.error}</p>}
        <button onClick={submit} disabled={!fullName.trim() || !isEmail(email) || save.busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {save.busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}
