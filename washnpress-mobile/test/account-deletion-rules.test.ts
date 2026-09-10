import { describe, it, expect } from "vitest";
import {
  CONFIRMATION_WORD, confirmationMatches, deletionBlocked, deletionConsequences,
  type AccountStanding,
} from "../src/portals/account-deletion-rules";

// Apple's 5.1.1(v) requires an in-app route to deleting an account. There was only
// Sign out. But the part that generates the support ticket is not the missing
// button — it is somebody closing an account with money in the wallet and a bag of
// clothes already collected.

function standing(over: Partial<AccountStanding> = {}): AccountStanding {
  return { walletBalancePaise: 0, hasActivePlan: false, ordersInFlight: 0, ...over };
}

describe("proving it was meant", () => {
  it("accepts the word", () => {
    expect(confirmationMatches(CONFIRMATION_WORD)).toBe(true);
  });

  it("forgives what a phone keyboard does to it", () => {
    // Autocapitalisation and a trailing space are the keyboard's doing, not the
    // person's. The gate exists to prove intent, not to test typing.
    expect(confirmationMatches("delete")).toBe(true);
    expect(confirmationMatches("Delete ")).toBe(true);
    expect(confirmationMatches("  DELETE  ")).toBe(true);
  });

  it("refuses anything that is not it", () => {
    expect(confirmationMatches("")).toBe(false);
    expect(confirmationMatches("d")).toBe(false);
    expect(confirmationMatches("delete my account")).toBe(false);
    expect(confirmationMatches("yes")).toBe(false);
  });
});

describe("what this person is about to lose", () => {
  it("always says it cannot be undone", () => {
    expect(deletionConsequences(standing()).join(" ")).toMatch(/cannot be undone/i);
  });

  it("leads with the money, with a figure on it", () => {
    // "This cannot be undone" is on every destructive dialog anybody has ever seen.
    // A balance is the line that is actually read.
    const said = deletionConsequences(standing({ walletBalancePaise: 45000 }));
    expect(said.join(" ")).toContain("450");
  });

  it("says nothing about a wallet with nothing in it", () => {
    expect(deletionConsequences(standing()).join(" ")).not.toMatch(/wallet/i);
  });

  it("mentions the plan only while one is being paid for", () => {
    expect(deletionConsequences(standing({ hasActivePlan: true })).join(" ")).toMatch(/plan/i);
    expect(deletionConsequences(standing()).join(" ")).not.toMatch(/allowance/i);
  });

  it("puts garments the company is holding first, and counts them properly", () => {
    expect(deletionConsequences(standing({ ordersInFlight: 1 }))[0]).toContain("1 order");
    expect(deletionConsequences(standing({ ordersInFlight: 3 }))[0]).toContain("3 orders");
  });

  it("says what survives the deletion, before it is confirmed", () => {
    // The backend keeps the ledger and the collection records behind it, unlinked.
    // Telling somebody afterwards that not everything went is how a deletion becomes
    // a complaint.
    expect(deletionConsequences(standing()).join(" ")).toMatch(/kept/i);
    expect(deletionConsequences(standing()).join(" ")).toMatch(/tax/i);
  });

  it("copes with a standing nothing could be learned about", () => {
    // The dashboard call failed; the deletion must still be possible.
    const said = deletionConsequences(standing({ walletBalancePaise: null }));
    expect(said.length).toBeGreaterThan(0);
    expect(said.join(" ")).not.toMatch(/null|NaN|undefined/);
  });
});

describe("when the account should not be closed yet", () => {
  it("stops while the company is holding somebody's clothes", () => {
    // The one standing that is not the resident's to write off: closing the account
    // leaves a bag with no account to return it to.
    expect(deletionBlocked(standing({ ordersInFlight: 1 }))).toBe(true);
  });

  it("does not stop for money or a plan, which are the resident's to give up", () => {
    expect(deletionBlocked(standing({ walletBalancePaise: 99900, hasActivePlan: true }))).toBe(false);
  });

  it("does not stop an ordinary account", () => {
    expect(deletionBlocked(standing())).toBe(false);
  });
});
