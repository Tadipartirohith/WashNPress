import { describe, it, expect } from "vitest";
import {
  OPERATIONS_NAV, OPERATIONS_PAGE, OPERATIONS_PRIMARY_TABS, OPERATIONS_MORE_TABS,
  OPERATIONS_SHELL_SUBTITLE_FALLBACK, OPERATIONS_SHELL_TITLE,
  operationsBarValue, operationsCoveringSubtitle, operationsMoreItems, operationsMoreOrder,
} from "../src/portals/operations-nav-rules";

describe("Operator nav matches Web OperationsWorkspace", () => {
  it("keeps Web's labels and order", () => {
    expect(OPERATIONS_NAV.map((item) => item.label)).toEqual([
      "Dashboard", "Pickups", "Active", "Claimable", "History", "Services", "Issues", "Profile",
    ]);
    expect(OPERATIONS_NAV.map((item) => item.id)).toEqual([
      "dashboard", "pickups", "active", "queue", "history", "services", "issues", "profile",
    ]);
  });

  it("puts the shift tabs on the bar and the rest behind More in Web order", () => {
    expect(OPERATIONS_PRIMARY_TABS).toEqual(["home", "pickups", "active", "issues"]);
    expect(operationsMoreOrder()).toEqual(["claimable", "history", "services", "profile"]);
    expect(operationsMoreItems().map((item) => item.label)).toEqual([
      "Claimable", "History", "Services", "Profile",
    ]);
    expect(OPERATIONS_MORE_TABS).not.toContain("issues");
  });

  it("marks a primary tab as itself and every overflow tab as More", () => {
    expect(operationsBarValue("home")).toBe("home");
    expect(operationsBarValue("pickups")).toBe("pickups");
    expect(operationsBarValue("active")).toBe("active");
    expect(operationsBarValue("issues")).toBe("issues");
    expect(operationsBarValue("claimable")).toBe("more");
    expect(operationsBarValue("history")).toBe("more");
    expect(operationsBarValue("services")).toBe("more");
    expect(operationsBarValue("profile")).toBe("more");
    expect(operationsBarValue("more")).toBe("more");
  });
});

describe("Operator header titles match Web PortalShell / tab headings", () => {
  it("uses Web's shell title and covering fallback", () => {
    expect(OPERATIONS_SHELL_TITLE).toBe("Operations");
    expect(operationsCoveringSubtitle(null)).toBe(OPERATIONS_SHELL_SUBTITLE_FALLBACK);
    expect(operationsCoveringSubtitle("  ")).toBe(OPERATIONS_SHELL_SUBTITLE_FALLBACK);
    expect(operationsCoveringSubtitle(undefined, [])).toBe("Pickups, processing and delivery");
  });

  it("covers the profile society, then dashboard society names", () => {
    expect(operationsCoveringSubtitle(" Lakeside ")).toBe("Covering Lakeside");
    expect(operationsCoveringSubtitle(null, [" Oak ", "Pine"])).toBe("Covering Oak, Pine");
    expect(operationsCoveringSubtitle("Lakeside", ["Oak"])).toBe("Covering Lakeside");
  });

  it("uses Web page titles rather than invented Mobile names", () => {
    expect(OPERATIONS_PAGE.dashboard.title).toBe("Operations");
    expect(OPERATIONS_PAGE.pickups.title).toBe("Pickups");
    expect(OPERATIONS_PAGE.active).toEqual({
      title: "Active Orders",
      subtitle: "Collected orders in processing, by stage.",
    });
    expect(OPERATIONS_PAGE.claimable.title).toBe("Claimable");
    expect(OPERATIONS_PAGE.history).toEqual({
      title: "History",
      subtitle: "Completed and cancelled orders and service bookings.",
    });
    expect(OPERATIONS_PAGE.services).toEqual({
      title: "Additional Services",
      subtitle: "Manage scheduled additional service bookings.",
    });
    expect(OPERATIONS_PAGE.issues.title).toBe("Issues");
    expect(OPERATIONS_PAGE.profile).toEqual({
      title: "Profile",
      subtitle: "View your operator and assigned coverage details.",
    });
  });
});
