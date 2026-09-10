import { describe, it, expect } from "vitest";
import { backAction } from "../src/portals/back-rules";

// `BackHandler` appeared nowhere in the app, so on Android the system back gesture
// did the platform default at every depth: leave. From an open order, from a tab,
// from a half-finished reconcile.

describe("what the Android back button does", () => {
  it("closes whatever is open over the tab first", () => {
    expect(backAction({ recordOpen: true, tab: "pickups", homeTab: "home" })).toBe("closeRecord");
  });

  it("closes the record even when the tab underneath is already home", () => {
    // Otherwise back from an order opened off the dashboard would close the app.
    expect(backAction({ recordOpen: true, tab: "home", homeTab: "home" })).toBe("closeRecord");
  });

  it("comes back to the tab the portal opens on", () => {
    expect(backAction({ recordOpen: false, tab: "issues", homeTab: "home" })).toBe("goHome");
  });

  it("lets go at the top, because an app that refuses to be left is worse", () => {
    expect(backAction({ recordOpen: false, tab: "home", homeTab: "home" })).toBe("exitApp");
  });

  it("means the same thing in a portal whose home tab is named differently", () => {
    // Four portals, one rule. Back meaning something different depending which one
    // you are in is the failure this file exists to prevent.
    expect(backAction({ recordOpen: false, tab: "dashboard", homeTab: "dashboard" })).toBe("exitApp");
    expect(backAction({ recordOpen: false, tab: "home", homeTab: "dashboard" })).toBe("goHome");
  });
});
