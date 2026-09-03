import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginAdmin } from "./helpers";

// A service name is how one service is told from another, on the admin's own list and
// on every booking made against it, so no two services may share one. The check is on
// the normalised name — trimmed and folded to lower case — and it holds at the API,
// not only in the form, because two admins can reach Create at the same moment with
// the same name in front of each of them.

const base = { category: "other", unit: "pair", unitPricePaise: 15000 };

async function create(
  app: Awaited<ReturnType<typeof makeTestApp>>["app"], token: string, name: string,
) {
  return app.inject({
    method: "POST", url: "/v1/admin/services", headers: bearer(token),
    payload: JSON.stringify({ ...base, name }),
  });
}

describe("DFT a service name belongs to one service", () => {
  it("refuses a second service with a name already in use", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    expect((await create(app, token, "Shoe cleaning")).statusCode).toBe(201);
    const clash = await create(app, token, "Shoe cleaning");
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toBe("service_name_taken");
    expect(clash.json().message).toContain("already exists");
  });

  it("recognises the same name across case and surrounding space", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    expect((await create(app, token, "Window Cleaning")).statusCode).toBe(201);
    expect((await create(app, token, "window cleaning")).statusCode).toBe(409);
    expect((await create(app, token, "   WINDOW CLEANING   ")).statusCode).toBe(409);
  });

  it("refuses editing a service onto a name another service holds", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    expect((await create(app, token, "Sofa shampoo")).statusCode).toBe(201);
    const second = await create(app, token, "Boot polish");
    const id = second.json().service.id as string;
    const clash = await app.inject({
      method: "PATCH", url: `/v1/admin/services/${id}`, headers: bearer(token),
      payload: JSON.stringify({ name: "sofa shampoo" }),
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toBe("service_name_taken");
  });

  it("lets a service keep its own name when edited", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await create(app, token, "Ironing at home");
    const id = created.json().service.id as string;
    const edited = await app.inject({
      method: "PATCH", url: `/v1/admin/services/${id}`, headers: bearer(token),
      payload: JSON.stringify({ name: "Ironing at home", unitPricePaise: 20000 }),
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().service.unitPricePaise).toBe(20000);
  });
});
