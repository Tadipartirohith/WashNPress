import { describe, it, expect } from "vitest";
import { markForService } from "../src/portals/service-mark-rules";

// The icon set covers verbs — a truck, a clock, a check — and has nothing that says
// "this is the washing one and that is the car one". Four rows in a service list are
// scanned by shape before a word is read, so each line gets a drawn mark.
//
// Choosing which one is not simply reading the stored kind. The catalogue only ever
// had two kinds, and anything built in the wizard inherits `vehicle_wash` as a
// default — so a sofa cleaning service arrives claiming to be a car wash.

describe("which mark a service gets", () => {
  it("trusts an ironing kind, because nothing else claims it", () => {
    expect(markForService("home_ironing", "At-home ironing")).toBe("iron");
    expect(markForService("home_ironing", "Anything at all")).toBe("iron");
  });

  it("draws a car for the services that are actually vehicles", () => {
    expect(markForService("vehicle_wash", "Car wash")).toBe("vehicle");
    expect(markForService("vehicle_wash", "Bike wash")).toBe("vehicle");
    expect(markForService("vehicle_wash", "Scooter cleaning")).toBe("vehicle");
  });

  it("does not draw a car beside a sofa merely because of the default kind", () => {
    // The failure this exists to prevent. A wizard-built service carries
    // `vehicle_wash` whatever it is, and a car next to "Sofa shampoo" is worse than
    // no mark at all.
    expect(markForService("vehicle_wash", "Sofa shampoo")).toBe("wash");
    expect(markForService("vehicle_wash", "Curtain dry clean")).toBe("wash");
    expect(markForService("vehicle_wash", "Shirt pressing")).toBe("iron");
  });

  it("will not assert a vehicle on the strength of the default kind alone", () => {
    // "Premium package" and "Sofa shampoo" are the same case: an unrecognised name
    // under a kind that gets inherited rather than chosen. Neither can produce a
    // car, or the guard above would only work for the nouns somebody thought of.
    expect(markForService("vehicle_wash", "Premium package")).toBe("wash");
  });

  it("reads the name when there is no kind at all", () => {
    // Garment services and plan lines carry no kind.
    expect(markForService(null, "Car wash")).toBe("vehicle");
    expect(markForService(undefined, "Ironing, per piece")).toBe("iron");
    expect(markForService(null, "Wash and fold")).toBe("wash");
  });

  it("falls back to laundry, which is the business", () => {
    expect(markForService(null, "")).toBe("wash");
    expect(markForService(null, "Something nobody anticipated")).toBe("wash");
  });

  it("does not care about case or surrounding words", () => {
    expect(markForService(null, "PREMIUM CAR DETAILING")).toBe("vehicle");
    expect(markForService(null, "Steam press — express")).toBe("iron");
  });
});
