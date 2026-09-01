import { describe, it, expect } from "vitest";
import { pushReasonFor, canRegisterForPush, type PushEnvironment } from "../src/push-rules";

// A tester on Expo Go saw no notifications and two warnings they could do nothing
// about from inside Expo Go, and the app looked broken when the container was the
// limitation. These lock the four reasons apart, and in particular fix the order:
// Expo Go on a real handset is still Expo Go.

const working: PushEnvironment = {
  platform: "android", inExpoGo: false, isDevice: true, hasProjectId: true,
};

describe("whether this handset can be sent a push notification", () => {
  it("says nothing at all when it can", () => {
    expect(pushReasonFor(working)).toBeNull();
    expect(canRegisterForPush(working)).toBe(true);
    expect(pushReasonFor({ ...working, platform: "ios" })).toBeNull();
  });

  it("names Expo Go rather than blaming the device", () => {
    // The trap: Expo Go on a real phone. Checking the device first would have
    // told somebody holding a real handset that they were on a simulator.
    const reason = pushReasonFor({ ...working, inExpoGo: true });
    expect(reason).toMatch(/Expo Go/);
    expect(reason).not.toMatch(/simulator/i);
    expect(reason).toMatch(/development build/i);
  });

  it("still names Expo Go on a simulator running Expo Go", () => {
    const reason = pushReasonFor({ ...working, inExpoGo: true, isDevice: false });
    expect(reason).toMatch(/Expo Go/);
  });

  it("explains a simulator, a web build and a build with no project", () => {
    expect(pushReasonFor({ ...working, isDevice: false })).toMatch(/simulator/i);
    expect(pushReasonFor({ ...working, platform: "web" })).toMatch(/web app/i);
    expect(pushReasonFor({ ...working, hasProjectId: false })).toMatch(/project id/i);
  });

  it("puts the web build before everything else, because it never has push", () => {
    // A web build is not a device and is not Expo Go; whichever else is true, the
    // useful sentence is the one about the web.
    expect(pushReasonFor({ platform: "web", inExpoGo: true, isDevice: false, hasProjectId: false }))
      .toMatch(/web app/i);
  });

  it("refuses to register wherever there is a reason not to", () => {
    for (const env of [
      { ...working, inExpoGo: true },
      { ...working, isDevice: false },
      { ...working, platform: "web" },
      { ...working, hasProjectId: false },
    ]) {
      expect(canRegisterForPush(env)).toBe(false);
    }
  });

  it("always says the in-app list still works", () => {
    // The part somebody can rely on, and the part the platform warning omits.
    for (const env of [
      { ...working, inExpoGo: true },
      { ...working, isDevice: false },
      { ...working, platform: "web" },
    ]) {
      expect(pushReasonFor(env)).toMatch(/app's own list/);
    }
  });
});
