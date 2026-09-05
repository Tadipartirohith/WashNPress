"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Plus, Search, CheckCircle2, XCircle, UserCog } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { EmptyState } from "@/components/portal/empty-state";
import { useToast } from "@/components/portal/toast";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { useAsync, useAction } from "@/lib/use-async";
import { adminApi, type UserSummary } from "@/lib/api/admin";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { itemV, listV } from "../motion";

type SubTab = "supervisors" | "operators" | "verification" | "users";

export function PeopleSection() {
  const [tab, setTab] = React.useState<SubTab>("supervisors");
  const tabs: { id: SubTab; label: string }[] = [
    { id: "supervisors", label: "Supervisors" },
    { id: "operators", label: "Operators" },
    { id: "verification", label: "Verification queue" },
    { id: "users", label: "All users" },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium transition-colors",
              tab === t.id ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "supervisors" && <SupervisorsTab />}
      {tab === "operators" && <OperatorsTab />}
      {tab === "verification" && <VerificationTab />}
      {tab === "users" && <UsersTab />}
    </div>
  );
}

// --------------------------------------------------------------- supervisors

function SupervisorsTab() {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const { data, loading, error, reload } = useAsync(() => adminApi.supervisors.list({ q: q || undefined, status: status === "all" ? undefined : status }), [q, status]);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UserSummary | null>(null);
  const toast = useToast();

  const columns: Column<UserSummary>[] = [
    { header: "Name", cell: (r) => <span className="font-medium">{r.fullName ?? "—"}</span> },
    { header: "Phone", cell: (r) => r.phone },
    { header: "Society", cell: (r) => r.societyName ?? <span className="text-muted-foreground">Unassigned</span> },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} toneMap={{ active: "success", blocked: "danger", on_leave: "warning" }} /> },
    { header: "Verification", cell: (r) => r.verificationStatus ? <StatusBadge status={r.verificationStatus} toneMap={{ approved: "success", pending: "warning", rejected: "danger" }} /> : "—" },
    { header: "Edit", align: "right", cell: (r) => (
      <button onClick={(e) => { e.stopPropagation(); setEditing(r); }} className="rounded-full glass px-3 py-1.5 text-xs font-medium hover:ring-1 hover:ring-primary/40">Manage</button>
    ) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2 text-sm text-muted-foreground sm:max-w-xs">
          <Search className="size-4 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search supervisors" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="blocked">Blocked</option>
          <option value="on_leave">On leave</option>
        </select>
        <button onClick={() => setCreateOpen(true)} className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110">
          <Plus className="size-4" /> New supervisor
        </button>
      </div>

      <motion.div variants={listV} initial="hidden" animate="show">
        <motion.div variants={itemV}>
          <DataTable columns={columns} rows={data?.supervisors ?? []} keyField={(r) => r.id} loading={loading} error={error}
            emptyTitle="No supervisors yet" emptyDescription="Create one to run a society." />
        </motion.div>
      </motion.div>

      <CreateSupervisorModal open={createOpen} onClose={() => setCreateOpen(false)} societies={data?.societies ?? []}
        onCreated={() => { setCreateOpen(false); reload(); toast.push("Supervisor created"); }} />
      {editing && (
        <ManageSupervisorModal supervisor={editing} societies={data?.societies ?? []} onClose={() => setEditing(null)}
          onChanged={() => { setEditing(null); reload(); }} />
      )}
    </div>
  );
}

