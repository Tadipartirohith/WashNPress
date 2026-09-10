// The identity and contact details the law makes us publish, in one place.
//
// India's Consumer Protection (E-Commerce) Rules 2020, Rule 4(5) requires a named
// grievance officer with contact details displayed on the platform, acknowledging a
// complaint within 48 hours and resolving it within a month. Rule 4(2) requires the
// legal entity name and registered address. Apple 5.1.1(v) and Google Play both
// require a privacy policy reachable without signing in. All of it is the same
// handful of facts, so it is stated once and read by the privacy page, the terms
// page, the account-deletion page, the footer and the resident app's Support screen.
//
// PLACEHOLDER — every value below is a stand-in and must be replaced with the real
// registered entity before any store submission. `LEGAL_DETAILS_ARE_PLACEHOLDER`
// exists so a page can say so out loud rather than presenting invented details as
// genuine: flip it to false in the same commit that fills these in.
export const LEGAL_DETAILS_ARE_PLACEHOLDER = true;

export const legal = {
  // Registered entity, exactly as incorporated.
  entityName: "Wash N Press Services Private Limited",
  brandName: "Wash N Press",
  registeredAddress: [
    "[Registered office address line 1]",
    "[Address line 2]",
    "[City] [PIN]",
    "Karnataka, India",
  ],
  cin: "[Corporate Identity Number]",
  gstin: "[GSTIN]",

  // Rule 4(5): a named person, not a team alias.
  grievanceOfficer: {
    name: "[Grievance Officer name]",
    designation: "Grievance Officer",
    email: "grievance@washnpress.example",
    phone: "+91 [10-digit number]",
    // The statutory clock. Stated so a resident knows what to expect and can hold
    // us to it, and so the page is not merely decorative compliance.
    acknowledgeWithinHours: 48,
    resolveWithinDays: 30,
  },

  // General support, distinct from the grievance channel — a grievance officer is an
  // escalation, not a helpdesk.
  supportEmail: "support@washnpress.example",

  // Shown as "Last updated" on the policy pages. Bump it when the wording changes;
  // a policy with a stale date is a policy nobody trusts.
  policyUpdated: "2026-09-10",
} as const;

export const registeredAddressLine = legal.registeredAddress.join(", ");
