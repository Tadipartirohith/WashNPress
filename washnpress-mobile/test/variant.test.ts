import { describe, it, expect } from "vitest";
import {
  APP_NAMES, PORTALS_IN_APP, otherVariant, servesPortal, wrongAppMessage,
} from "../src/variant-rules";
import type { Portal } from "../src/api/types";

const EVERY_PORTAL: Portal[] = ["resident", "operations", "supervisor", "admin"];

describe("which app serves which portal", () => {
  it("keeps the resident app to the one portal a member of the public can hold", () => {
    expect(PORTALS_IN_APP.resident).toEqual(["resident"]);
  });

  it("keeps every staff portal out of it", () => {
    // A consumer listing whose real function is an operations console behind a
    // login nobody can get is the rejection this split exists to avoid.
    for (const portal of ["operations", "supervisor", "admin"] as Portal[]) {
      expect(servesPortal("resident", portal), portal).toBe(false);
    }
  });

  it("keeps the three staff portals together in one app", () => {
    // An operator, a supervisor and an admin are colleagues on the same shift.
    // Three listings would be three installs and three things to keep updated.
    expect(PORTALS_IN_APP.staff).toEqual(["operations", "supervisor", "admin"]);
    expect(servesPortal("staff", "resident")).toBe(false);
  });

  it("covers every portal between the two apps, and never both", () => {
    // A portal in neither app is one nobody can reach; a portal in both is a
    // decision made twice and eventually made differently.
    for (const portal of EVERY_PORTAL) {
      const homes = (["resident", "staff"] as const).filter((v) => servesPortal(v, portal));
      expect(homes, portal).toHaveLength(1);
    }
  });

  it("knows which app is the other one", () => {
    expect(otherVariant("resident")).toBe("staff");
    expect(otherVariant("staff")).toBe("resident");
  });
});

describe("what somebody holding the wrong app is told", () => {
  it("names the app they should install instead", () => {
    expect(wrongAppMessage("resident", "supervisor")).toContain(APP_NAMES.staff);
    expect(wrongAppMessage("staff", "resident")).toContain(APP_NAMES.resident);
  });

  it("does not suggest anything is wrong with their account", () => {
    // Their credentials are right and the account is fine. They are holding the
    // wrong app, and the message has to say that rather than reading as a fault
    // they have to do something about.
    for (const message of [wrongAppMessage("resident", "admin"), wrongAppMessage("staff", "resident")]) {
      expect(message).not.toMatch(/denied|not allowed|forbidden|permission|error/i);
      expect(message).toMatch(/install/i);
    }
  });
});
