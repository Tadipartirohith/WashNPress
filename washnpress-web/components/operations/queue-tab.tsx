"use client";

import { Users2, Loader2 } from "lucide-react";
import { DataTable, type Column } from "@/components/portal/data-table";
import { StatusBadge } from "@/components/portal/status-badge";
import { Button } from "@/components/ui/button";
import { useAsync, useAction } from "@/lib/use-async";
import { useToast } from "@/components/portal/toast";
import { operationsApi, type OrderSummary } from "@/lib/api/operations";

// Continuity, not punishment: work a colleague left behind — because they went on
// leave, or nobody had picked it up yet — sitting here plainly as unclaimed work
// anyone covering this area can take.
export function QueueTab({ onActivity }: { onActivity: () => void }) {
  const queue = useAsync(() => operationsApi.queue(), []);
  const claim = useAction(operationsApi.claim);
  const toast = useToast();

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
    { header: "Stage", cell: (o) => <StatusBadge status={o.state} /> },
    { header: "Items", cell: (o) => <span className="tabular-nums">{o.acceptedCount ?? "—"}</span>, align: "right" },
    {
      header: "",
      align: "right",
      cell: (o) => (
        <Button
          size="sm"
          disabled={claim.busy}
          onClick={() => claim.run(o.id).then(() => { queue.reload(); onActivity(); toast.push(`${o.orderCode} is now yours`); }).catch(() => {})}
        >
          {claim.busy ? <Loader2 className="size-4 animate-spin" /> : "Claim"}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl glass p-4 text-sm text-muted-foreground">
        <Users2 className="mt-0.5 size-5 shrink-0 text-primary" />
        <p>Unclaimed work available in your societies — released when a colleague went on leave, or simply not yet taken. Claim anything you can help with; it picks up exactly where it was left.</p>
      </div>
      {claim.error && <p className="text-sm text-danger">{claim.error}</p>}
      <DataTable
        columns={columns}
        rows={queue.data?.orders ?? []}
        keyField={(o) => o.id}
        loading={queue.loading}
        error={queue.error}
        emptyTitle="No unclaimed work right now"
        emptyDescription="Everything in your societies has an operator on it."
      />
    </div>
  );
}
