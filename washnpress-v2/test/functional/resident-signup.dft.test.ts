import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer } from "./helpers";
import { flatsOfBlock } from "../../src/domain/assignment";

// The resident sign-up form asks for a date of birth and an email as well as the
// address, and offers only the societies an admin has made active.

describe("resident sign-up", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];

  beforeEach(async () => { ({ app, container } = await makeTestApp()); });

  async function newResident(phone: string) {
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

  async function address() {
    const block = (await container.store.blocks.find((b) => b.societyId === "soc-demo"))[0];
    return { societyId: "soc-demo", blockId: block.id, unitNumber: block.flats?.[0]?.number ?? flatsOfBlock(block)[0] };
  }

  async function comingSoonSociety() {
    const demo = (await container.store.societies.get("soc-demo"))!;
    await container.store.societies.put({ ...demo, id: "soc-soon", name: "Not Yet Open", status: "coming_soon" });
  }

  it("keeps the date of birth and email it was given", async () => {
    const token = await newResident("9899100001");
    const res = await onboard(token, {
      fullName: "Signed Up", email: "signed.up@example.com", dateOfBirth: "1990-05-17", ...(await address()),
    });
    expect(res.statusCode).toBe(201);
    const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: bearer(res.json().token) });
    expect(me.json().user.dateOfBirth).toBe("1990-05-17");
    expect(me.json().user.email).toBe("signed.up@example.com");
  });

  it("refuses a date of birth in the future or one that is not a day", async () => {
    const token = await newResident("9899100002");
    for (const dateOfBirth of ["2999-01-01", "1990-02-31", "17/05/1990"]) {
      const res = await onboard(token, { fullName: "Signed Up", dateOfBirth, ...(await address()) });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_request");
    }
  });

  it("offers only active societies, signed in or not", async () => {
    await comingSoonSociety();
    const token = await newResident("9899100003");
    const onboarding = await app.inject({ method: "GET", url: "/v1/resident/onboarding", headers: bearer(token) });
    const offered = (onboarding.json().societies as { id: string }[]).map((s) => s.id);
    expect(offered).toContain("soc-demo");
    expect(offered).not.toContain("soc-soon");

    const listed = await app.inject({ method: "GET", url: "/v1/societies" });
    const publicIds = (listed.json().societies as { id: string; status: string }[]);
    expect(publicIds.map((s) => s.id)).not.toContain("soc-soon");
    expect(publicIds.every((s) => s.status === "active")).toBe(true);
  });

  it("refuses sign-up into a society that is not active", async () => {
    await comingSoonSociety();
    const token = await newResident("9899100004");
    const res = await onboard(token, { fullName: "Too Early", societyId: "soc-soon", unitNumber: "A-101" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("onboarding_failed");
  });
});
