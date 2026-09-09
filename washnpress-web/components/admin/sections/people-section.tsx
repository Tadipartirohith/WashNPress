"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Plus, Search } from "lucide-react";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { useToast } from "@/components/portal/toast";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { useAsync, useAction } from "@/lib/use-async";
import { adminApi, type UserSummary } from "@/lib/api/admin";
import { ApiError } from "@/lib/api-client";
import { formatDate, rupees, stateLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { itemV, listV } from "../motion";

type SubTab = "supervisors" | "operators" | "users" | "verification";
const STATUS_TONE = { active: "success", blocked: "danger", on_leave: "warning", deleted: "muted" } as const;

// A label / value row for the person drawers; a value of null/empty is not shown, so
// a section never renders an empty field.
function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="rounded-2xl glass p-3">{children}</div>
    </section>
  );
}

export function PeopleSection() {
  const [tab, setTab] = React.useState<SubTab>("supervisors");
  const tabs: { id: SubTab; label: string }[] = [
    { id: "supervisors", label: "Supervisors" },
    { id: "operators", label: "Operators" },
    { id: "users", label: "All users" },
    { id: "verification", label: "Verification" },
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
      {tab === "users" && <UsersTab />}
      {tab === "verification" && <VerificationTab />}
    </div>
  );
}

// --------------------------------------------------------------- verification

// Staff (supervisors and operators) awaiting an admin's approval before they can
// sign in and work. Mirrors the mobile admin verification queue (adminSetVerification).
const VERIFICATION_TONE = { pending: "warning", approved: "success", rejected: "danger" } as const;

function VerificationTab() {
  const [role, setRole] = React.useState("");
  const [status, setStatus] = React.useState("pending");
  const { data, loading, error, reload } = useAsync(
    () => adminApi.staff.pending({ role: role || undefined, status: status || undefined }),
    [role, status],
  );
  const [deciding, setDeciding] = React.useState<{ user: UserSummary; action: "approved" | "rejected" } | null>(null);

  const columns: Column<UserSummary>[] = [
    { header: "Name", cell: (r) => <span className="font-medium">{r.fullName ?? "—"}</span> },
    { header: "Phone", cell: (r) => r.phone },
    { header: "Role", cell: (r) => <span className="capitalize">{r.roles.join(", ")}</span> },
    { header: "Society", cell: (r) => r.societyName ?? r.societyLabel ?? "—" },
    { header: "Status", cell: (r) => <StatusBadge status={r.verificationStatus ?? "pending"} toneMap={VERIFICATION_TONE} /> },
    { header: "Actions", align: "right", cell: (r) => (r.verificationStatus ?? "pending") !== "pending" ? <span className="text-xs text-muted-foreground">—</span> : (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setDeciding({ user: r, action: "approved" })}
          className="rounded-full glass px-2.5 py-1 text-xs text-success hover:ring-1 hover:ring-success/40">Approve</button>
        <button onClick={() => setDeciding({ user: r, action: "rejected" })}
          className="rounded-full glass px-2.5 py-1 text-xs text-danger hover:ring-1 hover:ring-danger/40">Reject</button>
      </div>
    ) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">All staff</option>
          <option value="supervisor">Supervisors</option>
          <option value="operator">Operators</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </select>
      </div>
      <DataTable columns={columns} rows={data?.staff ?? []} keyField={(r) => r.id} loading={loading} error={error}
        emptyTitle="Nobody waiting" emptyDescription="No staff match this filter." />
      {deciding && (
        <VerifyModal user={deciding.user} action={deciding.action}
          onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); reload(); }} />
      )}
    </div>
  );
}

