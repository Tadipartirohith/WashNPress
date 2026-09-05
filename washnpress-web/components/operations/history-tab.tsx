"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/portal/data-table";
import { StatusBadge } from "@/components/portal/status-badge";
import { Button } from "@/components/ui/button";
import { useAsync } from "@/lib/use-async";
import { formatDate, rupees } from "@/lib/format";
import { operationsApi, type OrderSummary } from "@/lib/api/operations";
import { BatchDrawer } from "./batch-drawer";

const STATES = [
  { key: "", label: "All" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
  { key: "pickup_failed", label: "Pickup Failed" },
  { key: "disputed", label: "Disputed" },
];

// Completed and closed-out orders this operator handled — delivered, cancelled,
// a failed pickup, or anything that ended up disputed.
export function HistoryTab() {
  const [state, setState] = useState("");
  const history = useAsync(() => operationsApi.history(state ? { state } : {}), [state]);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const columns: Column<OrderSummary>[] = [
    {
      header: "Order",
      cell: (o) => (
        <div>
          <p className="font-medium">{o.orderCode}</p>
          <p className="text-xs text-muted-foreground">{o.residentName ?? "Resident"} · {o.unitNumber ?? ""}</p>
        </div>
      ),
    },
    { header: "Society", cell: (o) => <span className="text-sm">{o.societyName ?? "—"}</span> },
    { header: "Outcome", cell: (o) => <StatusBadge status={o.state} /> },
    { header: "Delivered", cell: (o) => <span className="text-sm">{o.deliveredAt ? formatDate(o.deliveredAt) : "—"}</span> },
    { header: "Charge", cell: (o) => <span className="tabular-nums">{rupees(o.additionalChargePaise ?? 0)}</span>, align: "right" },
    { header: "", align: "right", cell: (o) => <Button size="sm" variant="outline" onClick={() => setOpenOrderId(o.id)}>View</Button> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {STATES.map((s) => (
          <button
            key={s.key}
            onClick={() => setState(s.key)}
            className={`rounded-full px-3.5 py-2 text-xs font-medium transition-colors ${state === s.key ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground hover:text-foreground"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <DataTable
        columns={columns}
        rows={history.data?.orders ?? []}
        keyField={(o) => o.id}
        loading={history.loading}
        error={history.error}
        emptyTitle="No history yet"
        emptyDescription="Delivered, cancelled and disputed orders will show up here."
      />
      {openOrderId && <BatchDrawer orderId={openOrderId} onClose={() => setOpenOrderId(null)} onChanged={() => {}} />}
    </div>
  );
}
