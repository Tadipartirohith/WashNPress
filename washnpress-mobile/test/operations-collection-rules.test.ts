import { describe, it, expect } from "vitest";
import {
  COLLECTED_LINES_REQUIRED, DISCREPANCY_REQUIRED, EARLY_REASON_REQUIRED,
  PREVIEW_FIRST, QUANTITY_CHANGED,
  bookedLinePayload, collectedLinesValid, collectionConfirmDisabled,
  collectionPayload, collectionProblems, hasLineMismatch, pickedUpReplay,
  previewKey, previewProblem, previewStatus,
  type CollectionDraft,
} from "../src/portals/operations-collection-rules";

function draft(over: Partial<CollectionDraft> = {}): CollectionDraft {
  return {
    bookedLines: [],
    collected: [],
    early: false,
    earlyReason: "",
    mismatch: false,
    discrepancyReason: null,
    discrepancyRemarks: "",
    preview: "not_required",
    ...over,
  };
}

describe("slot-only collection", () => {
  it("refuses a row that is missing a garment, a service or a quantity", () => {
    expect(collectedLinesValid([])).toBe(false);
    expect(collectedLinesValid([{ category: "Shirts", serviceId: "", quantity: 2 }])).toBe(false);
    expect(collectedLinesValid([{ category: "", serviceId: "svc-1", quantity: 2 }])).toBe(false);
    expect(collectedLinesValid([{ category: "Shirts", serviceId: "svc-1", quantity: 0 }])).toBe(false);
    expect(collectedLinesValid([{ category: "Shirts", serviceId: "svc-1", quantity: 2 }])).toBe(true);
  });

  it("sends collectedLines, never the old { items } category-only payload", () => {
    const body = collectionPayload(draft({
      collected: [
        { category: "Shirts", serviceId: "wash", quantity: 4 },
        { category: "", serviceId: "wash", quantity: 1 },
      ],
    }));
    expect(body.collectedLines).toEqual([{ category: "Shirts", serviceId: "wash", quantity: 4 }]);
    expect(body.lines).toBeUndefined();
    expect(body).not.toHaveProperty("items");
  });

  it("blocks confirm until every row is a garment plus a service", () => {
    expect(collectionProblems(draft({ collected: [{ category: "Shirts", serviceId: "", quantity: 1 }] })))
      .toContain(COLLECTED_LINES_REQUIRED);
  });
});

describe("preview-first", () => {
  it("refuses confirm when booked lines have never been previewed", () => {
    const d = draft({
      bookedLines: [{ lineId: "l1", acceptedQuantity: 4 }],
      preview: "missing",
    });
    expect(collectionProblems(d)).toContain(PREVIEW_FIRST);
    expect(collectionConfirmDisabled(d)).toBe(true);
    expect(previewProblem("missing")).toBe(PREVIEW_FIRST);
  });

  it("refuses confirm when the preview is stale", () => {
    const d = draft({
      bookedLines: [{ lineId: "l1", acceptedQuantity: 5 }],
      preview: "stale",
    });
    expect(collectionProblems(d)).toContain(QUANTITY_CHANGED);
    expect(collectionConfirmDisabled(d)).toBe(true);
    expect(previewProblem("stale")).toBe(QUANTITY_CHANGED);
  });

  it("marks the previous preview stale after a quantity change", () => {
    const before = bookedLinePayload(
      [{ id: "l1", quantity: 4, unit: "piece" }],
      { l1: 4 },
      {},
    );
    const after = bookedLinePayload(
      [{ id: "l1", quantity: 4, unit: "piece" }],
      { l1: 6 },
      {},
    );
    expect(previewKey(before)).not.toBe(previewKey(after));
    expect(previewStatus({
      bookedLineCount: 1,
      hasPreview: false,
      payloadKey: previewKey(after),
      previewedKey: previewKey(before),
    })).toBe("stale");
  });

  it("marks a measurement change stale the same way", () => {
    const before = bookedLinePayload(
      [{ id: "l1", quantity: 2, unit: "kg", measuredQuantity: 1.2 }],
      { l1: 2 },
      { l1: "1.2" },
    );
    const after = bookedLinePayload(
      [{ id: "l1", quantity: 2, unit: "kg", measuredQuantity: 1.2 }],
      { l1: 2 },
      { l1: "1.8" },
    );
    expect(previewStatus({
      bookedLineCount: 1,
      hasPreview: false,
      payloadKey: previewKey(after),
      previewedKey: previewKey(before),
    })).toBe("stale");
  });

  it("treats a matching previewed key as fresh and does not require preview for slot-only", () => {
    const lines = [{ lineId: "l1", acceptedQuantity: 4 }];
    expect(previewStatus({
      bookedLineCount: 1,
      hasPreview: true,
      payloadKey: previewKey(lines),
      previewedKey: previewKey(lines),
    })).toBe("fresh");
    expect(previewStatus({
      bookedLineCount: 0,
      hasPreview: false,
      payloadKey: "[]",
      previewedKey: null,
    })).toBe("not_required");
    expect(collectionConfirmDisabled(draft({
      bookedLines: lines,
      preview: "fresh",
    }))).toBe(false);
  });
});

