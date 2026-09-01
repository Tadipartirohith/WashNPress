import { describe, it, expect } from "vitest";
import { actionsFor, mayChangeStatus, statusLabelFor } from "../src/portals/user-action-rules";

const keys = (roles: string[], status: string) => actionsFor({ roles, status }).map((a) => a.key);

describe("what the Users page offers for each account", () => {
  it("gives a resident, an operator and a supervisor the same three actions", () => {
    for (const role of ["resident", "operator", "supervisor"]) {
      expect(keys([role], "active")).toEqual(["edit", "block", "deactivate"]);
    }
  });

  it("lets an admin be edited and nothing else", () => {
    expect(keys(["admin"], "active")).toEqual(["edit"]);
    expect(mayChangeStatus({ roles: ["admin"], status: "active" })).toBe(false);
  });

  it("does not depend on the role for which word is used", () => {
    // An operator used to get "Block" and everybody else "Deactivate", for the
    // same underlying flag.
    expect(keys(["operator"], "active")).toEqual(keys(["resident"], "active"));
  });

  it("offers the way back rather than the way out, once blocked", () => {
    expect(keys(["operator"], "blocked")).toEqual(["edit", "unblock", "deactivate"]);
  });

  it("offers only reactivation once deactivated", () => {
    expect(keys(["operator"], "deleted")).toEqual(["edit", "activate"]);
  });

  it("keeps blocking and deactivating as different destinations", () => {
    const active = actionsFor({ roles: ["resident"], status: "active" });
    expect(active.find((a) => a.key === "block")!.to).toBe("blocked");
    expect(active.find((a) => a.key === "deactivate")!.to).toBe("deleted");
  });

  it("confirms everything that changes an account, and nothing that does not", () => {
    for (const status of ["active", "blocked", "deleted"]) {
      for (const action of actionsFor({ roles: ["operator"], status })) {
        if (action.key === "edit") expect(action.confirm).toBeUndefined();
        else expect(action.confirm?.confirmLabel).toBeTruthy();
      }
    }
  });

  it("names the person in the confirmation when it knows the name", () => {
    const [, block] = actionsFor({ roles: ["resident"], status: "active" }, "Bantu");
    expect(block.confirm!.message).toMatch(/^Bantu /);
  });

  it("falls back to a phrase rather than an empty space", () => {
    const [, block] = actionsFor({ roles: ["resident"], status: "active" }, null);
    expect(block.confirm!.message).toMatch(/^This account /);
  });

  it("says a blocked account can come back, and a deactivated one keeps its record", () => {
    const blocked = actionsFor({ roles: ["operator"], status: "active" }).find((a) => a.key === "block")!;
    expect(blocked.confirm!.message).toMatch(/nothing is deleted/i);
    const off = actionsFor({ roles: ["operator"], status: "active" }).find((a) => a.key === "deactivate")!;
    expect(off.confirm!.message).toMatch(/assignments are kept/i);
  });

  it("reads each status in words rather than in storage terms", () => {
    expect(statusLabelFor("active")).toBe("Active");
    expect(statusLabelFor("blocked")).toBe("Blocked");
    // "deleted" is what the column has always been called underneath; nobody
    // should be shown that word for an account that still exists.
    expect(statusLabelFor("deleted")).toBe("Deactivated");
  });
});
