"use client";

import * as React from "react";
import { Search, RefreshCw } from "lucide-react";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { DatePicker } from "@/components/portal/date-picker";
import { StatusBadge } from "@/components/portal/status-badge";
import { useAsync } from "@/lib/use-async";
import { adminApi, type LedgerTransaction } from "@/lib/api/admin";
import { rupees, formatDateTime } from "@/lib/format";
import { formatUnit } from "@/lib/unit";
import { Pager } from "./pager";

const PAGE_SIZE = 25;
const STATUS_TONE = { successful: "success", pending: "warning", failed: "danger", refunded: "muted", cancelled: "muted" } as const;
const selectClass = "w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

// I-132: Payments → Transaction Ledger, over GET /v1/admin/revenue/transactions.
//
// Every word about a transaction's state is the API's own: the status badge uses the
// label the API sent for that status, and a settlement reference is shown only when
// the API returned one. Nothing is called settled because it looks paid.
export function PaymentsSection() {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [method, setMethod] = React.useState("");
  const [from, setFrom] = React.useState<string | null>(null);
  const [to, setTo] = React.useState<string | null>(null);
  const [offset, setOffset] = React.useState(0);
  const [openRow, setOpenRow] = React.useState<LedgerTransaction | null>(null);
  const rangeError = from && to && from > to ? "The from date must be on or before the to date." : "";

  const { data, loading, error, reload } = useAsync(
    () => rangeError
      ? Promise.reject(new Error(rangeError))
      : adminApi.revenue.transactions({
        q: q.trim() || undefined, status: status || undefined, method: method || undefined,
        from: from || undefined, to: to || undefined, limit: String(PAGE_SIZE), offset: String(offset),
      }),
    [q, status, method, from, to, offset],
  );

  const statusLabel = (key: string) => data?.statuses.find((s) => s.key === key)?.label ?? key;
  const typeLabel = (key: string) => data?.types.find((t) => t.key === key)?.label ?? key;
  const methodLabel = (key: string | null) => (key ? data?.methods?.find((m) => m.key === key)?.label ?? key : "Not recorded");
  const where = (r: LedgerTransaction) => [r.societyName, formatUnit(r.blockName, r.unitNumber)].filter(Boolean).join(" · ");
  const orderRef = (r: LedgerTransaction) => (r.orderId ? r.orderCode ?? r.orderId : "—");
  // Any change to what is being looked for starts again at the first page.
  const refilter = (apply: () => void) => { apply(); setOffset(0); };
  const reset = () => refilter(() => { setQ(""); setStatus(""); setMethod(""); setFrom(null); setTo(null); });

  const columns: Column<LedgerTransaction>[] = [
    { header: "Transaction ID", cell: (r) => <span className="font-mono text-xs" title={r.id}>{r.id.length > 22 ? `${r.id.slice(0, 22)}…` : r.id}</span> },
    { header: "Date & time", cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.at)}</span> },
    { header: "Resident", cell: (r) => <div><p>{r.customerName ?? "—"}</p>{where(r) && <p className="text-xs text-muted-foreground">{where(r)}</p>}</div> },
    { header: "Order ID", cell: (r) => orderRef(r) },
    { header: "Method", cell: (r) => methodLabel(r.paymentMethod) },
    { header: "Amount", align: "right", cell: (r) => <span className="tabular-nums">{rupees(r.amountPaise)}</span> },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} label={statusLabel(r.status)} toneMap={STATUS_TONE} /> },
    { header: "Settlement / reference", cell: (r) => <span className="font-mono text-xs">{r.referenceId ?? "—"}</span> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">Transaction Ledger</h2>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">Every payment, charge and refund, with its status and settlement reference as recorded.</p>
        </div>
        <button onClick={() => reload()} className="inline-flex items-center gap-1.5 rounded-full glass px-3.5 py-2 text-sm hover:ring-1 hover:ring-primary/40"><RefreshCw className="size-4" /> Refresh</button>
      </div>

      <div className="space-y-3 rounded-2xl glass p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Search</span>
            <span className="flex items-center gap-2 rounded-xl border border-border bg-background/60 px-3 py-2 text-sm">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input value={q} onChange={(e) => { const v = e.target.value; refilter(() => setQ(v)); }} placeholder="Transaction ID, order ID or reference" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
            </span></label>
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Status</span>
            <select value={status} onChange={(e) => { const v = e.target.value; refilter(() => setStatus(v)); }} className={selectClass}>
              <option value="">All statuses</option>
              {(data?.statuses ?? []).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select></label>
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Payment method</span>
            <select value={method} onChange={(e) => { const v = e.target.value; refilter(() => setMethod(v)); }} className={selectClass}>
              <option value="">All methods</option>
              {(data?.methods ?? []).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Date from</span>
            <DatePicker value={from} onChange={(v) => refilter(() => setFrom(v))} placeholder="Any date" ariaLabel="Date from" /></label>
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Date to</span>
            <DatePicker value={to} onChange={(v) => refilter(() => setTo(v))} min={from ?? undefined} placeholder="Any date" ariaLabel="Date to" /></label>
          <div className="flex items-end">
            <button onClick={reset} className="rounded-xl glass px-4 py-2 text-sm hover:ring-1 hover:ring-primary/40">Reset</button>
          </div>
        </div>
      </div>

      <DataTable columns={columns} rows={data?.transactions ?? []} keyField={(r) => r.id} loading={loading} error={error}
        onRowClick={(r) => setOpenRow(r)} emptyTitle="No transactions found" emptyDescription="Try changing the search, the dates or a filter." />
      {data && !error && <Pager page={data.page} noun={data.page.total === 1 ? "transaction" : "transactions"} onOffset={setOffset} />}

      <Modal open={!!openRow} onClose={() => setOpenRow(null)} variant="drawer" title="Transaction" description={openRow ? rupees(openRow.amountPaise) : undefined}>
        {openRow && (
          <div className="space-y-4 text-sm">
            <StatusBadge status={openRow.status} label={statusLabel(openRow.status)} toneMap={STATUS_TONE} />
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">Transaction ID</dt><dd className="break-all font-mono text-xs">{openRow.id}</dd>
              <dt className="text-muted-foreground">Type</dt><dd>{typeLabel(openRow.type)}</dd>
              <dt className="text-muted-foreground">Status</dt><dd>{statusLabel(openRow.status)}</dd>
              <dt className="text-muted-foreground">Amount</dt><dd className="tabular-nums">{rupees(openRow.amountPaise)}</dd>
              <dt className="text-muted-foreground">Payment method</dt><dd>{methodLabel(openRow.paymentMethod)}</dd>
              <dt className="text-muted-foreground">Date &amp; time</dt><dd>{formatDateTime(openRow.at)}</dd>
              <dt className="text-muted-foreground">Settlement / reference</dt><dd className="break-all font-mono text-xs">{openRow.referenceId ?? "—"}</dd>
              <dt className="text-muted-foreground">Order</dt><dd>{orderRef(openRow)}</dd>
              {!openRow.orderId && openRow.orderCode && (<><dt className="text-muted-foreground">Ledger reference</dt><dd className="break-all font-mono text-xs">{openRow.orderCode}</dd></>)}
              <dt className="text-muted-foreground">Resident</dt><dd>{openRow.customerName ?? "—"}</dd>
              <dt className="text-muted-foreground">Phone</dt><dd>{openRow.customerPhone ?? "—"}</dd>
              <dt className="text-muted-foreground">Society</dt><dd>{openRow.societyName ?? "—"}</dd>
              <dt className="text-muted-foreground">Tower / flat</dt><dd>{formatUnit(openRow.blockName, openRow.unitNumber) || "—"}</dd>
            </dl>
            {!openRow.referenceId && (
              <p className="rounded-xl bg-foreground/5 px-3 py-2 text-xs text-muted-foreground">No settlement reference has been recorded for this transaction.</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