function CreateSupervisorModal({ open, onClose, societies, onCreated }: {
  open: boolean; onClose: () => void; societies: { id: string; name: string; supervisorUserId: string | null }[]; onCreated: () => void;
}) {
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [societyId, setSocietyId] = React.useState("");
  const create = useAction(() => adminApi.supervisors.create({ firstName, lastName, phone, email: email || undefined, societyId }));

  React.useEffect(() => { if (open) { setFirstName(""); setLastName(""); setPhone(""); setEmail(""); setSocietyId(""); } }, [open]);

  const available = societies.filter((s) => !s.supervisorUserId);

  return (
    <Modal open={open} onClose={onClose} title="New supervisor" description="They sign in with their own phone once created.">
      <form onSubmit={(e) => { e.preventDefault(); create.run().then(onCreated).catch(() => {}); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="First name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <FormField label="Last name" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <FormField label="Phone" required inputMode="tel" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value)} hint="10 digit mobile number" />
        <FormField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} hint="Optional" />
        <FormField as="select" label="Society" required value={societyId} onChange={(e) => setSocietyId(e.target.value)}>
          <option value="">Choose a society</option>
          {available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </FormField>
        {available.length === 0 && <p className="text-xs text-warning">Every society already has a supervisor. Add a society first, or reassign one.</p>}
        {create.error && <p className="text-sm text-danger">{create.error}</p>}
        <button type="submit" disabled={create.busy || !firstName || !lastName || phone.length < 10 || !societyId}
          className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {create.busy ? "Creating…" : "Create supervisor"}
        </button>
      </form>
    </Modal>
  );
}

function ManageSupervisorModal({ supervisor, societies, onClose, onChanged }: {
  supervisor: UserSummary; societies: { id: string; name: string; supervisorUserId: string | null }[]; onClose: () => void; onChanged: () => void;
}) {
  const toast = useToast();
  const [societyId, setSocietyId] = React.useState(supervisor.societyId ?? "");
  const [reason, setReason] = React.useState("");
  const reassignSociety = useAction(() => adminApi.supervisors.update(supervisor.id, { societyId }));
  const setAvailability = useAction((status: "active" | "on_leave" | "blocked") => adminApi.setAvailability(supervisor.id, { status, reason: reason || undefined }));

  const options = societies.filter((s) => !s.supervisorUserId || s.id === supervisor.societyId);

  return (
    <Modal open onClose={onClose} title={supervisor.fullName ?? "Supervisor"} description={supervisor.phone}>
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <StatusBadge status={supervisor.status} toneMap={{ active: "success", blocked: "danger", on_leave: "warning" }} />
          {supervisor.verificationStatus && <StatusBadge status={supervisor.verificationStatus} toneMap={{ approved: "success", pending: "warning", rejected: "danger" }} />}
        </div>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reassign society</h3>
          <div className="flex gap-2">
            <select value={societyId} onChange={(e) => setSocietyId(e.target.value)} className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
              {options.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button onClick={() => reassignSociety.run().then(() => { toast.push("Society reassigned"); onChanged(); }).catch(() => {})}
              disabled={reassignSociety.busy || societyId === supervisor.societyId}
              className="shrink-0 rounded-xl glass px-4 py-2 text-sm font-medium hover:ring-1 hover:ring-primary/40 disabled:opacity-50">
              Save
            </button>
          </div>
          {reassignSociety.error && <p className="text-xs text-danger">{reassignSociety.error}</p>}
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Availability</h3>
          <FormField as="textarea" label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this changing?" />
          <div className="flex flex-wrap gap-2">
            {(["active", "on_leave", "blocked"] as const).map((s) => (
              <button key={s} disabled={setAvailability.busy || supervisor.status === s}
                onClick={() => setAvailability.run(s).then(() => { toast.push(`Marked ${s.replace("_", " ")}`); onChanged(); }).catch(() => {})}
                className="rounded-full glass px-4 py-2 text-xs font-medium capitalize hover:ring-1 hover:ring-primary/40 disabled:opacity-40">
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
          {setAvailability.error && <p className="text-xs text-danger">{setAvailability.error}</p>}
        </section>
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------- operators

function OperatorsTab() {
  const [q, setQ] = React.useState("");
  const [societyId, setSocietyId] = React.useState("");
  const [availability, setAvailabilityFilter] = React.useState("all");
  const { data, loading, error, reload } = useAsync(
    () => adminApi.operators.list({ q: q || undefined, societyId: societyId || undefined, availability: availability === "all" ? undefined : availability }),
    [q, societyId, availability],
  );
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UserSummary | null>(null);
  const toast = useToast();

  const columns: Column<UserSummary>[] = [
    { header: "Name", cell: (r) => <span className="font-medium">{r.fullName ?? "—"}</span> },
    { header: "Phone", cell: (r) => r.phone },
    { header: "Society", cell: (r) => r.societyName ?? "—" },
    { header: "Blocks", cell: (r) => (r.blockNames?.length ? r.blockNames.join(", ") : <span className="text-muted-foreground">None</span>) },
    { header: "Supervisor", cell: (r) => r.supervisorName ?? "—" },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} toneMap={{ active: "success", blocked: "danger", on_leave: "warning" }} /> },
    { header: "Edit", align: "right", cell: (r) => (
      <button onClick={(e) => { e.stopPropagation(); setEditing(r); }} className="rounded-full glass px-3 py-1.5 text-xs font-medium hover:ring-1 hover:ring-primary/40">Manage</button>
    ) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2 text-sm text-muted-foreground sm:max-w-xs">
          <Search className="size-4 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search operators" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
        </div>
        <select value={societyId} onChange={(e) => setSocietyId(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">All societies</option>
          {(data?.societies ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={availability} onChange={(e) => setAvailabilityFilter(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="blocked">Blocked</option>
          <option value="on_leave">On leave</option>
        </select>
        <button onClick={() => setCreateOpen(true)} className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110">
          <Plus className="size-4" /> New operator
        </button>
      </div>

      <motion.div variants={listV} initial="hidden" animate="show">
        <motion.div variants={itemV}>
          <DataTable columns={columns} rows={data?.operators ?? []} keyField={(r) => r.id} loading={loading} error={error}
            emptyTitle="No operators yet" emptyDescription="Create one to process garments in a society." />
        </motion.div>
      </motion.div>

      <CreateOperatorModal open={createOpen} onClose={() => setCreateOpen(false)} societies={data?.societies ?? []} blocks={data?.blocks ?? []}
        onCreated={() => { setCreateOpen(false); reload(); toast.push("Operator created"); }} />
      {editing && (
        <ManageOperatorModal operator={editing} societies={data?.societies ?? []} blocks={data?.blocks ?? []} onClose={() => setEditing(null)}
          onChanged={() => { setEditing(null); reload(); }} />
      )}
    </div>
  );
}

function CreateOperatorModal({ open, onClose, societies, blocks, onCreated }: {
  open: boolean; onClose: () => void; societies: { id: string; name: string }[]; blocks: { id: string; name: string; societyId: string }[]; onCreated: () => void;
}) {
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [societyId, setSocietyId] = React.useState("");
  const [blockIds, setBlockIds] = React.useState<string[]>([]);
  const create = useAction(() => adminApi.operators.create({ firstName, lastName, phone, email, societyId, blockIds }));

  React.useEffect(() => { if (open) { setFirstName(""); setLastName(""); setPhone(""); setEmail(""); setSocietyId(""); setBlockIds([]); } }, [open]);

  const societyBlocks = blocks.filter((b) => b.societyId === societyId);

  return (
    <Modal open={open} onClose={onClose} title="New operator" description="Operators process garments for the blocks they are given.">
      <form onSubmit={(e) => { e.preventDefault(); create.run().then(onCreated).catch(() => {}); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="First name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <FormField label="Last name" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <FormField label="Phone" required inputMode="tel" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value)} />
        <FormField label="Email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <FormField as="select" label="Society" required value={societyId} onChange={(e) => { setSocietyId(e.target.value); setBlockIds([]); }}>
          <option value="">Choose a society</option>
          {societies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </FormField>
        {societyId && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Blocks covered</label>
            {societyBlocks.length === 0 ? (
              <p className="text-xs text-muted-foreground">This society has no blocks yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {societyBlocks.map((b) => {
                  const on = blockIds.includes(b.id);
                  return (
                    <button type="button" key={b.id}
                      onClick={() => setBlockIds((ids) => on ? ids.filter((id) => id !== b.id) : [...ids, b.id])}
                      className={cn("rounded-full px-3 py-1.5 text-xs font-medium", on ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "glass text-muted-foreground")}>
                      {b.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {create.error && <p className="text-sm text-danger">{create.error}</p>}
        <button type="submit" disabled={create.busy || !firstName || !lastName || phone.length < 10 || !email || !societyId}
          className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {create.busy ? "Creating…" : "Create operator"}
        </button>
      </form>
    </Modal>
  );
}

function ManageOperatorModal({ operator, societies, blocks, onClose, onChanged }: {
  operator: UserSummary; societies: { id: string; name: string }[]; blocks: { id: string; name: string; societyId: string }[];
  onClose: () => void; onChanged: () => void;
}) {
  const toast = useToast();
  const [societyId, setSocietyId] = React.useState(operator.societyId ?? "");
  const [blockIds, setBlockIds] = React.useState<string[]>(operator.blockIds ?? []);
  const [reason, setReason] = React.useState("");
  const saveAssignment = useAction(() => adminApi.operators.update(operator.id, { societyId, blockIds }));
  const setAvailability = useAction((status: "active" | "on_leave" | "blocked") => adminApi.setAvailability(operator.id, { status, reason: reason || undefined }));

  const societyBlocks = blocks.filter((b) => b.societyId === societyId);

  return (
    <Modal open onClose={onClose} title={operator.fullName ?? "Operator"} description={operator.phone}>
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <StatusBadge status={operator.status} toneMap={{ active: "success", blocked: "danger", on_leave: "warning" }} />
        </div>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Society & blocks</h3>
          <select value={societyId} onChange={(e) => { setSocietyId(e.target.value); setBlockIds([]); }} className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
            {societies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div className="flex flex-wrap gap-2">
            {societyBlocks.map((b) => {
              const on = blockIds.includes(b.id);
              return (
                <button type="button" key={b.id} onClick={() => setBlockIds((ids) => on ? ids.filter((id) => id !== b.id) : [...ids, b.id])}
                  className={cn("rounded-full px-3 py-1.5 text-xs font-medium", on ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "glass text-muted-foreground")}>
                  {b.name}
                </button>
              );
            })}
          </div>
          <button onClick={() => saveAssignment.run().then(() => { toast.push("Assignment updated"); onChanged(); }).catch(() => {})} disabled={saveAssignment.busy}
            className="rounded-xl glass px-4 py-2 text-sm font-medium hover:ring-1 hover:ring-primary/40 disabled:opacity-50">
            Save assignment
          </button>
          {saveAssignment.error && <p className="text-xs text-danger">{saveAssignment.error}</p>}
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Availability</h3>
          <FormField as="textarea" label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Any open orders can be handed to another operator automatically." />
          <div className="flex flex-wrap gap-2">
            {(["active", "on_leave", "blocked"] as const).map((s) => (
              <button key={s} disabled={setAvailability.busy || operator.status === s}
                onClick={() => setAvailability.run(s).then((r) => { toast.push(r.reassigned ? `Marked ${s.replace("_", " ")} — open orders reassigned` : `Marked ${s.replace("_", " ")}`); onChanged(); }).catch(() => {})}
                className="rounded-full glass px-4 py-2 text-xs font-medium capitalize hover:ring-1 hover:ring-primary/40 disabled:opacity-40">
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
          {setAvailability.error && <p className="text-xs text-danger">{setAvailability.error}</p>}
        </section>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------- verification

function VerificationTab() {
  const [status, setStatus] = React.useState("pending");
  const { data, loading, error, reload } = useAsync(() => adminApi.staff.pending({ status }), [status]);
  const toast = useToast();
  const { promptText } = useConfirm();
  const act = useAction((id: string, decision: "approved" | "rejected", note?: string) => adminApi.staff.verify(id, { status: decision, note }));

  return (
    <div className="space-y-4">
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
        <option value="pending">Pending</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
      </select>
      <Panel loading={loading} error={error} onRetry={reload}>
        {(data?.staff.length ?? 0) === 0 ? (
          <EmptyState icon={UserCog} title={`No ${status} staff`} description="Nobody in this state right now." />
        ) : (
          <motion.div variants={listV} initial="hidden" animate="show" className="space-y-2">
            {data!.staff.map((u) => (
              <motion.div key={u.id} variants={itemV} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl glass p-4">
                <div>
                  <p className="font-medium">{u.fullName ?? u.phone} <span className="ml-1 text-xs font-normal text-muted-foreground">{u.roles.filter((r) => r !== "resident").join(", ")}</span></p>
                  <p className="text-xs text-muted-foreground">{u.phone} · {u.societyName ?? "No society"}</p>
                </div>
                {status === "pending" && (
                  <div className="flex gap-2">
                    <button onClick={() => act.run(u.id, "approved").then(() => { toast.push("Approved"); reload(); }).catch(() => toast.push(act.error ?? "Failed", "danger"))}
                      className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1.5 text-xs font-medium text-success ring-1 ring-success/30 hover:brightness-110">
                      <CheckCircle2 className="size-3.5" /> Approve
                    </button>
                    <button
                      onClick={async () => {
                        const note = await promptText({ title: "Reject this account?", label: "Reason for rejecting (optional)", confirmLabel: "Reject", danger: true });
                        if (note === null) return;
                        act.run(u.id, "rejected", note || undefined).then(() => { toast.push("Rejected"); reload(); }).catch(() => toast.push(act.error ?? "Failed", "danger"));
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full bg-danger/15 px-3 py-1.5 text-xs font-medium text-danger ring-1 ring-danger/30 hover:brightness-110">
                      <XCircle className="size-3.5" /> Reject
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </motion.div>
        )}
      </Panel>
    </div>
  );
}

// -------------------------------------------------------------------- users

function UsersTab() {
  const [q, setQ] = React.useState("");
  const [role, setRole] = React.useState("all");
  const [status, setStatus] = React.useState("all");
  const { data, loading, error, reload } = useAsync(
    () => adminApi.users.list({ q: q || undefined, role: role === "all" ? undefined : role, status: status === "all" ? undefined : status }),
    [q, role, status],
  );
  const toast = useToast();
  const { confirm } = useConfirm();
  const act = useAction((id: string, next: "active" | "blocked" | "deleted") => adminApi.users.setStatus(id, next));

  const columns: Column<UserSummary>[] = [
    { header: "Name", cell: (r) => <span className="font-medium">{r.fullName ?? "—"}</span> },
    { header: "Phone", cell: (r) => r.phone },
    { header: "Role", cell: (r) => r.roles.join(", ") },
    { header: "Society", cell: (r) => r.societyLabel ?? "—" },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} toneMap={{ active: "success", blocked: "danger", deleted: "muted", on_leave: "warning" }} /> },
    { header: "Action", align: "right", cell: (r) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {r.status !== "active" && (
          <button onClick={() => act.run(r.id, "active").then(() => { toast.push("Activated"); reload(); }).catch((e) => toast.push(e instanceof ApiError ? e.message : "Failed", "danger"))}
            className="rounded-full glass px-2.5 py-1 text-xs hover:ring-1 hover:ring-success/40">Activate</button>
        )}
        {r.status !== "blocked" && (
          <button onClick={() => act.run(r.id, "blocked").then(() => { toast.push("Blocked"); reload(); }).catch((e) => toast.push(e instanceof ApiError ? e.message : "Failed", "danger"))}
            className="rounded-full glass px-2.5 py-1 text-xs hover:ring-1 hover:ring-warning/40">Block</button>
        )}
        {r.status !== "deleted" && (
          <button
            onClick={async () => {
              const ok = await confirm({ title: "Deactivate this account?", description: "It can be reactivated later.", confirmLabel: "Deactivate", danger: true });
              if (!ok) return;
              act.run(r.id, "deleted").then(() => { toast.push("Deactivated"); reload(); }).catch((e) => toast.push(e instanceof ApiError ? e.message : "Failed", "danger"));
            }}
            className="rounded-full glass px-2.5 py-1 text-xs text-danger hover:ring-1 hover:ring-danger/40">Deactivate</button>
        )}
      </div>
    ) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2 text-sm text-muted-foreground sm:max-w-xs">
          <Search className="size-4 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, phone, email" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
        </div>
        <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="all">All roles</option>
          <option value="supervisor">Supervisor</option>
          <option value="operator">Operator</option>
          <option value="resident">Resident</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="blocked">Blocked</option>
          <option value="deleted">Deactivated</option>
        </select>
      </div>
      <DataTable columns={columns} rows={data?.users ?? []} keyField={(r) => r.id} loading={loading} error={error}
        emptyTitle="No users match" emptyDescription="Try a different search or filter." />
    </div>
  );
}
