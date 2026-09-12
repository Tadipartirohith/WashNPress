// A resident's tower and a resident's flat are two things, not one string.
//
// For a while the flat number carried its tower in front of it ("A-402", "Tower
// 1-101") while the tower's own layout listed the bare flat ("402"). Every
// comparison between the two then had to guess, and the guesses disagreed: an
// occupied flat was offered to the next person signing up, and a resident showed on
// no floor. The flat number is now always bare, the tower is always its own field,
// and the two are only put together when a sentence is written for a person to read.
//
// Both functions here are pure, and the web and mobile apps implement exactly the
// same rules, so a flat reads the same on every screen.

// The words a society puts in front of a tower's name. A name that already has one
// is a label in its own right; a bare "A" or "1" is not.
const TOWER_WORD = /\b(tower|block|wing|phase)\b/i;
const LEADING_TOWER_WORD = /^(tower|block|wing|phase)\b\s*/i;
// "Flat 402", "Flat no 402", "flat no. 402".
const LEADING_FLAT_WORD = /^flat\b(\s*no\b\.?)?\s*/i;
// What may sit between a tower and its flat in a legacy value or a written label.
const SEPARATOR = /^[\s\-/·]+/;

function towerLabel(towerName: string | null | undefined): string {
  const name = (towerName ?? "").trim();
  if (!name) return "";
  return TOWER_WORD.test(name) ? name : `Tower ${name}`;
}

/**
 * The flat number alone, whatever an older client or an older record wrote.
 *
 * "A-402" in tower "A" is flat "402"; so is "Flat A-204" → "204" and "Tower 1-101" or
 * "1-101" in "Tower 1" → "101". A tower copy is only removed when a separator follows
 * it and something is left after it, so "1101" in "Tower 1" stays "1101": the digits
 * of a flat are never mistaken for its tower.
 */
export function bareFlatNumber(unit: string, towerName?: string | null): string {
  let value = (unit ?? "").trim().replace(LEADING_FLAT_WORD, "");
  const name = (towerName ?? "").trim();
  if (name) {
    const short = name.replace(LEADING_TOWER_WORD, "").trim();
    // Longest first, so "Tower 1" is removed whole rather than leaving "Tower" behind.
    const candidates = [...new Set([towerLabel(name), name, short].filter(Boolean))]
      .sort((a, b) => b.length - a.length);
    for (const candidate of candidates) {
      if (value.toLowerCase().startsWith(candidate.toLowerCase())) {
        const rest = value.slice(candidate.length);
        const separator = rest.match(SEPARATOR);
        const remainder = separator ? rest.slice(separator[0].length) : "";
        if (separator && remainder) {
          value = remainder.replace(LEADING_FLAT_WORD, "");
          break;
        }
      }
    }
  }
  return value.trim();
}

/**
 * A tower and a flat as a person reads them: "Tower 1 · Flat 101".
 *
 * A tower name that already says what it is ("Block C", "North Wing") is used as it
 * is; a bare "A" or "1" becomes "Tower A". Either part may be missing, and then only
 * the other is written.
 */
export function formatUnit(towerName?: string | null, flatNumber?: string | null): string {
  const tower = towerLabel(towerName);
  const bare = flatNumber ? bareFlatNumber(flatNumber, towerName) : "";
  const flat = bare ? `Flat ${bare}` : "";
  return [tower, flat].filter(Boolean).join(" · ");
}
