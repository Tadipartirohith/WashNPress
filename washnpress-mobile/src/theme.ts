import type { TextStyle } from "react-native";

// The design tokens. One source, three tiers, and every screen in both apps reads
// from it.
//
// There was a palette here before, and a spacing scale, and that was all. Type
// sizes, radii, weights, shadows and durations were typed into whichever
// StyleSheet needed them, which is how the application ended up with thirteen font
// sizes, nine corner radii and two shadows that shared no relationship. None of
// those numbers was wrong on its own. Together they read as assembled rather than
// designed.
//
// Worse, the palette itself did not pass. Fifteen of twenty-six colour pairs in
// daily use failed WCAG 2.2 AA, including the label on the primary button — white
// on the old aqua measured 2.93:1 against a 4.5 requirement. That is not a
// refinement, it is the most-pressed control in the product being hard to read.
//
// The three tiers:
//
//   palette   the raw values. Never referenced from a component.
//   light     purpose-named tokens. What screens and components use.
//   theme     the resolved surface a component imports.
//
// Every pair below is measured rather than judged by eye; `npm run verify:contrast`
// reads this file and fails the build if one of them regresses.

// ---------------------------------------------------------------- 1. primitives

// A neutral ramp with a teal cast rather than a grey one, so the neutrals belong to
// the same family as the brand instead of sitting beside it. Pure black and pure
// white appear nowhere in text: #000 on #fff is the tell of an interface nobody
// chose the colours for.
const palette = {
  ink: {
    950: "#0C1F1F",
    900: "#122A2A",
    800: "#1C3B3B",
    700: "#2B4E4E",
    600: "#41595A",
    500: "#5C7476",
    400: "#749393",
    300: "#93A9A8",
    200: "#BFCFCE",
    150: "#DDE5E4",
    100: "#E7EDEC",
    50: "#F1F5F4",
    25: "#F8FAFA",
  },
  // The brand. The old #00A8A8 survives only as the lightest step, where it is
  // decoration; everything that carries text or state is drawn from 700 and below.
  teal: {
    900: "#04403F",
    800: "#08514F",
    700: "#0B6161",
    600: "#0E7472",
    500: "#12908D",
    300: "#6FC9C6",
    200: "#A8DAD8",
    100: "#DDEDEC",
    50: "#EEF6F5",
  },
  green: { 700: "#0F6B43", 500: "#1B8A5A", 100: "#E8F4EE" },
  amber: { 700: "#8A5300", 500: "#B57400", 100: "#FBF0DC" },
  red: { 700: "#A81E16", 500: "#C8352C", 100: "#FBEAE8" },
  blue: { 700: "#1F5CA8", 100: "#E7EFFA" },
  violet: { 700: "#5A3EB8" },
  white: "#FFFFFF",
} as const;

// ------------------------------------------------------------- 2. semantic light

export const light = {
  text: {
    // Not black. A near-black carrying the brand's own hue, which is what makes a
    // page read as designed rather than as a default.
    primary: palette.ink[950], //   17.05:1 on a card
    secondary: palette.ink[600], //  7.50:1
    tertiary: palette.ink[500], //   4.98:1 — the old muted grey measured 3.76
    disabled: palette.ink[300],
    onAction: palette.white, //      7.25:1 on the primary fill
    onInverse: palette.teal[100],
    link: palette.teal[700],
  },
  surface: {
    // The page sits below the cards rather than beside them, so a card lifts by
    // being lighter than its ground. That is the whole depth mechanism here:
    // layered surfaces and hairlines, not a shadow under every box.
    page: palette.ink[50],
    card: palette.white,
    raised: palette.white,
    sunken: palette.ink[100],
    // The app bar, and the one card on the resident dashboard that carries the
    // plan. Brand, not ink: this is where the brand belongs.
    inverse: palette.teal[900],
    scrim: "rgba(9, 26, 26, 0.55)",
  },
  border: {
    // Decorative separation between surfaces. Deliberately quiet.
    subtle: palette.ink[150],
    // Anything that draws the boundary of a control the eye has to find: an input,
    // a toggle track. WCAG 2.2 asks 3:1 of these and the old #E4E9E9 gave 1.23.
    strong: palette.ink[400], //     3.31:1 on a card
    focus: palette.teal[700],
  },
  action: {
    primary: palette.teal[700],
    primaryPressed: palette.teal[800],
    secondaryBorder: palette.teal[700],
    secondaryPressed: palette.teal[50],
    destructive: palette.red[700],
    destructivePressed: palette.red[100],
  },
  brand: {
    solid: palette.teal[700],
    deep: palette.teal[900],
    tint: palette.teal[100],
    tintFaint: palette.teal[50],
  },
  feedback: {
    successText: palette.green[700],
    successSolid: palette.green[500],
    successTint: palette.green[100],
    warningText: palette.amber[700],
    warningSolid: palette.amber[500],
    warningTint: palette.amber[100],
    dangerText: palette.red[700],
    dangerSolid: palette.red[500],
    dangerTint: palette.red[100],
    infoText: palette.blue[700],
    infoTint: palette.blue[100],
  },
} as const;

