import { describe, it, expect } from "vitest";
import {
  QC_REASON_REQUIRED,
  qcBatchFailPayload, qcBatchFailRequest, qcEvidenceSatisfied, qcEvidenceUrlToSend,
  qcFailAllowed, qcFailProblems, qcFailReasonToSend, qcPassPayload, qcReasonsReady,
} from "../src/portals/operations-qc-rules";

const reasons = [
  { key: "stain_not_removed", label: "Stain not removed" },
  { key: "poor_ironing", label: "Poor ironing" },
];

describe("API-provided QC reasons", () => {
  it("is not ready until the API list has at least one option", () => {
    expect(qcReasonsReady(undefined)).toBe(false);
    expect(qcReasonsReady([])).toBe(false);
    expect(qcReasonsReady(reasons)).toBe(true);
  });

  it("sends the API key, never a hardcoded label", () => {
    expect(qcFailReasonToSend("stain_not_removed", reasons)).toBe("stain_not_removed");
    expect(qcFailReasonToSend("Stain remaining", reasons)).toBeNull();
    expect(qcFailReasonToSend("Stain not removed", reasons)).toBeNull();
  });
});

describe("QC failure without a reason", () => {
  it("rejects an empty choice, matching Web's required reason", () => {
    expect(qcFailAllowed(null, reasons)).toBe(false);
    expect(qcFailAllowed("", reasons)).toBe(false);
    expect(qcFailProblems(null, reasons)).toEqual([QC_REASON_REQUIRED]);
  });

  it("rejects a key that is not on the loaded list", () => {
    expect(qcFailAllowed("garment_damage", reasons)).toBe(false);
  });

  it("treats a loading or empty list as no reason chosen", () => {
    expect(qcFailAllowed("stain_not_removed", [])).toBe(false);
    expect(qcFailProblems("stain_not_removed", [])).toEqual([QC_REASON_REQUIRED]);
    expect(qcFailReasonToSend("stain_not_removed", [])).toBeNull();
  });

  it("allows fail once a loaded key is chosen", () => {
    expect(qcFailAllowed("poor_ironing", reasons)).toBe(true);
    expect(qcFailProblems("poor_ironing", reasons)).toEqual([]);
  });
});

describe("QC pass", () => {
  it("sends pass with no failure reason", () => {
    expect(qcPassPayload()).toEqual({ pass: true, reason: undefined });
  });
});

describe("QC evidence URL matches Web QcFailModal", () => {
  it("sends a trimmed evidenceUrl when one is given", () => {
    expect(qcEvidenceUrlToSend("  https://img.example/stain.jpg  ")).toBe("https://img.example/stain.jpg");
    expect(qcBatchFailPayload({
      reason: "garment_damage", remarks: "  torn cuff  ", evidenceUrl: "  https://img.example/stain.jpg  ",
    })).toEqual({
      reason: "garment_damage", remarks: "torn cuff",
      evidenceUrl: "https://img.example/stain.jpg", evidencePhoto: undefined,
    });
  });

  it("omits evidenceUrl when it is blank or whitespace", () => {
    expect(qcEvidenceUrlToSend("")).toBeUndefined();
    expect(qcEvidenceUrlToSend("   ")).toBeUndefined();
    expect(qcBatchFailPayload({
      reason: "poor_ironing", remarks: "crease", evidenceUrl: "  ",
    }).evidenceUrl).toBeUndefined();
  });

  it("requires photo or URL only when the reason asks for evidence", () => {
    expect(qcEvidenceSatisfied({ evidenceRequired: false, photo: null, evidenceUrl: "" })).toBe(true);
    expect(qcEvidenceSatisfied({ evidenceRequired: true, photo: null, evidenceUrl: "" })).toBe(false);
    expect(qcEvidenceSatisfied({ evidenceRequired: true, photo: null, evidenceUrl: "   " })).toBe(false);
    expect(qcEvidenceSatisfied({ evidenceRequired: true, photo: null, evidenceUrl: "https://img.example/a.jpg" })).toBe(true);
    expect(qcEvidenceSatisfied({ evidenceRequired: true, photo: { data: "x" }, evidenceUrl: "" })).toBe(true);
  });

  it("POSTs /batches/:id/qc with Web's evidenceUrl key", () => {
    const req = qcBatchFailRequest("ord-1", "bat-2", qcBatchFailPayload({
      reason: "garment_damage", remarks: "rip", evidenceUrl: "https://img.example/a.jpg",
    }));
    expect(req).toEqual({
      method: "POST",
      path: "/v1/operations/orders/ord-1/batches/bat-2/qc",
      body: {
        passed: false, reason: "garment_damage", remarks: "rip",
        evidenceUrl: "https://img.example/a.jpg", evidencePhoto: undefined,
      },
    });
  });
});
