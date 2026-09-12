// A flat number never carries its tower. "Tower 1-101" is two things — the tower
// (Tower 1) and the flat (101) — and every page shows them as two things. The same
// three rules live in the backend and the mobile apps, so a resident reads the same
// address wherever they look.
//
// Older records still have the tower baked into the flat ("A-402", "Tower 1-101"),
// so a flat is always normalised before it is shown rather than trusted as stored.
//
//   bareFlatNumber("A-402", "A")                 → "402"
//   bareFlatNumber("Tower 1-101", "Tower 1")     → "101"
//   bareFlatNumber("1-101", "Tower 1")           → "101"
//   bareFlatNumber("North Wing-201", "North Wing") → "201"
//   bareFlatNumber("402", "A")                   → "402"
//   bareFlatNumber("Flat A-204", "A")            → "204"
//   bareFlatNumber("a 301", "A")                 → "301"
//   bareFlatNumber("A/401", "A")                 → "401"
//   bareFlatNumber("101", null)                  → "101"
//   bareFlatNumber("1101", "Tower 1")            → "1101"
//
//   towerLabel("A") → "Tower A"      towerLabel("Tower 1") → "Tower 1"
//   towerLabel("1") → "Tower 1"      towerLabel("North Wing") → "North Wing"
//   towerLabel("East") → "Tower East"  towerLabel("Block C") → "Block C"
//
//   formatUnit("Tower 1", "101") → "Tower 1 · Flat 101"
//   formatUnit("A", "A-402")     → "Tower A · Flat 402"
//   formatUnit(null, "101")      → "Flat 101"

const TOWER_WORD = /\b(tower|block|wing|phase)\b/i;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Removes `prefix` and the separator after it, but only if something is left. */
function stripPrefix(value: string, prefix: string): string | null {
  if (!prefix) return null;
  const match = new RegExp(`^${escapeRegExp(prefix)}[-\\s/]+`, "i").exec(value);
  if (!match) return null;
  const rest = value.slice(match[0].length).trim();
  return rest ? rest : null;
}

/** The flat on its own: "A-402" in tower "A" is flat "402". */
export function bareFlatNumber(unit?: string | null, towerName?: string | null): string {
  let value = (unit ?? "").trim();
  value = value.replace(/^flat\b(\s*no\b\.?)?\s*/i, "").trim() || value;
  const tower = (towerName ?? "").trim();
  if (!tower || !value) return value;
  // The tower as written, then its short form ("Tower 1" is often just "1" on a door).
  const short = tower.replace(/^(tower|block|wing|phase)\b\s*/i, "").trim();
  return stripPrefix(value, tower) ?? (short !== tower ? stripPrefix(value, short) : null) ?? value;
}

/** "A" reads as "Tower A"; a name that already says what it is stays as it is. */
export function towerLabel(name?: string | null): string {
  const value = (name ?? "").trim();
  if (!value) return "";
  return TOWER_WORD.test(value) ? value : `Tower ${value}`;
}

/** "Tower 1 · Flat 101", or whichever half is known. */
export function formatUnit(towerName?: string | null, unit?: string | null): string {
  const tower = towerLabel(towerName);
  const flat = bareFlatNumber(unit, towerName);
  return [tower, flat ? `Flat ${flat}` : ""].filter(Boolean).join(" · ");
}

/**
 * Everything a person might type to find this flat: the stored value, the bare
 * number, the displayed "Tower A · Flat 402", and the old "A-402" shape — so a
 * search keeps working on both old and new records.
 */
export function unitSearchText(towerName?: string | null, unit?: string | null): string {
  const bare = bareFlatNumber(unit, towerName);
  const tower = (towerName ?? "").trim();
  return [unit ?? "", bare, formatUnit(towerName, unit), tower && bare ? `${tower}-${bare}` : ""].join(" ");
}
