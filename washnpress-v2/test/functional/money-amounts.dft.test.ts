import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer, loginAdmin, loginResident } from "./helpers";

// ST1-I106. Every money field was `nonnegative()` and several defaulted to zero, so a
// garment could be saved at ₹0 and sold for nothing, and a plan could be published
// free. Zero is not a cheap price; it is a price that bills nothing while somebody
// still collects, washes and delivers the garments.
//
// Money is held in whole paise, so a rupee amount arrives multiplied by a hundred.
// The refusal for a fraction has to say that, because an admin typing 99.50 into a
// Price box has no way of knowing the field is not in rupees.

const MESSAGES = {
  required: (label: string) => `${label} is required.`,
  notANumber: (label: string) => `Enter a valid ${label.toLowerCase()}.`,
  negative: (label: string) => `${label} cannot be negative.`,
  zero: (label: string) => `${label} must be greater than ₹0.`,
  fraction: (label: string) => `${label} must be a whole number of paise (₹1 = 100 paise).`,
};

// A plan the domain is happy with apart from its price: a plan with no services in
// it is refused for that, which would hide what this is testing.
const PLAN = {
  tier: "Trial", name: "Trial", garmentCap: 20, turnaroundHours: 48,
  services: [
    { serviceId: "wash_iron", serviceName: "Wash and Iron", unit: "kg", includedQuantity: 40, frequency: "daily", frequencyDays: [], carryForward: false, additionalUsage: "pay_per_use", additionalRatePaise: 5000 },
  ],
};

