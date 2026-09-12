import { describe, it, expect } from "vitest";
import { makeTestApp, loginSupervisor, loginResident, bearer } from "./helpers";
import { backfillBareFlatNumbers } from "../../src/services/unit-backfill";

// A tower and a flat are two things. The flat number used to carry its tower
// ("A-402") while the tower's layout listed the bare flat ("402"), so the seeded
// resident's flat showed as free to the supervisor and was offered to the next person
// signing up. These hold the pieces that were broken by that mismatch.

describe("DFT flat numbers written before the tower was its own field", () => {
  it("are made bare on boot, and a second run changes nothing", async () => {
    const { container } = await makeTestApp();
    const resident = (await container.store.residents.get("res-demo"))!;
    const block = (await container.store.blocks.get("block-demo-a"))!;
    await container.store.residents.put({ ...resident, unitNumber: "A-402" });
    await container.store.blocks.put({
      ...block,
      flats: (block.flats ?? []).map((f) => (f.number === "101" ? { ...f, number: "A-101" } : f)),
    });

    const first = await backfillBareFlatNumbers(container.store);
    expect(first).toEqual({ residentsMadeBare: 1, blocksMadeBare: 1 });
    expect((await container.store.residents.get("res-demo"))!.unitNumber).toBe("402");
    const flats = (await container.store.blocks.get("block-demo-a"))!.flats ?? [];
    expect(flats.map((f) => f.number)).toContain("101");
    expect(flats.some((f) => f.number.includes("-"))).toBe(false);

    const second = await backfillBareFlatNumbers(container.store);
    expect(second).toEqual({ residentsMadeBare: 0, blocksMadeBare: 0 });
  });
});

describe("DFT a lived-in flat is lived in, however its number was written", () => {
  for (const stored of ["402", "A-402"]) {
    it(`reads occupied to the supervisor and is not offered at sign-up (stored "${stored}")`, async () => {
      const { app, container } = await makeTestApp();
      const resident = (await container.store.residents.get("res-demo"))!;
      await container.store.residents.put({ ...resident, unitNumber: stored });

      const supervisor = await loginSupervisor(app);
      const res = await app.inject({ method: "GET", url: "/v1/supervisor/blocks/block-demo-a/flats", headers: bearer(supervisor) });
      expect(res.statusCode).toBe(200);
      const flat = (res.json().floors as { flats: { number: string; status: string }[] }[])
        .flatMap((f) => f.flats).find((f) => f.number === "402")!;
      expect(flat.status).toBe("occupied");

      const token = await loginResident(app, "9899300001");
      const onboarding = await app.inject({ method: "GET", url: "/v1/resident/onboarding", headers: bearer(token) });
      const towerA = (onboarding.json().societies as { id: string; blocks: { id: string; flats: { number: string }[] }[] }[])
        .find((s) => s.id === "soc-demo")!.blocks.find((b) => b.id === "block-demo-a")!;
      expect(towerA.flats.map((f) => f.number)).not.toContain("402");
      expect(towerA.flats.map((f) => f.number)).toContain("401");
    });
  }
});

describe("DFT a supervisor finds a resident by their flat, however it is typed", () => {
  it("matches the bare flat, the legacy form and the written form", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    for (const q of ["402", "A-402", "Tower A 402", "Tower A · Flat 402"]) {
      const res = await app.inject({ method: "GET", url: `/v1/supervisor/search?q=${encodeURIComponent(q)}`, headers: bearer(token) });
      const found = res.json().residents as { id: string; unitNumber: string; blockName: string }[];
      const row = found.find((r) => r.id === "res-demo");
      expect(row, q).toBeTruthy();
      expect(row!.unitNumber).toBe("402");
      expect(row!.blockName).toBe("A");
    }
  });
});
