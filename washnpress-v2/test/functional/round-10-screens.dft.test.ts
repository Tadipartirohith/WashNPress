import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginAdmin, loginSupervisor, seedSlot } from "./helpers";

// The screens the admin and the supervisor actually work in, and what they are
// allowed to narrow by now that a society is the top of the chain.
//
// Each of these endpoints also carries the options its own filter row offers, so a
// screen renders its controls from the same reply that gave it the rows — rather
// than making three more calls and rendering a filter that names a block belonging
// to somebody else's society.

describe("DFT the users page", () => {
  it("manages supervisors, operators and residents, and not admins", async () => {
    // An admin account is managed through the platform's own administrative
    // configuration, not from a list where it sits between an operator and a
    // resident with a Deactivate button next to it.
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const listed = await app.inject({ method: "GET", url: "/v1/admin/users", headers: bearer(token) });
    expect(listed.statusCode).toBe(200);
    const roles = (listed.json().users as { roles: string[] }[]).flatMap((u) => u.roles);
    expect(roles).not.toContain("admin");
    expect(new Set(roles)).toContain("resident");
  });

  it("narrows by society, whether somebody works there or lives there", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const listed = await app.inject({
      method: "GET", url: "/v1/admin/users?societyId=soc-demo", headers: bearer(token),
    });
    expect(listed.statusCode).toBe(200);
    const rows = listed.json().users as { id: string; societyLabel: string | null }[];
    // The supervisor who runs it, the operator who works it, and the resident who
    // lives in it are all "in" My Home Bhooja, by three different routes.
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(["user-sup", "user-op", "user-res"]));
    expect(rows.every((r) => r.societyLabel === "My Home Bhooja")).toBe(true);
  });

  it("gives the table one column for a society and one for a block", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const listed = await app.inject({ method: "GET", url: "/v1/admin/users?role=resident", headers: bearer(token) });
    const resident = (listed.json().users as { id: string; societyLabel: string; blockName: string; unitNumber: string }[])
      .find((u) => u.id === "user-res")!;
    expect(resident.societyLabel).toBe("My Home Bhooja");
    expect(resident.blockName).toBe("A");
    expect(resident.unitNumber).toBe("A-402");
  });

  it("offers the societies its own filter names", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const listed = await app.inject({ method: "GET", url: "/v1/admin/users", headers: bearer(token) });
    expect((listed.json().societies as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("DFT the operators page", () => {
  it("narrows by society, block and availability together", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);

    const inSociety = await app.inject({
      method: "GET", url: "/v1/admin/operators?societyId=soc-demo", headers: bearer(token),
    });
    // The society is divided between two of them rather than handed to one.
    expect((inSociety.json().operators as { id: string }[]).map((o) => o.id).sort())
      .toEqual(["user-op", "user-op-3"]);

    // One covers A and B, the other covers C, so a block filter tells them apart.
    const onC = await app.inject({
      method: "GET", url: "/v1/admin/operators?blockId=block-demo-c", headers: bearer(token),
    });
    expect((onC.json().operators as { id: string }[]).map((o) => o.id)).toEqual(["user-op-3"]);

    const onA = await app.inject({
      method: "GET", url: "/v1/admin/operators?blockId=block-demo-a", headers: bearer(token),
    });
    expect((onA.json().operators as { id: string }[]).map((o) => o.id)).toEqual(["user-op"]);
  });

  it("narrows by the supervisor who answers for their work", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const mine = await app.inject({
      method: "GET", url: "/v1/admin/operators?supervisorUserId=user-sup", headers: bearer(token),
    });
    expect((mine.json().operators as { id: string }[]).map((o) => o.id).sort())
      .toEqual(["user-op", "user-op-3"]);
    const theirs = await app.inject({
      method: "GET", url: "/v1/admin/operators?supervisorUserId=user-sup-2", headers: bearer(token),
    });
    expect((theirs.json().operators as { id: string }[]).map((o) => o.id)).toEqual(["user-op-2"]);
  });

  it("offers the blocks of the society being looked at, and no others", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const listed = await app.inject({
      method: "GET", url: "/v1/admin/operators?societyId=soc-demo", headers: bearer(token),
    });
    const names = (listed.json().blocks as { name: string }[]).map((b) => b.name).sort();
    expect(names).toEqual(["A", "B", "C"]);
  });
});

