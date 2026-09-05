"use client";

import * as React from "react";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { DataTable, type Column } from "@/components/portal/data-table";
import { useAsync } from "@/lib/use-async";
import { adminApi, type AuditEntry } from "@/lib/api/admin";
import { formatDateTime, stateLabel } from "@/lib/format";

const PAGE_SIZE = 25;

export function AuditSection() {
  const [q, setQ] = React.useState("");
  const [resource, setResource] = React.useState("");
  const [action, setAction] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [offset, setOffset] = React.useState(0);

  const { data, loading, error } = useAsync(
    () => adminApi.audit.list({
      q: q || undefined, resource: resource || undefined, action: action || undefined,
      from: from || undefined, to: to || undefined, limit: String(PAGE_SIZE), offset: String(offset),
    }),
    [q, resource, action, from, to, offset],
  );

  const columns: Column<AuditEntry>[] = [
    { header: "Action", cell: (r) => <span className="font-medium">{stateLabel(r.action)}</span> },
    { header: "Resource", cell: (r) => <span>{r.resource}{r.resourceId ? ` #${r.resourceId.slice(0, 8)}` : ""}</span> },
    { header: "Actor", cell: (r) => <div><p>{r.actorName ?? r.actor}</p>{r.role && <p className="text-xs text-muted-foreground">{r.role}</p>}</div> },
    { header: "When", cell: (r) => formatDateTime(r.at) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2 text-sm text-muted-foreground sm:max-w-xs">
          <Search className="size-4 shrink-0" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder="Search audit log" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
        </div>
        <input value={resource} onChange={(e) => { setResource(e.target.value); setOffset(0); }} placeholder="Resource (e.g. order)"
          className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
        <input value={action} onChange={(e) => { setAction(e.target.value); setOffset(0); }} placeholder="Action (e.g. order.assigned)"
          className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
        <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
        <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
      </div>

      <DataTable columns={columns} rows={data?.entries ?? []} keyField={(r) => r.id ?? `${r.actor}-${r.action}-${r.resourceId ?? ""}-${r.at}`} loading={loading} error={error}
        emptyTitle="No entries match" emptyDescription="Try clearing a filter." />

      {data && data.page.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, data.page.total)} of {data.page.total}</span>
          <div className="flex gap-2">
            <button onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))} disabled={offset === 0}
              className="grid size-8 place-items-center rounded-lg glass disabled:opacity-40"><ChevronLeft className="size-4" /></button>
            <button onClick={() => setOffset((o) => o + PAGE_SIZE)} disabled={!data.page.hasMore}
              className="grid size-8 place-items-center rounded-lg glass disabled:opacity-40"><ChevronRight className="size-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
