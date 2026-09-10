import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config";
import { productionProblems, assertProductionReadiness } from "../../src/config/production-readiness";
import type { AppConfig } from "../../src/config";

// The defaults in config/default.json are all chosen for a laptop with nothing
// installed, and there was no production config file and nothing checking. So a
// deployment could boot from those defaults, report itself healthy, take real
// bookings against an in-memory store, hand every order to a payment provider that
// says yes to everything, and lose the lot on the first redeploy.
//
// These build on the real loader rather than a hand-written object, so a field that
// is renamed or a default that changes shows up here rather than in a deployment.
function config(overrides: (c: AppConfig) => void): AppConfig {
  const base = loadConfig({ reload: true, env: { WNP_APP__ENV: "test" } });
  const clone = structuredClone(base);
  overrides(clone);
  return clone;
}

// A production deployment with nothing left to complain about, used as the starting
// point for the single-problem cases below so each one tests exactly one thing.
function deployable(): AppConfig {
  return config((c) => {
    c.app.env = "production";
    c.app.corsOrigins = ["https://app.washnpress.example"];
    c.storage.driver = "postgres";
    c.notifications.sms.enabled = true;
    c.notifications.sms.provider = "msg91";
    c.payments.keyId = "rzp_live_xxxx";
    c.payments.keySecret = "secret";
    c.payments.webhookSecret = "a-real-secret-from-the-dashboard";
  });
}

describe("what is wrong with a deployment that calls itself production", () => {
  it("says nothing at all about a developer's machine", () => {
    // Development and test are meant to run on mocks. Complaining there is how you
    // teach everybody to ignore the complaint.
    expect(productionProblems(config((c) => { c.app.env = "development"; }))).toEqual([]);
    expect(productionProblems(config((c) => { c.app.env = "test"; }))).toEqual([]);
  });

  it("is silent about a production deployment that has everything", () => {
    expect(productionProblems(deployable())).toEqual([]);
  });

  it("refuses a production deployment whose data lives in the process", () => {
    const problems = productionProblems(config((c) => { c.app.env = "production"; c.storage.driver = "memory"; }));
    expect(problems.join(" ")).toMatch(/gone on the next restart/);
    // The message has to name the thing to set, or it is only an insult.
    expect(problems.join(" ")).toMatch(/DATABASE_URL/);
  });

  it("refuses a production deployment nobody can log in to", () => {
    // The OTP is the only way in for residents and staff alike, so a mocked SMS
    // gateway in production is a total outage that looks like a working deployment.
    const disabled = deployable(); disabled.notifications.sms.enabled = false;
    expect(productionProblems(disabled).join(" ")).toMatch(/no resident and no member of staff can sign in/);

    const mocked = deployable(); mocked.notifications.sms.provider = "mock";
    expect(productionProblems(mocked).join(" ")).toMatch(/no resident and no member of staff can sign in/);
  });

  it("refuses razorpay without credentials, because the fallback says every order is paid", () => {
    const noKey = deployable(); noKey.payments.keyId = "";
    expect(productionProblems(noKey).join(" ")).toMatch(/fake provider/);

    const noSecret = deployable(); noSecret.payments.keySecret = "";
    expect(productionProblems(noSecret).join(" ")).toMatch(/fake provider/);
  });

  it("refuses the webhook secret that is printed in this repository", () => {
    const placeholder = deployable();
    placeholder.payments.webhookSecret = "change-me-in-config-local-or-env";
    expect(productionProblems(placeholder).join(" ")).toMatch(/credit any wallet/);

    const empty = deployable(); empty.payments.webhookSecret = "";
    expect(productionProblems(empty).join(" ")).toMatch(/credit any wallet/);
  });

  it("refuses an API any website may call from a resident's browser", () => {
    const wildcard = deployable(); wildcard.app.corsOrigins = ["*"];
    expect(productionProblems(wildcard).join(" ")).toMatch(/corsOrigins/);
  });

  it("reports every problem at once rather than one per deploy attempt", () => {
    // Finding these one restart at a time is how a deployment window is spent.
    const nothing = config((c) => { c.app.env = "production"; });
    expect(productionProblems(nothing).length).toBeGreaterThanOrEqual(5);
  });
});

describe("refusing to start on an undeployable production configuration", () => {
  it("throws, naming every problem, and logs them one line at a time", () => {
    // One line per problem because a container platform shows the last few log lines,
    // and a five-problem stack trace is where they go to be ignored.
    const logged: unknown[] = [];
    const log = { error: (obj: unknown) => { logged.push(obj); } };
    expect(() => assertProductionReadiness(config((c) => { c.app.env = "production"; }), log))
      .toThrow(/Refusing to start/);
    expect(logged.length).toBeGreaterThanOrEqual(5);
  });

  it("lets a deployable configuration through without a word", () => {
    const logged: unknown[] = [];
    const log = { error: (obj: unknown) => { logged.push(obj); } };
    expect(() => assertProductionReadiness(deployable(), log)).not.toThrow();
    expect(logged).toEqual([]);
  });
});
