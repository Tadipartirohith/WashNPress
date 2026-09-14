import { describe, it, expect } from "vitest";
import {
  HISTORY_DATE_BUCKETS, HISTORY_ENDPOINT, HISTORY_PAGE, HISTORY_TYPES,
  historyDetailKind, historyEmptyMessage, historyQuery, historyRequest,
  historyStatusForType, historyStatusOptions, serviceHistoryFields,
} from "../src/portals/operations-history-rules";
import type { HistoryRecord } from "../src/api/types";

function record(over: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: "svc-1", code: "AS-ABC123", type: "service",
    residentName: "Ravi", residentPhone: "9876500001",
    unitNumber: "12", blockName: "A", societyName: "Lakeside",
    detail: "Car wash", date: "2026-09-01", operatorName: "Meera",
    status: "completed", statusLabel: "Completed",
    priceLabel: "Included with plan", slotWindow: "10:00 – 12:00", cancelledReason: null,
    ...over,
  };
}

describe("history query matches Web historyAll", () => {
  it("sends page size 20 and the same filter keys", () => {
    expect(HISTORY_PAGE).toBe(20);
    expect(historyQuery({
      type: "laundry", status: "delivered", dateBucket: "7", q: "ORD-1", offset: 20,
    })).toEqual({
      type: "laundry", status: "delivered", dateBucket: "7", q: "ORD-1",
      from: undefined, to: undefined, limit: 20, offset: 20,
    });
  });

  it("sends from/to only for a custom range", () => {
    expect(historyQuery({
      dateBucket: "custom", from: "2026-08-01", to: "2026-08-15", offset: 0,
    })).toEqual({
      type: undefined, status: undefined, dateBucket: "custom",
      q: undefined, from: "2026-08-01", to: "2026-08-15", limit: 20, offset: 0,
    });
    expect(historyQuery({
      dateBucket: "today", from: "2026-08-01", to: "2026-08-15", offset: 0,
    }).from).toBeUndefined();
  });

  it("treats All time as dateBucket=all and omits empty search", () => {
    const q = historyQuery({ dateBucket: null, q: "", offset: 0 });
    expect(q.dateBucket).toBe("all");
    expect(q.q).toBeUndefined();
  });

  it("GETs /v1/operations/history/all with no body", () => {
    const req = historyRequest({
      type: "service", status: "completed", dateBucket: "custom",
      from: "2026-08-01", to: "2026-08-15", q: "Ravi", offset: 20,
    });
    expect(req).toEqual({
      method: "GET",
      path: HISTORY_ENDPOINT,
      body: undefined,
      query: {
        type: "service", status: "completed", dateBucket: "custom",
        q: "Ravi", from: "2026-08-01", to: "2026-08-15", limit: 20, offset: 20,
      },
    });
    expect(HISTORY_ENDPOINT).toBe("/v1/operations/history/all");
  });
});

describe("status options follow the selected type", () => {
  it("hides completed on laundry and delivered on services", () => {
    expect(historyStatusOptions("laundry").map((s) => s.key)).toEqual(["", "delivered", "cancelled"]);
    expect(historyStatusOptions("service").map((s) => s.key)).toEqual(["", "completed", "cancelled"]);
    expect(historyStatusOptions("").map((s) => s.key)).toEqual(["", "delivered", "completed", "cancelled"]);
  });

  it("keeps the Web type buckets", () => {
    expect(HISTORY_TYPES.map((t) => t.key)).toEqual(["", "laundry", "service"]);
    expect(HISTORY_TYPES.map((t) => t.label)).toEqual(["All Types", "Laundry", "Additional Services"]);
    expect(HISTORY_DATE_BUCKETS.map((d) => d.key)).toEqual(["all", "today", "yesterday", "7", "30", "custom"]);
  });

  it("clears status when the type changes", () => {
    expect(historyStatusForType("laundry", "service", "delivered")).toBeNull();
    expect(historyStatusForType("service", "service", "completed")).toBe("completed");
    expect(historyStatusForType(null, "laundry", "completed")).toBeNull();
  });

  it("sends the selected type and omits All Types", () => {
    expect(historyQuery({ type: "laundry", offset: 0 }).type).toBe("laundry");
    expect(historyQuery({ type: "service", offset: 0 }).type).toBe("service");
    expect(historyQuery({ type: "", offset: 0 }).type).toBeUndefined();
  });
});

describe("search, pagination and empty copy", () => {
  it("passes the search term through as q", () => {
    expect(historyQuery({ q: "98765", offset: 0 }).q).toBe("98765");
  });

  it("pages by 20", () => {
    expect(historyQuery({ offset: 40 }).offset).toBe(40);
    expect(historyQuery({ offset: 40 }).limit).toBe(20);
  });

  it("uses Web empty copy when filters are on", () => {
    expect(historyEmptyMessage({})).toMatch(/no history yet/i);
    expect(historyEmptyMessage({ q: "ORD" })).toBe("No records match your filters.");
    expect(historyEmptyMessage({ dateBucket: "custom", from: "2026-08-01" })).toBe("No records match your filters.");
  });
});

describe("history detail", () => {
  it("opens laundry as the order and a service as read-only fields", () => {
    expect(historyDetailKind("laundry")).toBe("order");
    expect(historyDetailKind("service")).toBe("service");
  });

  it("shows the same service fields as Web, including cancel reason", () => {
    const open = serviceHistoryFields(record(), (d) => d ?? "—", (b, u) => [b, u].filter(Boolean).join("-"));
    expect(open.map((r) => r.label)).toEqual([
      "Type", "Status", "Resident", "Unit / Society", "Date", "Operator", "Price",
    ]);
    expect(open.find((r) => r.label === "Date")?.value).toBe("2026-09-01 · 10:00 – 12:00");
    expect(open.find((r) => r.label === "Cancelled reason")).toBeUndefined();

    const cancelled = serviceHistoryFields(
      record({ status: "cancelled", statusLabel: "Cancelled", cancelledReason: "Resident cancelled" }),
      (d) => d ?? "—",
      () => "A-12",
    );
    expect(cancelled.find((r) => r.label === "Cancelled reason")?.value).toBe("Resident cancelled");
  });
});