describe("early collection", () => {
  it("refuses a blank reason and never invents one", () => {
    expect(collectionProblems(draft({
      collected: [{ category: "Shirts", serviceId: "wash", quantity: 1 }],
      early: true,
      earlyReason: "",
    }))).toContain(EARLY_REASON_REQUIRED);
    expect(collectionConfirmDisabled(draft({
      collected: [{ category: "Shirts", serviceId: "wash", quantity: 1 }],
      early: true,
      earlyReason: "",
    }))).toBe(true);
  });

  it("refuses a whitespace-only reason", () => {
    expect(collectionProblems(draft({
      collected: [{ category: "Shirts", serviceId: "wash", quantity: 1 }],
      early: true,
      earlyReason: "   ",
    }))).toContain(EARLY_REASON_REQUIRED);
    const body = collectionPayload(draft({
      collected: [{ category: "Shirts", serviceId: "wash", quantity: 1 }],
      early: true,
      earlyReason: "   ",
    }));
    expect(body.earlyReason).toBe("");
    expect(body.earlyReason).not.toBe("Agreed with the resident");
  });

  it("sends only the trimmed reason when early collection is valid", () => {
    const body = collectionPayload(draft({
      collected: [{ category: "Shirts", serviceId: "wash", quantity: 1 }],
      early: true,
      earlyReason: "  Resident asked us to take it now  ",
    }));
    expect(body.early).toBe(true);
    expect(body.earlyReason).toBe("Resident asked us to take it now");
    expect(collectionProblems(draft({
      collected: [{ category: "Shirts", serviceId: "wash", quantity: 1 }],
      early: true,
      earlyReason: "  Resident asked us to take it now  ",
    }))).toEqual([]);
  });

  it("omits early fields when the window is due", () => {
    const body = collectionPayload(draft({
      collected: [{ category: "Shirts", serviceId: "wash", quantity: 1 }],
    }));
    expect(body.early).toBeUndefined();
    expect(body.earlyReason).toBeUndefined();
  });
});

describe("discrepancy", () => {
  it("requires a reason and remarks when a fresh preview line is not matched", () => {
    expect(hasLineMismatch({ lines: [{ status: "short" }] }, true)).toBe(true);
    expect(hasLineMismatch({ lines: [{ status: "matched" }] }, true)).toBe(false);
    expect(hasLineMismatch({ lines: [{ status: "short" }] }, false)).toBe(false);

    const problems = collectionProblems(draft({
      bookedLines: [{ lineId: "l1", acceptedQuantity: 3 }],
      preview: "fresh",
      mismatch: true,
    }));
    expect(problems).toEqual([DISCREPANCY_REQUIRED]);
    expect(collectionConfirmDisabled(draft({
      bookedLines: [{ lineId: "l1", acceptedQuantity: 3 }],
      preview: "fresh",
      mismatch: true,
    }))).toBe(false);
  });

  it("accepts both fields and omits them when there is no mismatch", () => {
    const ready = collectionProblems(draft({
      bookedLines: [{ lineId: "l1", acceptedQuantity: 3 }],
      preview: "fresh",
      mismatch: true,
      discrepancyReason: "not_handed_over",
      discrepancyRemarks: "Only three shirts at the door",
    }));
    expect(ready).toEqual([]);

    const matched = collectionPayload(draft({
      bookedLines: [{ lineId: "l1", acceptedQuantity: 4 }],
      preview: "fresh",
      mismatch: false,
      discrepancyReason: "not_handed_over",
      discrepancyRemarks: "should not be sent",
    }));
    expect(matched.discrepancyReason).toBeUndefined();
    expect(matched.discrepancyRemarks).toBeUndefined();
  });
});

describe("final payload", () => {
  it("matches Web: lines, early trim, and discrepancy only on mismatch", () => {
    const body = collectionPayload(draft({
      bookedLines: [{ lineId: "l1", acceptedQuantity: 3, acceptedMeasuredQuantity: 1.4 }],
      preview: "fresh",
      early: true,
      earlyReason: "  Resident is leaving  ",
      mismatch: true,
      discrepancyReason: "not_handed_over",
      discrepancyRemarks: "Only three shirts at the door",
    }));
    expect(body).toEqual({
      lines: [{ lineId: "l1", acceptedQuantity: 3, acceptedMeasuredQuantity: 1.4 }],
      early: true,
      earlyReason: "Resident is leaving",
      discrepancyReason: "not_handed_over",
      discrepancyRemarks: "Only three shirts at the door",
    });
    expect(body).not.toHaveProperty("items");
    expect(body.collectedLines).toBeUndefined();
  });

  it("sends collectedLines for a slot-only order", () => {
    const body = collectionPayload(draft({
      collected: [{ category: "Shirts", serviceId: "wash", quantity: 4 }],
    }));
    expect(body).toEqual({
      collectedLines: [{ category: "Shirts", serviceId: "wash", quantity: 4 }],
    });
  });
});

describe("offline pickup replay", () => {
  it("replays a Web-shaped body through opsPickedUpLines", () => {
    const body = collectionPayload(draft({
      bookedLines: [{ lineId: "l1", acceptedQuantity: 4 }],
      preview: "fresh",
    }));
    expect(pickedUpReplay({ orderId: "ord-1", body })).toEqual({
      api: "opsPickedUpLines",
      orderId: "ord-1",
      body,
    });
  });

  it("keeps an already-queued { items } pickup on the legacy client", () => {
    const items = [{ category: "Shirts", quantity: 3 }];
    expect(pickedUpReplay({ orderId: "ord-2", items })).toEqual({
      api: "markPickedUp",
      orderId: "ord-2",
      items,
    });
  });
});
