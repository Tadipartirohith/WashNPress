"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { DataTable, type Column } from "@/components/portal/data-table";
import { StatusBadge } from "@/components/portal/status-badge";
import { Button } from "@/components/ui/button";
import { useAsync } from "@/lib/use-async";
import { useToast } from "@/components/portal/toast";
import { operationsApi, type PickupQueueItem } from "@/lib/api/operations";
import { ReconcileModal } from "./reconcile-modal";
import { PickupFailedModal } from "./pickup-failed-modal";

// The pending-pickup queue, oldest first — the backend already sorts due items to
// the top and marks anything overdue, so the screen only has to show what it's told.
export function PickupsTab({ onActivity }: { onActivity: () => void }) {
  const pickups = useAsync(() => operationsApi.pickups(), []);
  const [reconciling, setReconciling] = useState<PickupQueueItem | null>(null);
  const [failing, setFailing] = useState<PickupQueueItem | null>(null);
  const toast = useToast();

  const rows = pickups.data?.pickups ?? [];

  const columns: Column<PickupQueueItem>[] = [
    {
      header: "Resident",
      cell: (p) => (
        <div>
          <p className="font-medium">{p.residentName ?? "Resident"}</p>
          <p className="text-xs text-muted-foreground">{p.unitNumber ?? "—"} · {p.societyName ?? ""}</p>
        </div>
      ),
    },
    {
      header: "Slot",
      cell: (p) => (
        <div className="text-sm">
          <p>{p.slot ?? "—"}</p>
          <p className="text-xs text-muted-foreground">{p.pickupDate}</p>
        </div>
      ),
    },
    {
      header: "Status",
      cell: (p) => (
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge status={p.pickupStatus} label={p.pickupStatusLabel} toneMap={{ due: "danger", scheduled: "muted", completed: "success", failed: "danger" }} />
          {p.overdue && <StatusBadge status="overdue" label="Overdue" toneMap={{ overdue: "danger" }} />}
        </div>
      ),
    },
    { header: "Est. items", cell: (p) => <span className="tabular-nums">{p.estimatedCount ?? "—"}</span>, align: "right" },
    {
      header: "",
      align: "right",
      cell: (p) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setFailing(p)} disabled={!p.orderId}>Failed</Button>
          <Button size="sm" onClick={() => setReconciling(p)} disabled={!p.orderId}>Reconcile</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {!!pickups.data?.overdueCount && (
        <div className="flex items-center gap-2 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger ring-1 ring-danger/30">
          <AlertTriangle className="size-4 shrink-0" />
          {pickups.data.overdueCount} pickup{pickups.data.overdueCount === 1 ? "" : "s"} overdue — collect these first.
        </div>
      )}
      <DataTable
        columns={columns}
        rows={rows}
        keyField={(p) => p.pickupId}
        loading={pickups.loading}
        error={pickups.error}
        emptyTitle="No pickups pending"
        emptyDescription="Every scheduled collection has been made."
      />
      {reconciling && (
        <ReconcileModal
          pickup={reconciling}
          onClose={() => setReconciling(null)}
          onDone={() => { setReconciling(null); pickups.reload(); onActivity(); toast.push("Pickup confirmed"); }}
        />
      )}
      {failing && (
        <PickupFailedModal
          pickup={failing}
          onClose={() => setFailing(null)}
          onDone={() => { setFailing(null); pickups.reload(); onActivity(); toast.push("Pickup failure recorded", "danger"); }}
        />
      )}
    </div>
  );
}
