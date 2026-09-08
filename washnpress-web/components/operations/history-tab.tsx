"use client";

import { useState } from "react";
import { Loader2, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Modal } from "@/components/portal/modal";
import { StatusBadge } from "@/components/portal/status-badge";
import { DatePicker } from "@/components/portal/date-picker";
import { Button } from "@/components/ui/button";
import { useAsync } from "@/lib/use-async";
import { formatDate } from "@/lib/format";
import { operationsApi, type HistoryRecord } from "@/lib/api/operations";
import { BatchDrawer } from "./batch-drawer";

const PAGE = 20;

const TYPES = [
  { key: "", label: "All Types" },
  { key: "laundry", label: "Laundry" },
  { key: "service", label: "Additional Services" },
];
const DATE_BUCKETS = [
  { key: "all", label: "All time" }, { key: "today", label: "Today" }, { key: "yesterday", label: "Yesterday" },
  { key: "7", label: "Last 7 days" }, { key: "30", label: "Last 30 days" }, { key: "custom", label: "Custom" },
];
// The status options depend on the chosen type.
function statusOptions(type: string): { key: string; label: string }[] {
  if (type === "laundry") return [{ key: "", label: "All" }, { key: "delivered", label: "Delivered" }, { key: "cancelled", label: "Cancelled" }];
  if (type === "service") return [{ key: "", label: "All" }, { key: "completed", label: "Completed" }, { key: "cancelled", label: "Cancelled" }];
  return [{ key: "", label: "All" }, { key: "delivered", label: "Delivered" }, { key: "completed", label: "Completed" }, { key: "cancelled", label: "Cancelled" }];
}
const statusTone: Record<string, "success" | "muted"> = { delivered: "success", completed: "success", cancelled: "muted" };

// Read-only history of completed and cancelled laundry orders and additional-service
// bookings. No operational actions — just View Details.
export function HistoryTab() {
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [dateBucket, setDateBucket] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<HistoryRecord | null>(null);

  const data = useAsync(() => operationsApi.historyAll({
    type: type || undefined, status: status || undefined, dateBucket, q: q || undefined,
    from: dateBucket === "custom" ? (from || undefined) : undefined, to: dateBucket === "custom" ? (to || undefined) : undefined,
    limit: PAGE, offset,
  }), [type, status, dateBucket, from, to, q, offset]);

  const records = data.data?.records ?? [];
  const total = data.data?.page.total ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-bold">History</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Completed and cancelled orders and service bookings.</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <span className="flex items-center gap-2 rounded-xl border border-border bg-background/60 px-3 text-sm lg:col-span-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder="Search ID, resident or phone" className="w-full bg-transparent py-2 outline-none" />
        </span>
        <select value={type} onChange={(e) => { setType(e.target.value); setStatus(""); setOffset(0); }} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          {statusOptions(type).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={dateBucket} onChange={(e) => { setDateBucket(e.target.value); setOffset(0); }} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          {DATE_BUCKETS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        {dateBucket === "custom" && (
          <>
            <DatePicker value={from || null} placeholder="From" ariaLabel="From date" onChange={(v) => { setFrom(v ?? ""); setOffset(0); }} />
            <DatePicker value={to || null} placeholder="To" ariaLabel="To date" onChange={(v) => { setTo(v ?? ""); setOffset(0); }} />
          </>
        )}
      </div>

      {data.loading ? (
        <div className="grid place-items-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : data.error ? (
        <div className="rounded-2xl glass p-6 text-sm text-danger">{data.error}</div>
      ) : records.length === 0 ? (
        <div className="rounded-2xl glass p-8 text-center text-sm text-muted-foreground">
          {q || type || status || dateBucket !== "all" ? "No records match your filters." : "No history yet. Delivered and cancelled records show up here."}
        </div>
      ) : (
        <div className="space-y-2.5">
          {records.map((r) => (
            <div key={`${r.type}-${r.id}`} className="flex flex-wrap items-center gap-3 rounded-2xl glass p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground">{r.code}</span>
                  <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{r.type === "laundry" ? "Laundry" : "Additional Service"}</span>
                </div>
                <p className="mt-0.5 text-sm font-medium">{r.detail}</p>
                <p className="text-xs text-muted-foreground">{[r.residentName, r.unitNumber, r.societyName].filter(Boolean).join(" · ")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(r.date)}{r.operatorName ? ` · ${r.operatorName}` : ""}{r.priceLabel ? ` · ${r.priceLabel}` : ""}</p>
              </div>
              <StatusBadge status={r.status} label={r.statusLabel} toneMap={statusTone} />
              <Button size="sm" variant="outline" onClick={() => setDetail(r)}>View Details</Button>
            </div>
          ))}
        </div>
      )}

      {total > PAGE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
          <div className="flex gap-2">
            <button onClick={() => setOffset((o) => Math.max(0, o - PAGE))} disabled={offset === 0} className="grid size-8 place-items-center rounded-lg glass disabled:opacity-40"><ChevronLeft className="size-4" /></button>
            <button onClick={() => setOffset((o) => o + PAGE)} disabled={!data.data?.page.hasMore} className="grid size-8 place-items-center rounded-lg glass disabled:opacity-40"><ChevronRight className="size-4" /></button>
          </div>
        </div>
      )}

      {/* Laundry → the batch/order drawer; service → a read-only detail modal. */}
      {detail?.type === "laundry" && <BatchDrawer orderId={detail.id} onClose={() => setDetail(null)} onChanged={() => {}} />}
      {detail?.type === "service" && (
        <Modal open onClose={() => setDetail(null)} variant="drawer" title={detail.detail} description={detail.code}>
          <div className="space-y-2 rounded-2xl glass p-4 text-sm">
            {[
              ["Type", "Additional Service"], ["Status", detail.statusLabel],
              ["Resident", detail.residentName], ["Unit / Society", [detail.unitNumber, detail.societyName].filter(Boolean).join(" · ")],
              ["Date", `${formatDate(detail.date)}${detail.slotWindow ? ` · ${detail.slotWindow}` : ""}`],
              ["Operator", detail.operatorName], ["Price", detail.priceLabel],
              ...(detail.status === "cancelled" ? [["Cancelled reason", detail.cancelledReason]] : []),
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 py-1"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value || "—"}</span></div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