function VerifyModal({ user, action, onClose, onDone }: {
  user: UserSummary; action: "approved" | "rejected"; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = React.useState("");
  const approving = action === "approved";
  const decide = useAction(() => adminApi.staff.verify(user.id, { status: action, note: note.trim() || undefined }));

  return (
    <Modal open onClose={onClose} title={approving ? "Approve staff member" : "Reject staff member"}
      description={`${user.fullName ?? user.phone} · ${user.roles.join(", ")}`}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {approving ? "Approving lets this person sign in and begin work." : "Rejecting blocks this account from signing in."}
        </p>
        <FormField as="textarea" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={approving ? "Any note for the record" : "Reason for rejection"} />
        {decide.error && <p className="text-sm text-danger">{decide.error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl glass py-2.5 text-sm font-medium">Cancel</button>
          <button type="button" disabled={decide.busy}
            onClick={() => decide.run().then(() => { toast.push(approving ? "Approved" : "Rejected"); onDone(); }).catch(() => {})}
            className={cn("flex-1 rounded-xl py-2.5 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50", approving ? "bg-primary hover:brightness-110" : "bg-danger hover:brightness-110")}>
            {decide.busy ? "Working…" : approving ? "Approve" : "Reject"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------- supervisors

function SupervisorsTab() {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const { data, loading, error, reload } = useAsync(() => adminApi.supervisors.list({ q: q || undefined, status: status === "all" ? undefined : status }), [q, status]);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [viewing, setViewing] = React.useState<UserSummary | null>(null);
  const toast = useToast();

  const columns: Column<UserSummary>[] = [
    { header: "Name", cell: (r) => <span className="font-medium">{r.fullName ?? "—"}</span> },
    { header: "Phone", cell: (r) => r.phone },
    { header: "Society", cell: (r) => r.societyName ?? <span className="text-muted-foreground">Unassigned</span> },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} toneMap={STATUS_TONE} /> },
    { header: "Joined on", cell: (r) => r.createdAt ? formatDate(r.createdAt) : "—" },
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
            onRowClick={(r) => setViewing(r)}
            emptyTitle="No supervisors yet" emptyDescription="Create one to run a society." />
        </motion.div>
      </motion.div>

      <CreateSupervisorModal open={createOpen} onClose={() => setCreateOpen(false)} societies={data?.societies ?? []}
        onCreated={() => { setCreateOpen(false); reload(); toast.push("Supervisor created"); }} />
      {viewing && (
        <SupervisorDrawer supervisor={viewing} societies={data?.societies ?? []} onClose={() => setViewing(null)}
          onChanged={() => { reload(); }} />
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

function SupervisorDrawer({ supervisor, societies, onClose, onChanged }: {
  supervisor: UserSummary; societies: { id: string; name: string; supervisorUserId: string | null }[]; onClose: () => void; onChanged: () => void;
}) {
  const toast = useToast();
  const detail = useAsync(() => adminApi.supervisors.get(supervisor.id), [supervisor.id]);
  const [societyId, setSocietyId] = React.useState(supervisor.societyId ?? "");
  const [reason, setReason] = React.useState("");
  const reassignSociety = useAction(() => adminApi.supervisors.update(supervisor.id, { societyId }));
  const setAvailability = useAction((s: "active" | "on_leave" | "blocked") => adminApi.setAvailability(supervisor.id, { status: s, reason: reason || undefined }));
  const options = societies.filter((s) => !s.supervisorUserId || s.id === supervisor.societyId);
  const d = detail.data;

  return (
    <Modal open onClose={onClose} variant="drawer" title={supervisor.fullName ?? "Supervisor"} description={`Supervisor · ${stateLabel(supervisor.status)}`}>
      <div className="space-y-4">
        <DrawerSection title="Personal information">
          <Detail label="Name" value={supervisor.fullName} />
          <Detail label="Phone" value={supervisor.phone} />
          <Detail label="Email" value={supervisor.email} />
          <Detail label="Society" value={supervisor.societyName} />
          <Detail label="Joined on" value={supervisor.createdAt ? formatDate(supervisor.createdAt) : null} />
          <Detail label="Status" value={<StatusBadge status={supervisor.status} toneMap={STATUS_TONE} />} />
        </DrawerSection>

        {detail.loading ? (
          <div className="h-20 animate-pulse rounded-2xl glass" />
        ) : detail.error ? (
          <div className="rounded-2xl glass p-4 text-sm text-danger">Unable to load supervisor details. <button onClick={() => detail.reload()} className="underline">Retry</button></div>
        ) : d ? (
          <>
            {d.blocks.length > 0 && (
              <DrawerSection title="Assigned blocks">
                <p className="text-sm">{d.blocks.map((b) => b.name).join(", ")}</p>
              </DrawerSection>
            )}
            {d.operators.length > 0 && (
              <DrawerSection title={`Operators (${d.operators.length})`}>
                <div className="space-y-1">
                  {d.operators.map((o) => <p key={o.id} className="text-sm">{o.fullName ?? o.phone} <span className="text-xs text-muted-foreground">· {stateLabel(o.status)}</span></p>)}
                </div>
              </DrawerSection>
            )}
            <DrawerSection title={`Recent orders (${d.orders.length})`}>
              {d.orders.length === 0 ? <p className="text-sm text-muted-foreground">No orders yet.</p> : (
                <div className="space-y-1">
                  {d.orders.slice(0, 6).map((o) => (
                    <div key={o.id} className="flex justify-between text-sm">
                      <span>{o.orderCode ?? o.id.slice(0, 8)}</span>
                      <span className="text-muted-foreground">{stateLabel(o.state)}</span>
                    </div>
                  ))}
                </div>
              )}
            </DrawerSection>
          </>
        ) : null}

        <DrawerSection title="Reassign society">
          <div className="flex gap-2">
            <select value={societyId} onChange={(e) => setSocietyId(e.target.value)} className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
              {options.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button onClick={() => reassignSociety.run().then(() => { toast.push("Society reassigned"); onChanged(); }).catch(() => {})}
              disabled={reassignSociety.busy || societyId === supervisor.societyId}
              className="shrink-0 rounded-xl glass px-4 py-2 text-sm font-medium hover:ring-1 hover:ring-primary/40 disabled:opacity-50">Save</button>
          </div>
          {reassignSociety.error && <p className="mt-1 text-xs text-danger">{reassignSociety.error}</p>}
        </DrawerSection>

        <DrawerSection title="Availability">
          <FormField as="textarea" label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this changing?" />
          <div className="mt-2 flex flex-wrap gap-2">
            {(["active", "on_leave", "blocked"] as const).map((s) => (
              <button key={s} disabled={setAvailability.busy || supervisor.status === s}
                onClick={() => setAvailability.run(s).then(() => { toast.push(`Marked ${s.replace("_", " ")}`); onChanged(); onClose(); }).catch(() => {})}
                className="rounded-full glass px-4 py-2 text-xs font-medium capitalize hover:ring-1 hover:ring-primary/40 disabled:opacity-40">{s.replace("_", " ")}</button>
            ))}
          </div>
          {setAvailability.error && <p className="mt-1 text-xs text-danger">{setAvailability.error}</p>}
        </DrawerSection>
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
  const [viewing, setViewing] = React.useState<UserSummary | null>(null);
  const toast = useToast();

  const columns: Column<UserSummary>[] = [
    { header: "Name", cell: (r) => <span className="font-medium">{r.fullName ?? "—"}</span> },
    { header: "Phone", cell: (r) => r.phone },
    { header: "Society", cell: (r) => r.societyName ?? "—" },
    { header: "Supervisor", cell: (r) => r.supervisorName ?? "—" },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} toneMap={STATUS_TONE} /> },
    { header: "Joined on", cell: (r) => r.createdAt ? formatDate(r.createdAt) : "—" },
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
            onRowClick={(r) => setViewing(r)}
            emptyTitle="No operators yet" emptyDescription="Create one to process garments in a society." />
        </motion.div>
      </motion.div>

      <CreateOperatorModal open={createOpen} onClose={() => setCreateOpen(false)} societies={data?.societies ?? []} blocks={data?.blocks ?? []}
        onCreated={() => { setCreateOpen(false); reload(); toast.push("Operator created"); }} />
      {viewing && (
        <OperatorDrawer operator={viewing} societies={data?.societies ?? []} blocks={data?.blocks ?? []} onClose={() => setViewing(null)}
          onChanged={() => { reload(); }} />
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

function OperatorDrawer({ operator, societies, blocks, onClose, onChanged }: {
  operator: UserSummary; societies: { id: string; name: string }[]; blocks: { id: string; name: string; societyId: string }[];
  onClose: () => void; onChanged: () => void;
}) {
  const toast = useToast();
  const [societyId, setSocietyId] = React.useState(operator.societyId ?? "");
  const [blockIds, setBlockIds] = React.useState<string[]>(operator.blockIds ?? []);
  const [reason, setReason] = React.useState("");
  const saveAssignment = useAction(() => adminApi.operators.update(operator.id, { societyId, blockIds }));
  const setAvailability = useAction((s: "active" | "on_leave" | "blocked") => adminApi.setAvailability(operator.id, { status: s, reason: reason || undefined }));
  const societyBlocks = blocks.filter((b) => b.societyId === societyId);

  return (
    <Modal open onClose={onClose} variant="drawer" title={operator.fullName ?? "Operator"} description={`Operator · ${stateLabel(operator.status)}`}>
      <div className="space-y-4">
        <DrawerSection title="Personal information">
          <Detail label="Name" value={operator.fullName} />
          <Detail label="Phone" value={operator.phone} />
          <Detail label="Email" value={operator.email} />
          <Detail label="Joined on" value={operator.createdAt ? formatDate(operator.createdAt) : null} />
          <Detail label="Status" value={<StatusBadge status={operator.status} toneMap={STATUS_TONE} />} />
        </DrawerSection>

        <DrawerSection title="Assignment">
          <Detail label="Supervisor" value={operator.supervisorName} />
          <Detail label="Society" value={operator.societyName} />
          <Detail label="Blocks" value={operator.blockNames?.length ? operator.blockNames.join(", ") : "None"} />
        </DrawerSection>

        <DrawerSection title="Society & blocks">
          <select value={societyId} onChange={(e) => { setSocietyId(e.target.value); setBlockIds([]); }} className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
            {societies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div className="mt-2 flex flex-wrap gap-2">
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
            className="mt-2 rounded-xl glass px-4 py-2 text-sm font-medium hover:ring-1 hover:ring-primary/40 disabled:opacity-50">Save assignment</button>
          {saveAssignment.error && <p className="mt-1 text-xs text-danger">{saveAssignment.error}</p>}
        </DrawerSection>

        <DrawerSection title="Availability">
          <FormField as="textarea" label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Open orders can be handed to another operator automatically." />
          <div className="mt-2 flex flex-wrap gap-2">
            {(["active", "on_leave", "blocked"] as const).map((s) => (
              <button key={s} disabled={setAvailability.busy || operator.status === s}
                onClick={() => setAvailability.run(s).then((r) => { toast.push(r.reassigned ? `Marked ${s.replace("_", " ")} — open orders reassigned` : `Marked ${s.replace("_", " ")}`); onChanged(); onClose(); }).catch(() => {})}
                className="rounded-full glass px-4 py-2 text-xs font-medium capitalize hover:ring-1 hover:ring-primary/40 disabled:opacity-40">{s.replace("_", " ")}</button>
            ))}
          </div>
          {setAvailability.error && <p className="mt-1 text-xs text-danger">{setAvailability.error}</p>}
        </DrawerSection>
      </div>
    </Modal>
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
  const [viewing, setViewing] = React.useState<UserSummary | null>(null);

  const columns: Column<UserSummary>[] = [
    { header: "Name", cell: (r) => <span className="font-medium">{r.fullName ?? "—"}</span> },
    { header: "Phone", cell: (r) => r.phone },
    { header: "Role", cell: (r) => r.roles.join(", ") },
    { header: "Society", cell: (r) => r.societyLabel ?? "—" },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} toneMap={STATUS_TONE} /> },
    { header: "Joined on", cell: (r) => r.createdAt ? formatDate(r.createdAt) : "—" },
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
        onRowClick={(r) => setViewing(r)}
        emptyTitle="No users match" emptyDescription="Try a different search or filter." />
      {viewing && <UserDrawer user={viewing} onClose={() => setViewing(null)} onChanged={() => reload()} />}
    </div>
  );
}

function UserDrawer({ user, onClose, onChanged }: { user: UserSummary; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [tab, setTab] = React.useState<"overview" | "orders" | "subscriptions">("overview");
  const detail = useAsync(() => adminApi.users.get(user.id), [user.id]);
  const act = useAction((next: "active" | "blocked" | "deleted") => adminApi.users.setStatus(user.id, next));
  const d = detail.data;
  const isResident = user.roles.includes("resident");

  const setStatus = async (next: "active" | "blocked" | "deleted", label: string) => {
    if (next === "deleted") {
      const ok = await confirm({ title: "Deactivate this account?", description: "It can be reactivated later.", confirmLabel: "Deactivate", danger: true });
      if (!ok) return;
    }
    act.run(next).then(() => { toast.push(label); onChanged(); }).catch((e) => toast.push(e instanceof ApiError ? e.message : "Failed", "danger"));
  };

  return (
    <Modal open onClose={onClose} variant="drawer" title={user.fullName ?? user.phone} description={`${user.roles.join(", ")} · ${stateLabel(user.status)}`}>
      <div className="space-y-4">
        <div className="flex gap-1.5">
          {(["overview", ...(isResident ? (["orders", "subscriptions"] as const) : [])] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("rounded-full px-3 py-1.5 text-xs font-medium capitalize", tab === t ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground hover:text-foreground")}>{t}</button>
          ))}
        </div>

        {tab === "overview" && (
          <DrawerSection title="Personal information">
            <Detail label="Name" value={user.fullName} />
            <Detail label="Phone" value={user.phone} />
            <Detail label="Email" value={user.email} />
            <Detail label="Role" value={user.roles.join(", ")} />
            <Detail label="Society" value={user.societyLabel ?? user.societyName} />
            <Detail label="Unit" value={user.unitNumber} />
            <Detail label="Joined on" value={user.createdAt ? formatDate(user.createdAt) : null} />
            <Detail label="Status" value={<StatusBadge status={user.status} toneMap={STATUS_TONE} />} />
          </DrawerSection>
        )}

        {tab === "orders" && (
          <DrawerSection title="Orders">
            {detail.loading ? <div className="h-16 animate-pulse rounded-xl glass" />
              : detail.error ? <p className="text-sm text-danger">Unable to load orders. <button onClick={() => detail.reload()} className="underline">Retry</button></p>
              : (d?.orders.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">No orders yet.</p>
              : (
                <div className="space-y-1.5">
                  {d!.orders.slice(0, 20).map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium">{o.orderCode ?? o.id.slice(0, 8)}</span>
                      <span className="text-xs text-muted-foreground">{o.createdAt ? formatDate(o.createdAt) : ""}</span>
                      <StatusBadge status={o.state} />
                    </div>
                  ))}
                </div>
              )}
          </DrawerSection>
        )}

        {tab === "subscriptions" && (
          <div className="space-y-4">
            <DrawerSection title="Current subscription">
              {detail.loading ? <div className="h-16 animate-pulse rounded-xl glass" />
                : !d?.subscription ? <p className="text-sm text-muted-foreground">No active subscription.</p>
                : (
                  <>
                    <Detail label="Plan" value={d.subscription.planTier} />
                    <Detail label="Price" value={typeof d.subscription.monthlyPaise === "number" ? `${rupees(d.subscription.monthlyPaise)} / month` : null} />
                    <Detail label="Garments" value={typeof d.subscription.used === "number" ? `${d.subscription.used} of ${d.subscription.allowance} used` : null} />
                    <Detail label="Renews" value={d.subscription.renewalDate ? formatDate(d.subscription.renewalDate) : null} />
                    <Detail label="Status" value={d.subscription.status ? stateLabel(d.subscription.status) : null} />
                  </>
                )}
            </DrawerSection>
            {(d?.previousSubscriptions.length ?? 0) > 0 && (
              <DrawerSection title="Past subscriptions">
                {d!.previousSubscriptions.map((s) => (
                  <div key={s.id} className="flex justify-between text-sm">
                    <span>{stateLabel(s.status)}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(s.cycleStart)} – {formatDate(s.cycleEnd)}</span>
                  </div>
                ))}
              </DrawerSection>
            )}
          </div>
        )}

        <DrawerSection title="Account">
          <div className="flex flex-wrap gap-2">
            {user.status !== "active" && <button onClick={() => setStatus("active", "Activated")} className="rounded-full glass px-3 py-1.5 text-xs hover:ring-1 hover:ring-success/40">Activate</button>}
            {user.status !== "blocked" && <button onClick={() => setStatus("blocked", "Blocked")} className="rounded-full glass px-3 py-1.5 text-xs hover:ring-1 hover:ring-warning/40">Block</button>}
            {user.status !== "deleted" && <button onClick={() => setStatus("deleted", "Deactivated")} className="rounded-full glass px-3 py-1.5 text-xs text-danger hover:ring-1 hover:ring-danger/40">Deactivate</button>}
          </div>
        </DrawerSection>
      </div>
    </Modal>
  );
}
