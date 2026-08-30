import type { Portal } from "./api/types";

// Which portals belong to which of the two applications.
//
// The split is a store concern rather than a security one — the backend refuses
// what a role may not reach, and did so before either app existed. What this
// decides is which app is the right *place* for an account, so somebody who
// installs the wrong one is told which to get instead of being shown a blank
// screen or, worse, a portal their phone is not the right device for.
//
// Pure, so it can be read and tested without an Expo runtime around it.

export type AppVariant = "resident" | "staff";

export const PORTALS_IN_APP: Record<AppVariant, Portal[]> = {
  // A consumer app. One portal, and nothing behind a role nobody outside the
  // company can be given.
  resident: ["resident"],
  // An internal tool. Three portals, because an operator, a supervisor and an
  // admin are the same person's colleagues on the same shift and splitting them
  // into three listings would be three apps to install and three to keep updated.
  staff: ["operations", "supervisor", "admin"],
};

export const APP_NAMES: Record<AppVariant, string> = {
  resident: "Wash N Press",
  staff: "Wash N Press Staff",
};

export function servesPortal(variant: AppVariant, portal: Portal): boolean {
  return PORTALS_IN_APP[variant].includes(portal);
}

export function otherVariant(variant: AppVariant): AppVariant {
  return variant === "resident" ? "staff" : "resident";
}

// What to say to somebody who signed in successfully and still cannot be shown
// anything. Their credentials are right and their account is fine; they are simply
// holding the wrong app, and the message has to say that rather than implying they
// did something wrong.
export function wrongAppMessage(variant: AppVariant, portal: Portal): string {
  const wanted = APP_NAMES[otherVariant(variant)];
  return portal === "resident"
    ? `This is ${APP_NAMES[variant]}, for Wash N Press staff. Your account is a resident account. Install ${wanted} to book and track your laundry.`
    : `This is ${APP_NAMES[variant]}, the app for residents. Your account is a staff account. Install ${wanted} to work your collections and orders.`;
}