// -------------------------------------------------------------- 3. semantic dark
//
// Designed rather than inverted: dark surfaces step *up* to show elevation, the
// brand desaturates so it does not glare, and every pair here is measured the same
// way the light set is.
//
// Not yet switched on. Both apps declare `userInterfaceStyle: "light"`, and turning
// this on means every StyleSheet becoming a hook, which is a change to how all
// thirty-nine screens render rather than a change to what they look like. The map
// is authored so that work is a wiring job and not a colour job.
export const dark = {
  text: {
    primary: "#E8F0EF",
    secondary: "#A9BFBE",
    tertiary: "#87A09F",
    disabled: "#5C7476",
    // Ink, not white. A dark interface wants a bright accent, and a bright accent
    // wants dark text on it — white on a mid teal is the pairing that reads as
    // washed out in every dark mode that got this wrong.
    onAction: "#062020",
    onInverse: "#E8F0EF",
    link: "#4FD1CE",
  },
  surface: {
    page: "#0A1414",
    card: "#132020",
    raised: "#1B2B2B",
    sunken: "#060F0F",
    inverse: "#1B2B2B",
    scrim: "rgba(0, 0, 0, 0.66)",
  },
  border: {
    subtle: "#233636",
    strong: "#688685",
    focus: "#4FD1CE",
  },
  action: {
    primary: "#4FD1CE",
    primaryPressed: "#6FD9D6",
    secondaryBorder: "#4FD1CE",
    secondaryPressed: "#16302F",
    destructive: "#FF8B82",
    destructivePressed: "#33150F",
  },
  brand: {
    solid: "#4FD1CE",
    deep: "#04403F",
    tint: "#16302F",
    tintFaint: "#101F1F",
  },
  feedback: {
    successText: "#5FD39B",
    successSolid: "#2FA06D",
    successTint: "#10281E",
    warningText: "#F0B44E",
    warningSolid: "#B57400",
    warningTint: "#2C2109",
    dangerText: "#FF8B82",
    dangerSolid: "#C8352C",
    dangerTint: "#2E1512",
    infoText: "#7FB2F5",
    infoTint: "#111F30",
  },
} as const;

// ------------------------------------------------------------------- 4. spacing
//
// Outer is larger than inner, always. The page had 12 at its edge and 12 inside
// every card, which is the one hierarchy that must never be flat: with both the
// same, a card does not sit *in* a page, it sits *against* it.
export const space = {
  // Between a label and its own control.
  tight: 4,
  // Between two things that belong together: rows in a card, a button and the
  // field above it.
  snug: 8,
  // The default gap between separate things: two cards, two fields.
  base: 12,
  // Inside a card.
  card: 14,
  // Around the edge of a page. Larger than the card padding it contains.
  page: 16,
  // Above a heading that starts a new section. The one place a large gap earns
  // itself: it is what tells the eye a new thing has started.
  section: 24,
  // Between major blocks of a screen.
  block: 32,
} as const;

// ---------------------------------------------------------------- 5. typography
//
// Nine styles, each a complete instruction — size, leading, weight and tracking
// together — rather than a font size somebody pairs with a weight by hand. There
// were thirteen sizes in use before, four of them differing by a single point.
//
// Tracking tightens as type grows and opens up on small capitals, which is what
// keeps a heading from looking loose and a label from looking cramped.
export const type = {
  display: { fontSize: 30, lineHeight: 34, fontWeight: "800", letterSpacing: -0.7 },
  title: { fontSize: 23, lineHeight: 28, fontWeight: "800", letterSpacing: -0.45 },
  heading: { fontSize: 18, lineHeight: 23, fontWeight: "700", letterSpacing: -0.2 },
  subheading: { fontSize: 15, lineHeight: 20, fontWeight: "700", letterSpacing: -0.1 },
  body: { fontSize: 15, lineHeight: 21, fontWeight: "500", letterSpacing: 0 },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: "700", letterSpacing: 0 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "600", letterSpacing: 0 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "500", letterSpacing: 0 },
  // Eyebrows and table headers. Small capitals need the extra tracking or they set
  // as a smudge.
  overline: { fontSize: 11, lineHeight: 14, fontWeight: "700", letterSpacing: 0.9 },
  // A dashboard number. Lining figures of equal width, so a column of them does
  // not shuffle sideways as the counts change.
  metric: { fontSize: 26, lineHeight: 30, fontWeight: "800", letterSpacing: -0.6 },
} as const satisfies Record<string, TextStyle>;

// Figures that keep their column. Worth applying to anything counted or priced.
export const tabular: TextStyle = { fontVariant: ["tabular-nums"] };

// ------------------------------------------------------------------- 6. shape
//
// One radius language. Nine different corner radii were in use, several of them a
// point apart, which reads as accidental because it was.
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const border = { hairline: 1, focus: 2 } as const;

