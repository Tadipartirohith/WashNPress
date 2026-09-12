import type { ResidentSubscriptionRow } from "../api/types";
import { bareFlatNumber, formatUnit } from "../unit-display";

// Which subscriptions the supervisor's list shows, and in what order.
//
// The screen this replaced was the plan catalogue — a supervisor could create and
// edit plans there. Plans belong to the business; what a supervisor needs is the
// other direction, which resident holds which plan, and it is read only.

export const SUBSCRIPTION_STATUSES = ["active", "paused", "cancelled", "expired"] as const;

// What is left of the allowance, or null when the plan does not cap it.
//
// Floored at zero: a resident who has been let past their allowance has none left,
// not minus three, and "-3 garments remaining" is a sentence nobody can act on.
export function remainingGarments(row: ResidentSubscriptionRow): number | null {
  if (row.garmentCap === null || row.garmentCap === undefined) return null;
  return Math.max(0, row.garmentCap - row.garmentsUsed);
}

export function subscriptionRows(
  rows: readonly ResidentSubscriptionRow[],
  filter: { search: string; status: string | null },
): ResidentSubscriptionRow[] {
  const needle = filter.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.status && row.status !== filter.status) return false;
    if (!needle) return true;
    // Searched by what a supervisor is given over the phone: a name, a flat, or the
    // plan somebody claims to be on. A flat is said in more than one way — "303",
    // "Tower C · Flat 303", or the old "C-303" — so each of them is matched.
    return [
      row.residentName, row.unitNumber, row.towerBlock, row.planName, row.planTier, row.residentPhone,
      ...unitSearchText(row.towerBlock, row.unitNumber),
    ].some((field) => (field ?? "").toLowerCase().includes(needle));
  });
}

// The ways a tower and flat may be typed into a search box.
function unitSearchText(tower: string | null, unit: string | null): string[] {
  const bare = bareFlatNumber(unit, tower);
  if (!bare) return [];
  const name = (tower ?? "").trim();
  const short = name.replace(/^(tower|block|wing|phase)\s+/i, "");
  return [bare, formatUnit(tower, unit), ...(name ? [`${name}-${bare}`, `${short}-${bare}`] : [])];
}

// What to call a plan on screen.
//
// A plan has a name the admin wrote and a tier that is a slug — "premium_care" —
// and the tier was what the resident's own Plan page showed, upper-cased, to the
// person paying for it. The tier is the fallback rather than the label, and only
// for plans made before names existed.
export function planLabel(name: string | null | undefined, tier: string): string {
  const trimmed = (name ?? "").trim();
  return trimmed || tier;
}