describe("what a money field will accept", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let admin: string;

  beforeEach(async () => {
    ({ app } = await makeTestApp());
    admin = await loginAdmin(app);
  });

  // Each entry is one money field on one route: a body that is valid apart from the
  // amount, and the label the message should use.
  const fields = () => [
    {
      name: "garment service price",
      label: "Price",
      send: (amount: unknown) => app.inject({
        method: "POST", url: "/v1/admin/config/services", headers: bearer(admin),
        payload: JSON.stringify({ name: "Starch and Press", unitPricePaise: amount }),
      }),
    },
    {
      name: "garment service price, edited",
      label: "Price",
      send: (amount: unknown) => app.inject({
        method: "PATCH", url: "/v1/admin/config/services/iron_only", headers: bearer(admin),
        payload: JSON.stringify({ unitPricePaise: amount }),
      }),
    },
    {
      name: "garment category item price",
      label: "Price",
      send: (amount: unknown) => app.inject({
        method: "POST", url: "/v1/admin/garment-categories", headers: bearer(admin),
        payload: JSON.stringify({ name: "Winter wear", status: "active", items: [{ name: "Coat", pricePaise: amount }] }),
      }),
    },
    {
      name: "pay-as-you-go garment rate",
      label: "Rate",
      send: (amount: unknown) => app.inject({
        method: "PATCH", url: "/v1/admin/config", headers: bearer(admin),
        payload: JSON.stringify({ nonSubscriberGarmentRatePaise: amount }),
      }),
    },
    {
      name: "subscription plan price",
      label: "Plan price",
      send: (amount: unknown) => app.inject({
        method: "POST", url: "/v1/admin/plans", headers: bearer(admin),
        payload: JSON.stringify({ ...PLAN, monthlyPaise: amount }),
      }),
    },
    {
      name: "additional service price",
      label: "Price",
      send: (amount: unknown) => app.inject({
        method: "POST", url: "/v1/admin/services", headers: bearer(admin),
        payload: JSON.stringify({ name: "Shoe cleaning", category: "other", unit: "pair", unitPricePaise: amount }),
      }),
    },
    {
      name: "additional charge",
      label: "Amount",
      send: (amount: unknown) => app.inject({
        method: "POST", url: "/v1/admin/charges", headers: bearer(admin),
        payload: JSON.stringify({ name: "Express handling", chargingType: "per_order", amountPaise: amount }),
      }),
    },
  ];

  it("refuses ₹0", async () => {
    for (const field of fields()) {
      const response = await field.send(0);
      expect(response.statusCode, field.name).toBe(400);
      expect(response.json().message, field.name).toBe(MESSAGES.zero(field.label));
    }
  });

  it("refuses a negative amount", async () => {
    for (const field of fields()) {
      const response = await field.send(-100);
      expect(response.statusCode, field.name).toBe(400);
      expect(response.json().message, field.name).toBe(MESSAGES.negative(field.label));
    }
  });

  it("refuses a fraction of a paise, and says the field is in paise", async () => {
    for (const field of fields()) {
      const response = await field.send(99.5);
      expect(response.statusCode, field.name).toBe(400);
      expect(response.json().message, field.name).toBe(MESSAGES.fraction(field.label));
    }
  });

  it("refuses something that is not a number at all", async () => {
    for (const field of fields()) {
      const response = await field.send("1200");
      expect(response.statusCode, field.name).toBe(400);
      expect(response.json().message, field.name).toBe(MESSAGES.notANumber(field.label));
    }
  });

  it("refuses an amount left out where one is required", async () => {
    // Only the create routes: a patch leaves out what it is not changing.
    for (const field of fields().filter((f) => !f.name.includes("edited") && !f.name.includes("rate"))) {
      const response = await field.send(undefined);
      expect(response.statusCode, field.name).toBe(400);
      expect(response.json().message, field.name).toBe(MESSAGES.required(field.label));
    }
  });

  it("accepts a real price", async () => {
    for (const field of fields()) {
      const response = await field.send(12500);
      expect([200, 201], `${field.name}: ${response.payload}`).toContain(response.statusCode);
    }
  });

  it("names the field as well as the problem", async () => {
    // `details.fieldErrors` is what a form highlighting one box reads; `message` is
    // the line of text under the button. Both, on the same refusal.
    const response = await app.inject({
      method: "POST", url: "/v1/admin/plans", headers: bearer(admin),
      payload: JSON.stringify({ ...PLAN, monthlyPaise: 0 }),
    });
    expect(response.json().error).toBe("invalid_request");
    expect(response.json().details.fieldErrors.monthlyPaise).toContain("Plan price must be greater than ₹0.");
  });

  it("holds for a price hidden inside a nested list", async () => {
    // Per-category prices are a record, and the price of an add-on is one field of
    // one element of an array. Both were `nonnegative()` and both are a garment or a
    // service somebody pays for.
    const perCategory = await app.inject({
      method: "POST", url: "/v1/admin/config/services", headers: bearer(admin),
      payload: JSON.stringify({ name: "Starch and Press", unitPricePaise: 4000, pricesPaise: { Sarees: 0 } }),
    });
    expect(perCategory.statusCode).toBe(400);
    expect(perCategory.json().message).toBe("Price must be greater than ₹0.");

    const addOn = await app.inject({
      method: "POST", url: "/v1/admin/services", headers: bearer(admin),
      payload: JSON.stringify({
        name: "Shoe cleaning", category: "other", unit: "pair", unitPricePaise: 15000,
        addOns: [{ id: "polish", name: "Polish", pricePaise: 0, isActive: true }],
      }),
    });
    expect(addOn.statusCode).toBe(400);
    expect(addOn.json().message).toBe("Price must be greater than ₹0.");
  });

  it("refuses a wallet top-up of nothing", async () => {
    const resident = await loginResident(app);
    const response = await app.inject({
      method: "POST", url: "/v1/wallet/topup", headers: bearer(resident),
      payload: JSON.stringify({ amountPaise: 0 }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe("Amount must be greater than ₹0.");
  });

  it("still lets a fee be nothing, because nothing is what a free cancellation costs", async () => {
    // The line between the two: a price of zero bills nothing for work that is done,
    // a fee of zero is a policy of not charging for something. Only the first is the
    // bug, and turning the second into an error would make "cancelling is free"
    // impossible to configure.
    const response = await app.inject({
      method: "PATCH", url: "/v1/admin/config", headers: bearer(admin),
      payload: JSON.stringify({ cancellationFeePaise: 0, rescheduleFeePaise: 0 }),
    });
    expect(response.statusCode).toBe(200);

    const negative = await app.inject({
      method: "PATCH", url: "/v1/admin/config", headers: bearer(admin),
      payload: JSON.stringify({ cancellationFeePaise: -1 }),
    });
    expect(negative.statusCode).toBe(400);
    expect(negative.json().message).toBe("Cancellation fee cannot be negative.");
  });
});
