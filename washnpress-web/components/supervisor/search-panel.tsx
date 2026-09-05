"use client";

import { useEffect, useState } from "react";
import { Loader2, PackageSearch, Building2, Users, UserRound, X } from "lucide-react";
import { StatusBadge } from "@/components/portal/status-badge";
import { EmptyState } from "@/components/portal/empty-state";
import { supervisorApi, type SearchResponse } from "@/lib/api/supervisor";
import type { TabId } from "./types";

// Backs the search box in the portal header. A term that matches nothing inside
// this supervisor's own area returns nothing — exactly as the backend route
// documents it (see GET /v1/supervisor/search) — never a hint that something exists
// elsewhere.
export function SearchResultsPanel({ query, onNavigate, onClear }: { query: string; onNavigate: (tab: TabId) => void; onClear: () => void }) {
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      supervisorApi.search(query).then((r) => { if (alive) setData(r); }).finally(() => { if (alive) setLoading(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  const total = data ? data.orders.length + data.residents.length + data.societies.length + data.operators.length : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Results for &ldquo;{query}&rdquo;</p>
        <button onClick={onClear} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><X className="size-3.5" /> Clear</button>
      </div>

      {loading ? (
        <div className="grid place-items-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : total === 0 ? (
        <EmptyState title="No matches" description="Nothing in your area matches that search." />
      ) : (
        <div className="space-y-6">
          {data!.orders.length > 0 && (
            <Section icon={PackageSearch} title="Orders" onSeeAll={() => onNavigate("orders")}>
              {data!.orders.slice(0, 5).map((o) => (
                <Row key={o.id} title={o.orderCode} subtitle={`${o.residentName ?? "Resident"} · ${o.societyName ?? ""}`} trailing={<StatusBadge status={o.state} />} />
              ))}
            </Section>
          )}
          {data!.residents.length > 0 && (
            <Section icon={UserRound} title="Residents" onSeeAll={() => onNavigate("society")}>
              {data!.residents.slice(0, 5).map((r) => (
                <Row key={r.id} title={r.fullName ?? "Unnamed"} subtitle={`${r.unitNumber} · ${r.phone ?? "no phone"}`} />
              ))}
            </Section>
          )}
          {data!.operators.length > 0 && (
            <Section icon={Users} title="Operators" onSeeAll={() => onNavigate("operators")}>
              {data!.operators.slice(0, 5).map((o) => (
                <Row key={o.id} title={o.fullName ?? o.phone} subtitle={o.phone} trailing={<StatusBadge status={o.status} toneMap={{ active: "success", on_leave: "warning", blocked: "danger" }} />} />
              ))}
            </Section>
          )}
          {data!.societies.length > 0 && (
            <Section icon={Building2} title="Society" onSeeAll={() => onNavigate("society")}>
              {data!.societies.map((s) => <Row key={s.id} title={s.name} />)}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, onSeeAll, children }: { icon: typeof PackageSearch; title: string; onSeeAll: () => void; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold"><Icon className="size-4 text-muted-foreground" /> {title}</h3>
        <button onClick={onSeeAll} className="text-xs text-primary hover:underline">Open tab</button>
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Row({ title, subtitle, trailing }: { title: string; subtitle?: string; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-xl glass p-3">
      <div className="min-w-0"><p className="truncate text-sm font-medium">{title}</p>{subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}</div>
      {trailing}
    </div>
  );
}
