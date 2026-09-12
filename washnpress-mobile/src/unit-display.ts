// How a resident's tower and flat are shown.
//
// A flat number used to carry its tower inside it — "A-402", "Tower 1-101" — and
// several screens then printed the tower beside it as well, so the same address
// read "Tower A · A-402". The tower and the flat are two things: the tower is its
// own field, and the flat is only the number on the door. The backend now stores
// bare numbers and converts old ones, but records written before that still
// arrive, so every screen passes a flat through here before showing it rather
// than trusting that it is already clean.
//
// Kept free of React so the rule can be tested on its own and shared by every
// portal.

// The words a society uses for a building in its complex. A name that already
// says one of them is shown as written; a bare "A" or "1" is given "Tower".
const BUILDING_WORD = /\b(tower|block|wing|phase)\b/i;
const LEADING_BUILDING_WORD = /^(tower|block|wing|phase)\s+/i;
// "Flat", "Flat no" and "Flat no." in front of the number say nothing the label
// does not already say.
const LEADING_FLAT_WORD = /^flat\b(\s*no\b\.?)?[\s:.-]*/i;
const SEPARATOR = /^[\s/-]+/;

function stripFlatWord(value: string): string {
  return value.replace(LEADING_FLAT_WORD, "").trim();
}

// Removes a leading copy of the tower, but only when a separator follows it, so
// flat 1101 in Tower 1 stays 1101 instead of losing its first digit.
function stripPrefix(value: string, prefix: string): string {
  if (!prefix || value.length <= prefix.length) return value;
  if (value.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return value;
  const rest = value.slice(prefix.length);
  if (!SEPARATOR.test(rest)) return value;
  const bare = rest.replace(SEPARATOR, "").trim();
  return bare || value;
}

// The number on the door, with any tower that was written into it taken out.
//
// The tower is matched both as it is named ("Tower 1") and by its short form
// ("1"), because old records were written both ways.
export function bareFlatNumber(unit?: string | null, towerName?: string | null): string {
  let value = stripFlatWord((unit ?? "").trim());
  const tower = (towerName ?? "").trim();
  if (tower) {
    const short = tower.replace(LEADING_BUILDING_WORD, "").trim();
    const before = value;
    value = stripPrefix(value, tower);
    if (value === before && short && short !== tower) value = stripPrefix(value, short);
    value = stripFlatWord(value);
  }
  return value;
}

// What a tower is called on screen: "Tower A" for a tower named "A", and a name
// that already says tower, block, wing or phase left exactly as the society wrote
// it. Screens never add "Tower " themselves, so nothing reads "Tower Tower 1".
export function towerLabel(name?: string | null): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "";
  return BUILDING_WORD.test(trimmed) ? trimmed : `Tower ${trimmed}`;
}

// A tower and a flat together, as one line: "Tower 1 · Flat 101". Whichever part
// is missing is left out rather than shown as a gap.
export function formatUnit(towerName?: string | null, unit?: string | null): string {
  const tower = towerLabel(towerName);
  const flat = bareFlatNumber(unit, towerName);
  return [tower, flat ? `Flat ${flat}` : ""].filter(Boolean).join(" · ");
}
