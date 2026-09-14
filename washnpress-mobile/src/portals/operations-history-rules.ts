// Operator History — the same filters, query and service-detail rows as Web's
// HistoryTab. The list is GET /v1/operations/history/all; this file only shapes
// what that request sends and what a service row shows.

import type { HistoryRecord } from "../api/types";

export const HISTORY_PAGE = 20;
export const HISTORY_ENDPOINT = "/v1/operations/history/all";

export const HISTORY_TYPES = [
  { key: "", label: "All Types" },
  { key: "laundry", label: "Laundry" },
  { key: "service", label: "Additional Services" },
] as const;

export const HISTORY_DATE_BUCKETS = [
  { key: "all", label: "All time" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "custom", label: "Custom" },
] as const;

export function historyStatusOptions(type: string): { key: string; label: string }[] {
  if (type === "laundry") {
    return [
      { key: "", label: "All" },
      { key: "delivered", label: "Delivered" },
      { key: "cancelled", label: "Cancelled" },
    ];
  }
  if (type === "service") {
    return [
      { key: "", label: "All" },
      { key: "completed", label: "Completed" },
      { key: "cancelled", label: "Cancelled" },
    ];
  }
  return [
    { key: "", label: "All" },
    { key: "delivered", label: "Delivered" },
    { key: "completed", label: "Completed" },
    { key: "cancelled", label: "Cancelled" },
  ];
}

export interface HistoryFilters {
  type?: string | null;
  status?: string | null;
  dateBucket?: string | null;
  from?: string;
  to?: string;
  q?: string;
  offset: number;
}

// The same query Web's HistoryTab sends to operationsApi.historyAll.
export function historyQuery(filters: HistoryFilters): Record<string, string | number | undefined> {
  const dateBucket = filters.dateBucket || "all";
  return {
    type: filters.type || undefined,
    status: filters.status || undefined,
    dateBucket,
    q: filters.q || undefined,
    from: dateBucket === "custom" ? (filters.from || undefined) : undefined,
    to: dateBucket === "custom" ? (filters.to || undefined) : undefined,
    limit: HISTORY_PAGE,
    offset: filters.offset,
  };
}

export function historyRequest(filters: HistoryFilters): {
  method: "GET";
  path: string;
  query: Record<string, string | number | undefined>;
  body: undefined;
} {
  return { method: "GET", path: HISTORY_ENDPOINT, query: historyQuery(filters), body: undefined };
}

// Web's type <select> does `setType(...); setStatus("");` — a leftover status from
// the previous type is never sent.
export function historyStatusForType(
  currentType: string | null | undefined,
  nextType: string | null | undefined,
  status: string | null | undefined,
): string | null {
  if ((nextType || "") !== (currentType || "")) return null;
  return status || null;
}

export function historyEmptyMessage(filters: Omit<HistoryFilters, "offset">): string {
  const bucket = filters.dateBucket || "all";
  if (filters.q || filters.type || filters.status || bucket !== "all") {
    return "No records match your filters.";
  }
  return "No history yet. Delivered and cancelled records show up here.";
}

export function historyDetailKind(type: HistoryRecord["type"]): "order" | "service" {
  return type === "laundry" ? "order" : "service";
}

export function serviceHistoryFields(
  record: HistoryRecord,
  formatDate: (value: string | null | undefined) => string,
  formatUnit: (block: string | null | undefined, unit: string | null | undefined) => string,
): { label: string; value: string }[] {
  const unitSociety = [formatUnit(record.blockName, record.unitNumber), record.societyName].filter(Boolean).join(" · ");
  const date = `${formatDate(record.date)}${record.slotWindow ? ` · ${record.slotWindow}` : ""}`;
  const rows = [
    { label: "Type", value: "Additional Service" },
    { label: "Status", value: record.statusLabel || "—" },
    { label: "Resident", value: record.residentName || "—" },
    { label: "Unit / Society", value: unitSociety || "—" },
    { label: "Date", value: date || "—" },
    { label: "Operator", value: record.operatorName || "—" },
    { label: "Price", value: record.priceLabel || "—" },
  ];
  if (record.status === "cancelled") {
    rows.push({ label: "Cancelled reason", value: record.cancelledReason || "—" });
  }
  return rows;
}
