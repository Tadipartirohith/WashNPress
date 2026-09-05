"use client";

import { useMemo, useState } from "react";
import { DataTable, type Column } from "@/components/portal/data-table";
import { StatusBadge } from "@/components/portal/status-badge";
import { Button } from "@/components/ui/button";
import { useAsync } from "@/lib/use-async";
import { operationsApi, type OrderSummary, type ActiveGroups } from "@/lib/api/operations";
import { BatchDrawer } from "./batch-drawer";

type Row = OrderSummary & { group: keyof Omit<ActiveGroups, "stateLabels">; groupLabel: string };

const GROUP_LABELS: Record<keyof Omit<ActiveGroups, "stateLabels">, string> = {
  qcFailed: "QC Failed",
  pickedUp: "Picked Up",
  washing: "Washing",
  ironingPending: "Ready to Iron",
  ironing: "Ironing",
  qc: "Quality Check",
  readyForDelivery: "Ready for Delivery",
  outForDelivery: "Out for Delivery",
};

// The most urgent group sorts first: a QC hold needs a person, everything else is
// just in flight.
const GROUP_ORDER: (keyof Omit<ActiveGroups, "stateLabels">)[] = [
  "qcFailed", "pickedUp", "washing", "ironingPending", "ironing", "qc", "readyForDelivery", "outForDelivery",
];

export function ActiveTab({ onActivity }: { onActivity: () => void }) {
  const active = useAsync(() => operationsApi.active(), []);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const rows = useMemo<Row[]>(() => {
    if (!active.data) return [];
    const out: Row[] = [];
    for (const group of GROUP_ORDER) {
      for (const order of active.data[group] as OrderSummary[]) {
        out.push({ ...order, group, groupLabel: GROUP_LABELS[group] });
      }
    }
    return out;
  }, [active.data]);

  const columns: Column<Row>[] = [
    {
      header: "Order",
      cell: (r) => (
        <div>
          <p className="font-medium">{r.orderCode}</p>
          <p className="text-xs text-muted-foreground">{r.residentName ?? "Resident"} · {r.unitNumber ?? ""}</p>
        </div>
      ),
    },
    { header: "Society", cell: (r) => <span className="text-sm">{r.societyName ?? "—"}</span> },
    {
      header: "Stage",
      cell: (r) => <StatusBadge status={r.group} label={r.groupLabel} toneMap={{ qcFailed: "danger", readyForDelivery: "success", outForDelivery: "primary" }} />,
    },
    {
      header: "Batches",
      cell: (r) => (r.batchCount ? <span className="tabular-nums">{r.batchesCompleted ?? 0}/{r.batchCount}</span> : <span className="text-muted-foreground">—</span>),
      align: "right",
    },
    { header: "Operator", cell: (r) => <span className="text-sm">{r.operatorName ?? "Unassigned"}</span> },
    { header: "", align: "right", cell: (r) => <Button size="sm" onClick={() => setOpenOrderId(r.id)}>Open</Button> },
  ];

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        rows={rows}
        keyField={(r) => r.id}
        loading={active.loading}
        error={active.error}
        emptyTitle="Nothing in processing right now"
        emptyDescription="Orders show up here from the moment they're picked up until they're delivered."
      />
      {openOrderId && (
        <BatchDrawer
          orderId={openOrderId}
          onClose={() => setOpenOrderId(null)}
          onChanged={() => { active.reload(); onActivity(); }}
        />
      )}
    </div>
  );
}