// ---------------------------------------------------------------- 7. elevation
//
// Three levels, and most surfaces use the first. Depth here comes from a card
// being lighter than its page and edged with a hairline; a shadow is reserved for
// something that genuinely floats above the page and has to be read as temporary.
export const elevation = {
  flat: {},
  // A dropdown opened over the page.
  raised: {
    shadowColor: palette.ink[950],
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  // A modal, with the page put out of reach behind it.
  overlay: {
    shadowColor: palette.ink[950],
    shadowOpacity: 0.22,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 14 },
    elevation: 24,
  },
} as const;

// -------------------------------------------------------------------- 8. motion
export const motion = {
  // A press acknowledging itself. Anything slower is felt as lag.
  fast: 120,
  base: 180,
  slow: 260,
} as const;

export const opacity = {
  disabled: 0.42,
  pressed: 0.72,
  scrim: 0.55,
} as const;

// --------------------------------------------------------------------- 9. size
//
// A touch target is 44 across, everywhere, without exception. The counter buttons
// were 34 and the tab strip about 33, which is small enough that missing one is
// ordinary rather than unlucky.
export const size = {
  touch: 44,
  control: { sm: 36, md: 44, lg: 52 },
  icon: { sm: 16, md: 20, lg: 24 },
} as const;

// ------------------------------------------------------- 10. the resolved theme
//
// What a component imports. The flat names in the second half are the ones the
// four portals were written against; they are kept, and pointed at the corrected
// values, so a screen written a year ago reads the new palette without being
// touched. New code should prefer the grouped names above them.
export const theme = {
  text: light.text,
  surface: light.surface,
  line: light.border,
  action: light.action,
  brand: light.brand,
  feedback: light.feedback,

  // Convenience aliases, flattened, in the shape the portals already use.
  textPrimary: light.text.primary,
  textSecondary: light.text.secondary,
  textTertiary: light.text.tertiary,
  textOnAction: light.text.onAction,
  surfacePage: light.surface.page,
  surfaceCard: light.surface.card,
  surfaceInverse: light.surface.inverse,
  borderSubtle: light.border.subtle,
  borderStrong: light.border.strong,

  // ---- the names the existing screens use -------------------------------
  // Kept as written, remapped to values that pass. `aqua` and `deepTeal` are no
  // longer the colours they were named after: aqua is the brand at the weight text
  // can sit on, and deepTeal is the near-black the headings actually want. The
  // brand as a surface is `surfaceInverse`.
  aqua: light.brand.solid,
  deepTeal: light.text.primary,
  ice: light.brand.tint,
  amber: light.feedback.warningText,
  white: palette.white,
  slate: light.text.secondary,
  bg: light.surface.page,
  muted: light.text.tertiary,
  border: light.border.subtle,
  danger: light.feedback.dangerText,
  success: light.feedback.successText,
} as const;

// One colour per order state, so a status reads the same in every portal. Each is
// checked against a card and against the page, because a pill appears on both.
//
// Built from whichever semantic map is in play rather than from fixed values: a
// state pill is text, and text that was chosen for a white card is unreadable on a
// dark one. Two states share a hue with a third — washing and collected are both
// the transit blue — because they are the same thing to whoever is reading the
// list, and inventing a fourth hue to keep them apart would be colour for its own
// sake.
type Semantic = typeof light;

export function stateColorsFor(t: Semantic): Record<string, string> {
  const transit = t === light ? palette.blue[700] : "#7FB2F5";
  const pressing = t === light ? palette.violet[700] : "#B49BFF";
  return {
    scheduled: t.brand.solid,
    picked_up: transit,
    in_wash: transit,
    ironing: pressing,
    qc: t.feedback.warningText,
    qc_hold: t.feedback.dangerText,
    ready_for_delivery: t.feedback.successText,
    out_for_delivery: t.feedback.successText,
    delivered: t.feedback.successText,
    pickup_failed: t.feedback.dangerText,
    cancelled: t.text.tertiary,
    disputed: t.feedback.dangerText,
    // Not an order state: a pickup still waiting from an earlier day.
    overdue: t.feedback.dangerText,
  };
}

export const stateColor: Record<string, string> = stateColorsFor(light);

export const stateLabel: Record<string, string> = {
  overdue: "Overdue",
  scheduled: "Scheduled",
  picked_up: "Picked Up",
  in_wash: "Washing",
  ironing: "Ironing",
  qc: "QC",
  qc_hold: "QC Failed",
  ready_for_delivery: "Ready for Delivery",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  pickup_failed: "Pickup Failed",
  cancelled: "Cancelled",
  disputed: "Disputed",
};

export function labelFor(state: string): string {
  return stateLabel[state] ?? state.replace(/_/g, " ");
}

export function rupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "—";
  return `₹${(paise / 100).toFixed(2).replace(/\.00$/, "")}`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString(undefined, { day: "2-digit", month: "short" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

export function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
