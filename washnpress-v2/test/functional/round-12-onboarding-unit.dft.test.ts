import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer } from "./helpers";
import { flatsOfBlock, unitBelongsToBlock } from "../../src/domain/assignment";

// Onboarding gave a new resident a list of towers and then a text box for the
// flat, so the one part of the address that decides who collects from them was
// typed: "A-402", "402", "Flat 402" and "a 402" all arrived, none of them checked
// against the tower that had just been chosen.
//
// It asks in three dependent lists now — tower, floor, flat — drawn from the
// structure the supervisor configured. These cover the half of that which matters
// when the request does not come from the screen.

describe("the flats of a tower", () => {
  it("follows the address the platform already uses", () => {
    // Tower A: ten floors, forty flats. Four to a floor, and the seeded resident
    // lives in the second one on the fourth.
    const a = { name: "A", floorCount: 10, flatCount: 40 };
    expect(flatsOfBlock(a)).toContain("A-402");
    expect(flatsOfBlock(a)).toHaveLength(40);
  });

  it("stops at the flats that exist", () => {
    const odd = { name: "B", floorCount: 3, flatCount: 10 };
    const flats = flatsOfBlock(odd);
    expect(flats).toHaveLength(10);
    expect(flats).toContain("B-302");
    // The third floor holds two, not four.
    expect(flats).not.toContain("B-303");
  });

  it("accepts anything from a tower whose flats were never counted", () => {
    const unconfigured = { name: "C" };
    expect(unitBelongsToBlock(unconfigured, "whatever-99")).toBe(true);
  });

  it("refuses another floor's flat and another tower's flat", () => {
    const a = { name: "A", floorCount: 10, flatCount: 40 };
    expect(unitBelongsToBlock(a, "A-402")).toBe(true);
    expect(unitBelongsToBlock(a, "A-409")).toBe(false);
    expect(unitBelongsToBlock(a, "B-402")).toBe(false);
  });
});

describe("onboarding checks the unit against the tower", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];

  beforeEach(async () => { ({ app, container } = await makeTestApp()); });

  // A brand-new resident: signing in for the first time leaves them needing to
  // onboard.
  async function newResident(phone = "9899000001") {
    const send = await app.inject({
      method: "POST", url: "/v1/auth/otp/send", headers: { "content-type": "application/json" },
      payload: JSON.stringify({ phone }),
    });
    const verify = await app.inject({
      method: "POST", url: "/v1/auth/otp/verify", headers: { "content-type": "application/json" },
      payload: JSON.stringify({ phone, otp: send.json().otpForTesting }),
    });
    expect(verify.statusCode).toBe(200);
    return verify.json().token as string;
  }

  const onboard = (token: string, body: Record<string, unknown>) => app.inject({
    method: "POST", url: "/v1/auth/onboarding", headers: bearer(token),
    payload: JSON.stringify(body),
  });

  it("offers each tower with how it is built, so the lists can be derived", async () => {
    const token = await newResident("9899000009");
    const res = await app.inject({ method: "GET", url: "/v1/resident/onboarding", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const society = (res.json().societies as Array<Record<string, unknown>>).find((s) => s.id === "soc-demo")!;
    const blocks = society.blocks as Array<{ name: string; floorCount: number; flatCount: number }>;
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      expect(typeof b.floorCount).toBe("number");
      expect(typeof b.flatCount).toBe("number");
    }
  });

  it("accepts a flat that belongs to the chosen tower", async () => {
    const token = await newResident("9899000002");
    const block = (await container.store.blocks.find((b) => b.societyId === "soc-demo"))[0];
    const flat = flatsOfBlock(block)[0];
    const res = await onboard(token, {
      fullName: "New Resident", societyId: "soc-demo", blockId: block.id,
      unitNumber: flat, address: "Somewhere", pickupAddress: "Somewhere",
    });
    expect(res.statusCode).toBe(201);
  });

  it("refuses a flat that is not in that tower", async () => {
    const token = await newResident("9899000003");
    const block = (await container.store.blocks.find((b) => b.societyId === "soc-demo"))[0];
    const res = await onboard(token, {
      fullName: "New Resident", societyId: "soc-demo", blockId: block.id,
      unitNumber: `${block.name}-9999`, address: "Somewhere", pickupAddress: "Somewhere",
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("unit_outside_block");
  });

  it("refuses a tower belonging to another society", async () => {
    const token = await newResident("9899000004");
    const other = (await container.store.blocks.find((b) => b.societyId !== "soc-demo"))[0];
    if (!other) return;
    const res = await onboard(token, {
      fullName: "New Resident", societyId: "soc-demo", blockId: other.id,
      unitNumber: flatsOfBlock(other)[0], address: "Somewhere", pickupAddress: "Somewhere",
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("block_outside_society");
  });

  it("still onboards a resident whose society has no towers recorded", async () => {
    // Nothing to check against, so a written answer is taken. Being unable to
    // sign up because a supervisor has not finished the structure would be the
    // platform's problem, not the resident's.
    const token = await newResident("9899000005");
    const res = await onboard(token, {
      fullName: "New Resident", societyId: "soc-demo",
      unitNumber: "Whatever they typed", address: "Somewhere", pickupAddress: "Somewhere",
    });
    expect(res.statusCode).toBe(201);
  });
});
