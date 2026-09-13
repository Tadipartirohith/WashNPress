import { describe, it, expect } from "vitest";
import { serviceCancelAllowed } from "../src/portals/operations-service-rules";

describe("service cancel matches Web BookingModal", () => {
  it("allows cancel only before the job has started", () => {
    expect(serviceCancelAllowed("requested")).toBe(true);
    expect(serviceCancelAllowed("assigned")).toBe(true);
  });

  it("refuses cancel once work is underway or finished", () => {
    expect(serviceCancelAllowed("in_progress")).toBe(false);
    expect(serviceCancelAllowed("completed")).toBe(false);
    expect(serviceCancelAllowed("cancelled")).toBe(false);
    expect(serviceCancelAllowed(null)).toBe(false);
  });
});
