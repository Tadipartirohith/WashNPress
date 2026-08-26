// The layout rules, as arithmetic rather than as styles.
//
// Two things had gone wrong across the portals and neither was really a styling
// problem. Dropdown lists were drawn inside the form they belonged to, so they were
// painted behind the field below them and clipped by whatever container had an
// overflow set — the list was there, it just could not be seen or reached. And every
// field was full width whatever it held, so a screen asking for six prices was six
// full-width boxes each holding four characters, and a wall of whitespace beside them.
//
// Both are decisions about numbers: where a list goes given where its field is, and
// how wide a field should be given what goes in it. Kept here, they can be read and
// tested without rendering anything.

export type Breakpoint = "mobile" | "tablet" | "desktop";

// The two places the layout changes. A phone in landscape and a small tablet are
// the same thing as far as any of these screens are concerned.
export const TABLET_MIN = 700;
export const DESKTOP_MIN = 1040;

export function breakpointFor(width: number): Breakpoint {
  if (width >= DESKTOP_MIN) return "desktop";
  if (width >= TABLET_MIN) return "tablet";
  return "mobile";
}

export interface ColumnRule { desktop: number; tablet: number; mobile: number }

// How many cards fit in a row. Given as an explicit rule per screen because the
// requirements differ: supervisors are three across on a desktop, QC records four,
// orders two.
export function columnsFor(width: number, rule: ColumnRule): number {
  const chosen = breakpointFor(width) === "desktop" ? rule.desktop
    : breakpointFor(width) === "tablet" ? rule.tablet
      : rule.mobile;
  return Math.max(1, Math.round(chosen));
}

// The width one card gets, as a fraction of the row, leaving room for the gaps
// between them. Returned as a percentage so the row still reflows if the window
// changes between renders.
export function cardBasisPercent(columns: number): number {
  const safe = Math.max(1, columns);
  // Two percent of the row per gap, which at any realistic width is a gap of
  // roughly the same size as the padding inside the card.
  const gaps = (safe - 1) * 2;
  return (100 - gaps) / safe;
}

// What a field is for decides how wide it is. A price is four characters; a
// description is a paragraph. Using one width for both is what produced screens
// that were mostly empty box.
export type FieldWidth = "small" | "medium" | "wide" | "full";

export const FIELD_WIDTHS: Record<FieldWidth, number> = {
  // ₹30, a count, a percentage.
  small: 110,
  // A dropdown, a date, a code. Wide enough for a name and a caret.
  medium: 190,
  // A search box: people type sentences into these.
  wide: 300,
  full: Number.POSITIVE_INFINITY,
};

// The width to actually use, given how much room there is. On a narrow screen the
// rule is two across where the fields are small enough for it and one across when
// they are not — never a horizontal scroll, and never a field wider than the screen.
export function fieldWidth(kind: FieldWidth, available: number): number {
  const gutter = 10;
  if (kind === "full") return available;
  const wanted = FIELD_WIDTHS[kind];
  if (wanted > available) return available;
  if (available < TABLET_MIN) {
    // On a phone: two small fields side by side beat one field and a gap, and a
    // search box takes the row, because leaving fifty points of nothing beside it
    // is the whitespace this is meant to remove.
    if (kind === "wide") return available;
    const half = (available - gutter) / 2;
    if (wanted <= half) return half;
  }
  return wanted;
}

export interface Rect { x: number; y: number; width: number; height: number }

export interface Placement {
  left: number; top: number; width: number; maxHeight: number;
  // Whether the list had to open upwards because there was no room below.
  above: boolean;
}

// Where a dropdown's list goes.
//
// Directly under its field, at least as wide as the field, never off the left or
// right edge of the screen, and flipped above the field when there is more room
// there than below it. The list is drawn in an overlay rather than inside the form,
// so nothing in the form can paint over it or clip it; this decides where in the
// overlay it lands.
export function placeDropdown(
  anchor: Rect,
  window: { width: number; height: number },
  options: { count: number; rowHeight?: number; minWidth?: number; margin?: number } = { count: 0 },
): Placement {
  const rowHeight = options.rowHeight ?? 44;
  const margin = options.margin ?? 8;
  const gap = 4;

  const width = Math.min(
    Math.max(anchor.width, options.minWidth ?? 180),
    Math.max(120, window.width - margin * 2),
  );
  // Kept on screen: a field near the right edge does not push its list off it.
  const left = Math.max(margin, Math.min(anchor.x, window.width - width - margin));

  const wanted = Math.max(rowHeight, options.count * rowHeight);
  const below = window.height - (anchor.y + anchor.height) - gap - margin;
  const above = anchor.y - gap - margin;
  // Below by default, because that is where people look. Above only when there is
  // genuinely more room there — a field near the bottom of a phone screen.
  const flip = below < wanted && above > below;
  const room = flip ? above : below;
  const maxHeight = Math.max(rowHeight, Math.min(wanted, room));

  return {
    left,
    top: flip ? anchor.y - gap - maxHeight : anchor.y + anchor.height + gap,
    width,
    maxHeight,
    above: flip,
  };
}
