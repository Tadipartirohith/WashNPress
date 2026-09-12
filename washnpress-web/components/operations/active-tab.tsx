"use client";

import { useMemo, useState } from "react";
import { Loader2, Clock } from "lucide-react";
import { StatusBadge } from "@/components/portal/status-badge";
import { Button } from "@/components/ui/button";
import { useAsync } from "@/lib/use-async";
import { operationsApi, type OrderSummary, type ActiveGroups } from "@/lib/api/operations";
import { formatUnit } from "@/lib/unit";
import { BatchDrawer } from "./batch-drawer";
import type { ActiveGroup } from "./dashboard-tab";

type GroupKey = "pickedUp" | "washing" | "ironing" | "qc" | "qcFailed" | "readyForDelivery" | "outForDelivery";

// Only collected orders live here, grouped by the stage they're actually at. "Ready
// to iron" folds into Washing/Ironing rather than standing as its own status.
const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "pickedUp", label: "Picked Up" },
  { key: "washing", label: "Washing" },
  { key: "ironing", label: "Ironing" },
  { key: "qc", label: "QC" },
  { key: "qcFailed", label: "QC Failed" },
  { key: "readyForDelivery", label: "Ready" },
  { key: "outForDelivery", label: "Out for Delivery" },
];
const TONE: Record<string, "danger" | "success" | "primary" | "warning"> = {
  qcFailed: "danger", readyForDelivery: "success", outForDelivery: "primary",
};
const delayLabel = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

// `group` is the stage a dashboard tile asked for (I-105) — read once as the initial
// stage filter, so the operator can still switch to any other stage from here.
export function ActiveTab({ onActivity, group }: { onActivity: () => void; group?: ActiveGroup }) {
  const active = useAsync(() => operationsApi.active(), []);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [tab, setTab] = useState<GroupKey | "all">(group ?? "all");

  // Fold the transitional "ready to iron" bucket into Ironing so a stage the operator
  // does not act on separately is not shown as its own group.
  const grouped = useMemo<Record<GroupKey, OrderSummary[]>>(() => {
    const d = active.data;
    const empty = { pickedUp: [], washing: [], ironing: [], qc: [], qcFailed: [], readyForDelivery: [], outForDelivery: [] } as Record<GroupKey, OrderSummary[]>;
    if (!d) return empty;
    return {
      pickedUp: d.pickedUp, washing: d.washing,
      ironing: [...(d.ironingPending ?? []), ...d.ironing],
      qc: d.qc, qcFailed: d.qcFailed, readyForDelivery: d.readyForDelivery, outForDelivery: d.outForDelivery,
    };
  }, [active.data]);

  const counts = GROUPS.reduce((acc, g) => { acc[g.key] = grouped[g.key].length; return acc; }, {} as Record<GroupKey, number>);
  const total = GROUPS.reduce((n, g) => n + counts[g.key], 0);
  const shown: (OrderSummary & { group: GroupKey })[] = (tab === "all" ? GROUPS.map((g) => g.key) : [tab])
    .flatMap((k) => grouped[k].map((o) => ({ ...o, group: k })));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-bold">Active Orders</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Collected orders in processing, by stage.</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {/* Which stage is showing is said out loud rather than only in colour, so a
            screen reader — and a test checking that a dashboard tile arrived on the
            right stage (I-105) — can tell without reading a class name. */}
        <button onClick={() => setTab("all")} aria-pressed={tab === "all"} className={`rounded-full px-3 py-1.5 text-xs font-medium ${tab === "all" ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground hover:text-foreground"}`}>
          All <span className="opacity-70">{total}</span>
        </button>
        {GROUPS.map((g) => (
          <button key={g.key} onClick={() => setTab(g.key)} aria-pressed={tab === g.key} className={`rounded-full px-3 py-1.5 text-xs font-medium ${tab === g.key ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground hover:text-foreground"}`}>
            {g.label} <span className="opacity-70">{counts[g.key]}</span>
          </button>
        ))}
      </div>

      {active.loading ? (
        <div className="grid place-items-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : active.error ? (
        <div className="rounded-2xl glass p-6 text-sm text-danger">{active.error}</div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl glass p-8 text-center text-sm text-muted-foreground">
          {total === 0 ? "Nothing in processing right now. Orders appear here from pickup until delivery." : "Nothing in this stage."}
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((r) => (
            <div key={r.id} className="flex flex-col gap-2 rounded-2xl glass p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{r.orderCode}</p>
                  <p className="truncate text-xs text-muted-foreground">{[r.residentName, formatUnit(r.blockName, r.unitNumber), r.societyName].filter(Boolean).join(" · ")}</p>
                </div>
                <StatusBadge status={r.group} label={GROUPS.find((g) => g.key === r.group)?.label ?? r.group} toneMap={TONE} />
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {r.acceptedCount != null && <span>{r.acceptedCount} garments</span>}
                {r.batchCount ? <span>· {r.batchesCompleted ?? 0}/{r.batchCount} batches</span> : null}
                {r.delayed && <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 font-medium text-danger"><Clock className="size-3" /> {delayLabel(r.delayMinutes)} late</span>}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{r.operatorName ?? "Unassigned"}</span>
                <Button size="sm" onClick={() => setOpenOrderId(r.id)}>Open</Button>
              </div>
            </div>
          ))}
        </div>
      )}

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