describe("DFT the admin order list", () => {
  it("carries the block and the flat, which is where somebody actually goes", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-r10-1", 5);
    await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-r10-1" });
    const token = await loginAdmin(app);
    const listed = await app.inject({ method: "GET", url: "/v1/admin/orders", headers: bearer(token) });
    const row = (listed.json().orders as { blockName: string | null; unitNumber: string | null }[])[0];
    expect(row.blockName).toBe("A");
    expect(row.unitNumber).toBe("A-402");
  });

  it("narrows to a date range, and to a block", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-r10-2", 5);
    await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-r10-2" });
    const token = await loginAdmin(app);
    const today = new Date().toISOString().slice(0, 10);

    const inRange = await app.inject({
      method: "GET", url: `/v1/admin/orders?from=${today}&to=${today}`, headers: bearer(token),
    });
    expect((inRange.json().orders as unknown[]).length).toBeGreaterThan(0);

    const longAgo = await app.inject({
      method: "GET", url: "/v1/admin/orders?from=2020-01-01&to=2020-01-02", headers: bearer(token),
    });
    expect(longAgo.json().orders).toEqual([]);

    const wrongBlock = await app.inject({
      method: "GET", url: "/v1/admin/orders?blockId=block-demo-c", headers: bearer(token),
    });
    expect(wrongBlock.json().orders).toEqual([]);
  });
});

describe("DFT the supervisor order list", () => {
  it("offers only the blocks, operators and residents of their own society", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const listed = await app.inject({ method: "GET", url: "/v1/supervisor/orders", headers: bearer(token) });
    expect(listed.statusCode).toBe(200);
    const filters = listed.json().filters as {
      blocks: { name: string }[];
      operators: { id: string }[];
      residents: { id: string }[];
    };
    expect(filters.blocks.map((b) => b.name).sort()).toEqual(["A", "B", "C"]);
    expect(filters.operators.map((o) => o.id).sort()).toEqual(["user-op", "user-op-3"]);
    expect(filters.residents.map((r) => r.id)).toEqual(["res-demo"]);
  });

  it("narrows by block, operator, resident and a date range", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-r10-3", 5);
    await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-r10-3" });
    const token = await loginSupervisor(app);
    const today = new Date().toISOString().slice(0, 10);

    const mine = await app.inject({
      method: "GET", url: "/v1/supervisor/orders?blockId=block-demo-a", headers: bearer(token),
    });
    expect((mine.json().orders as unknown[]).length).toBeGreaterThan(0);

    for (const query of [
      "blockId=block-demo-c",
      "residentId=res-nobody",
      "operatorUserId=user-op-2",
      "from=2020-01-01&to=2020-01-02",
    ]) {
      const empty = await app.inject({
        method: "GET", url: `/v1/supervisor/orders?${query}`, headers: bearer(token),
      });
      expect(empty.json().orders, query).toEqual([]);
    }

    const byName = await app.inject({
      method: "GET", url: `/v1/supervisor/orders?resident=Anusha&from=${today}`, headers: bearer(token),
    });
    expect((byName.json().orders as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("DFT the admin dashboard and coverage", () => {
  it("compares societies rather than averaging them into corridors", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const dashboard = await app.inject({ method: "GET", url: "/v1/admin/dashboard", headers: bearer(token) });
    const rows = dashboard.json().societyPerformance as { name: string; supervisorName: string | null }[];
    const mine = rows.find((r) => r.name === "My Home Bhooja")!;
    expect(mine.supervisorName).toBe("Ravi Kumar");
    // A society nobody runs says so, rather than inheriting a name from a level
    // that no longer exists.
    expect(rows.find((r) => r.name === "Aparna Heights")!.supervisorName).toBeNull();
  });

  it("names the societies the admin is covering", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const coverage = await app.inject({ method: "GET", url: "/v1/admin/coverage", headers: bearer(token) });
    const needing = (coverage.json().needingCover as { societyName: string }[]).map((c) => c.societyName);
    expect(needing).toContain("Aparna Heights");
    expect(needing).not.toContain("My Home Bhooja");
  });
});
