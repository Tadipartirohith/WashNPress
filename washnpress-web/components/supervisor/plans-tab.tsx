"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { Modal } from "@/components/portal/modal";
import { DataTable, type Column } from "@/components/portal/data-table";
import { StatusBadge } from "@/components/portal/status-badge";
import { useAsync } from "@/lib/use-async";
import { formatDate, rupees, stateLabel } from "@/lib/format";
import { supervisorApi, type ResidentSubscriptionRow } from "@/lib/api/supervisor";

// Who in this society is on which plan.
//
// This tab used to be the plan catalogue — Basic, Standard, Premium as cards, with a
// New plan button and an Edit pencil, sharing the admin's wizard. Plans are priced,
// sold and retired by the business rather than by the person running one society, so
// none of that belonged here; the backend routes behind it are gone too, because
// hiding a button leaves the capability sitting behind a token.
//
// What a supervisor is actually asked is the other direction: this resident says
// they are on Premium, are they? So the tab is that list, and it is read only.

type SubscriptionRow = ResidentSubscriptionRow & { serial: number };

const STATUS_TONE = {
  active: "success", paused: "warning", cancelled: "muted", expired: "muted",
} as const;

export function PlansTab() {
  const subs = useAsync(() => supervisorApi.subscriptions(), []);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [viewing, setViewing] = useState<ResidentSubscriptionRow | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // The serial is a property of the filtered list, not of the subscription, so it
    // is numbered after filtering — otherwise a search leaves gaps in the column.
    return (subs.data?.subscriptions ?? []).filter((s) => {
      if (status !== "all" && s.status !== status) return false;
      if (!needle) return true;
      // Searched by the things a supervisor is given over the phone: a name, a flat,
      // or the plan somebody claims to be on.
      return [s.residentName, s.unitNumber, s.towerBlock, s.planName, s.planTier, s.residentPhone]
        .some((field) => (field ?? "").toLowerCase().includes(needle));
    }).map((s, i) => ({ ...s, serial: i + 1 }));
  }, [subs.data, q, status]);

  const columns: Column<SubscriptionRow>[] = [
    // Numbered, because the table is read aloud and pointed at rather than sorted.
    { header: "S.No", cell: (s) => <span className="tabular-nums text-muted-foreground">{s.serial}</span> },
    { header: "Resident", cell: (s) => <span className="font-medium">{s.residentName ?? "—"}</span> },
    {
      header: "Flat / Unit",
      cell: (s) => [s.towerBlock, s.unitNumber].filter(Boolean).join(" · ") || "—",
    },
    { header: "Society", cell: (s) => s.societyName ?? "—" },
    { header: "Plan", cell: (s) => <span className="font-medium">{s.planName ?? s.planTier ?? "—"}</span> },
    { header: "Start Date", cell: (s) => formatDate(s.startDate) },
    { header: "End Date", cell: (s) => formatDate(s.endDate) },
    {
      header: "Status",
      cell: (s) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={s.status} toneMap={STATUS_TONE} />
          {/* A change already asked for. Without it a supervisor reads today's plan
              and answers a question about next month wrongly. */}
          {s.pendingPlanName && <StatusBadge status="scheduled" toneMap={{ scheduled: "accent" }} label={`→ ${s.pendingPlanName}`} />}
        </div>
      ),
    },
    {
      header: "",
      cell: (s) => (
        <button onClick={() => setViewing(s)}
          className="rounded-full glass px-3 py-1.5 text-xs font-medium hover:ring-1 hover:ring-primary/40">
          View
        </button>
      ),
      align: "right",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2 text-sm text-muted-foreground sm:max-w-xs">
          <Search className="size-4 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Resident, flat or plan"
            aria-label="Search subscriptions"
            className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Subscription status"
          className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="cancelled">Cancelled</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      <Panel loading={subs.loading} error={subs.error} onRetry={subs.reload}>
        <DataTable
          columns={columns}
          rows={rows}
          keyField={(s) => s.id}
          emptyTitle="No subscribed residents"
          emptyDescription="Residents appear here once they take a plan."
        />
      </Panel>

      {viewing && <SubscriptionDrawer row={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

// The whole subscription, in words, with nothing to press.
//
// Read-only is the point of the drawer rather than an omission from it: a supervisor
// is answering a resident's question, not settling it.
function SubscriptionDrawer({ row, onClose }: { row: ResidentSubscriptionRow; onClose: () => void }) {
  const remaining = row.garmentCap === null ? null : Math.max(0, row.garmentCap - row.garmentsUsed);

  return (
    <Modal open onClose={onClose} variant="drawer"
      title={row.residentName ?? "Resident"}
      description={[row.towerBlock, row.unitNumber].filter(Boolean).join(" · ") || undefined}>
      <div className="space-y-5">
        <section className="rounded-2xl glass p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Subscribed plan</p>
              <p className="truncate text-lg font-semibold">{row.planName ?? row.planTier ?? "—"}</p>
            </div>
            <StatusBadge status={row.status} toneMap={STATUS_TONE} />
          </div>
          {row.monthlyPaise !== null && (
            <p className="mt-1 text-sm text-muted-foreground">{rupees(row.monthlyPaise)} / month</p>
          )}
        </section>

        <DrawerSection title="Subscription">
          <Detail label="Society" value={row.societyName} />
          <Detail label="Billing cycle" value={stateLabel(row.cycle)} />
          <Detail label="Start date" value={formatDate(row.startDate)} />
          <Detail label="End date" value={formatDate(row.endDate)} />
          <Detail label="Auto renew" value={row.autoRenew ? "On" : "Off"} />
          {row.pendingPlanName && <Detail label="Scheduled change" value={row.pendingPlanName} />}
        </DrawerSection>

        <DrawerSection title="Allowance">
          {/* Counted, not drawn. A bar here says how full the month is and nothing
              about the number the resident is actually asking for. */}
          <Detail label="Included" value={row.garmentCap === null ? "—" : `${row.garmentCap} garments`} />
          <Detail label="Used" value={`${row.garmentsUsed} garments`} />
          <Detail label="Remaining" value={remaining === null ? "—" : `${remaining} garments`} />
          <Detail label="Turnaround" value={row.turnaroundHours === null ? "—" : `${row.turnaroundHours} hours`} />
        </DrawerSection>

        <DrawerSection title="Contact">
          <Detail label="Phone" value={row.residentPhone} />
        </DrawerSection>

        <p className="text-xs text-muted-foreground">
          Plans are managed by the Wash N Press admin team. Contact them to change a resident&apos;s subscription.
        </p>
      </div>
    </Modal>
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

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
