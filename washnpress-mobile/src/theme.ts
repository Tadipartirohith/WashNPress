import type { TextStyle } from "react-native";

// The design tokens. One source, three tiers, and every screen in both apps reads
// from it.
//
//   palette   the raw values. Never referenced from a component.
//   light     purpose-named tokens. What screens and components use.
//   theme     the resolved surface a component imports.
//
// Every colour pair is measured rather than judged by eye; `npm run verify:contrast`
// reads this file and fails the build if one of them regresses.
//
// ---------------------------------------------------------------------------
// Porcelain and Petrol
//
// The palette this replaced was correct and safe, and safe was the problem. One
// teal did all the work, and because a white label had to survive on it, that teal
// could never be brighter than a certain darkness. Every button, every link, every
// selected state and every heading came out the same muted colour. Correct, and
// completely without a voice.
//
// The move is to stop making the brand carry the button:
//
//   the primary action is ink, near-black, the way an expensive product does it;
//   the brand is jade, freed to be alive because it no longer needs 4.5:1 on white;
//   the brand *surface* is petrol, a deep blue-teal, for the app bar and the one
//   card on the resident dashboard that should feel like the product.
//
// And the neutrals carry a faint blue cast rather than a grey or a warm one. That
// is not decoration: optical brightener is the thing that makes laundered whites
// read as white, and a laundry product whose porcelain is very slightly blue is
// making a quiet argument about itself. It also keeps the page clear of the
// beige-and-brass palette that every premium consumer brief drifts into.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------- 1. primitives

const palette = {
  // Porcelain. A cool neutral ramp with a blue cast, not grey and not warm.
  ink: {
    950: "#0B1016",
    900: "#131A22",
    800: "#1D2630",
    700: "#2A3542",
    600: "#3E4A59",
    500: "#556376",
    400: "#768496",
    300: "#9FADBC",
    200: "#C4CFDA",
    // The three ground steps sit deeper than they did. A card lifting off the page
    // was the whole depth mechanism and it was not working: porcelain to white was
    // 1.08:1, a seven per cent step, so every card was being held up by its hairline
    // alone and the page read flat. It is 1.17:1 now, and the hairline deepened with
    // it or it would have vanished into the new ground.
    150: "#D3DDE5",
    100: "#DCE5EB",
    50: "#E8EEF2",
  },
  // The brand, at two weights that live in different places. 700 is dark enough to
  // be read as text on porcelain; 500 is the alive one, and it belongs on the
  // petrol surfaces and in tints, never as small text on white.
  jade: {
    // 800 exists so the primary button has somewhere to go under a finger. A near
    // black button had to lighten when pressed; a mid jade can properly darken.
    800: "#08514A",
    700: "#0C6A60",
    500: "#14A99A",
    400: "#2BC4B4",
    100: "#DDF3F0",
    50: "#EEF9F7",
  },
  // The branded surface. Deep enough that porcelain text sits on it at 12.5:1 and
  // the alive jade reads as an accent rather than as a clash.
  petrol: {
    900: "#0A2F39",
    800: "#0E3E4A",
    950: "#06232B",
  },
  green: { 700: "#0A6B4E", 500: "#12855F", 100: "#E2F4EC" },
  amber: { 700: "#8A5000", 500: "#B06A00", 100: "#FBEFDB" },
  red: { 700: "#B0231C", 500: "#CF3229", 100: "#FCEAE9" },
  blue: { 700: "#1D57A8", 100: "#E6EEFA" },
  violet: { 700: "#5B3FBF" },
  white: "#FFFFFF",
} as const;

// ------------------------------------------------------------- 2. semantic light

export const light = {
  text: {
    primary: palette.ink[950], //   19.09:1 on a card
    secondary: palette.ink[600], //  9.02:1
    tertiary: palette.ink[500], //   5.69:1
    disabled: palette.ink[300],
    onAction: palette.white, //     19.09:1 on the ink action
    onInverse: "#EAF2F4", //        12.52:1 on petrol
    link: palette.jade[700], //      6.12:1 on a card
  },
  surface: {
    // A card lifts by being lighter than its ground. That is the whole depth
    // mechanism: layered surfaces and hairlines, not a shadow under every box.
    page: palette.ink[50],
    card: palette.white,
    raised: palette.white,
    sunken: palette.ink[100],
    // Where the brand actually lives. The app bar, and the one card on the resident
    // dashboard that carries their plan.
    inverse: palette.petrol[900],
    inverseDeep: palette.petrol[950],
    scrim: "rgba(6, 12, 18, 0.58)",
  },
  border: {
    subtle: palette.ink[150],
    // Anything drawing the boundary of a control the eye has to find. 3.52:1 on a
    // card, which is what WCAG 2.2 asks of a control boundary.
    strong: palette.ink[400],
    focus: palette.jade[700],
  },
  action: {
    // Brand, not ink.
    //
    // This was a near-black primary, on the reasoning that it looks expensive and
    // keeps the contrast problem away from the brand colour. Both halves were true
    // and the result was still wrong: with the action in ink, the only place jade
    // could appear in light mode was link text, so the product rendered as white
    // cards on cool grey with a black button and no brand on screen at all.
    //
    // Jade 700 carries white at 6.47:1, which is past the 4.5:1 a button label
    // needs, so the contrast worry the ink was avoiding does not arise. Destructive
    // stays red and the inverse surfaces stay petrol; only the affirmative action
    // moves.
    primary: palette.jade[700],
    // A mid jade has room to darken under a finger, which is the direction a press
    // should go. The near-black it replaced had to lighten instead.
    primaryPressed: palette.jade[800],
    secondaryBorder: palette.jade[700],
    secondaryPressed: palette.jade[50],
    destructive: palette.red[700],
    destructivePressed: palette.red[100],
  },
  brand: {
    // The one that can be read as text on porcelain.
    solid: palette.jade[700],
    // The alive one. Only on petrol, or as a fill where no text sits.
    vivid: palette.jade[500],
    onInverse: palette.jade[400],
    deep: palette.petrol[900],
    tint: palette.jade[100],
    tintFaint: palette.jade[50],
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
// Designed rather than inverted. Surfaces step up to show elevation, and the action
// inverts: on a dark page the brand becomes the button and takes ink text, because
// a white label on a mid jade is the pairing that reads as washed out.
//
// Not yet switched on. Both apps declare `userInterfaceStyle: "light"`, and turning
// this on means every StyleSheet becoming a hook, which changes how all thirty-nine
// screens render rather than what they look like. The map is authored so that work
// is a wiring job and not a colour job.
export const dark = {
  text: {
    primary: "#E6EDF3",
    secondary: "#A7B6C6",
    tertiary: "#8595A6",
    disabled: "#5A6879",
    onAction: "#04181C",
    onInverse: "#E6EDF3",
    link: palette.jade[400],
  },
  surface: {
    page: "#070E12",
    card: "#101922",
    raised: "#18232E",
    sunken: "#040A0D",
    inverse: "#18232E",
    inverseDeep: "#040A0D",
    scrim: "rgba(0, 0, 0, 0.68)",
  },
  border: {
    subtle: "#1F2B36",
    strong: "#5E7180",
    focus: palette.jade[400],
  },
  action: {
    primary: palette.jade[400],
    primaryPressed: "#4FD6C8",
    secondaryBorder: palette.jade[400],
    secondaryPressed: "#12262B",
    destructive: "#FF8F86",
    destructivePressed: "#2E1512",
  },
  brand: {
    solid: palette.jade[400],
    vivid: palette.jade[400],
    onInverse: palette.jade[400],
    deep: palette.petrol[950],
    tint: "#12262B",
    tintFaint: "#0C1A1E",
  },
  feedback: {
    successText: "#5AD4A0",
    successSolid: "#2AA477",
    successTint: "#0C231A",
    warningText: "#EDB25A",
    warningSolid: "#B06A00",
    warningTint: "#2A1F08",
    dangerText: "#FF8F86",
    dangerSolid: "#CF3229",
    dangerTint: "#2C1412",
    infoText: "#83B4F5",
    infoTint: "#0F1D30",
  },
} as const;

// ------------------------------------------------------------------- 4. spacing
//
// Outer is larger than inner, always. The page had 12 at its edge and 12 inside
// every card, which is the one hierarchy that must never be flat: with both the
// same, a card does not sit *in* a page, it sits *against* it.
export const space = {
  tight: 4,
  snug: 8,
  base: 12,
  card: 14,
  page: 16,
  section: 24,
  block: 32,
} as const;

// The same scale, tightened, for surfaces that exist to be compared rather than read.
//
// One codebase builds both applications, which is right for logic and wrong for
// density. A resident opens the app twice a week with one question and wants room to
// breathe; an operator lives in it for a shift and wants forty rows on screen at
// once. Whitespace on the staff side is scrolling, and scrolling is time.
//
// Deliberately not a second design system: colour, radius, type and motion are
// identical either way, and only the gaps move. `src/density.ts` resolves which one
// this build gets; nothing else has to know.
export const compactSpace = {
  tight: 2,
  snug: 5,
  base: 8,
  card: 9,
  page: 12,
  section: 16,
  block: 22,
} as const;

// Widened on purpose. Both scales are `as const`, so their literal types disagree
// on every key — a scale is a set of numbers with these names, not these numbers.
export type SpaceScale = Record<keyof typeof space, number>;

// ---------------------------------------------------------------- 5. typography
//
// Geist, self-hosted through expo-font, with Geist Mono for anything that has to
// line up in a column.
//
// A native app running on whatever the device happens to call its system font is
// the loudest tell that nobody chose anything: the same screen is Roboto on one
// phone and SF on another, and neither was a decision. Geist is a grotesque with
// unusually even numerals, which matters here because most of what these screens
// show is counts, money and order codes.
//
// React Native will not synthesise a weight for a custom family the way a browser
// does. `fontWeight: "700"` beside a custom `fontFamily` is silently ignored on
// Android, so weight is expressed by picking the file. Never add a fontWeight to
// one of these styles; change the family instead.
export const font = {
  regular: "Geist_400Regular",
  medium: "Geist_500Medium",
  semi: "Geist_600SemiBold",
  bold: "Geist_700Bold",
  black: "Geist_800ExtraBold",
  mono: "GeistMono_500Medium",
  monoSemi: "GeistMono_600SemiBold",
} as const;

// Ten styles, each a complete instruction, rather than a size somebody pairs with a
// weight by hand. Tracking tightens as type grows and opens up on small capitals,
// which is what keeps a heading from looking loose and a label from looking cramped.
export const type = {
  // A number somebody is meant to feel rather than read. The balance on a wallet,
  // the garments in an order.
  display: { fontFamily: font.black, fontSize: 40, lineHeight: 44, letterSpacing: -1.4 },
  title: { fontFamily: font.black, fontSize: 25, lineHeight: 30, letterSpacing: -0.7 },
  heading: { fontFamily: font.bold, fontSize: 18, lineHeight: 23, letterSpacing: -0.35 },
  subheading: { fontFamily: font.bold, fontSize: 15, lineHeight: 20, letterSpacing: -0.2 },
  body: { fontFamily: font.medium, fontSize: 15, lineHeight: 21, letterSpacing: -0.1 },
  bodyStrong: { fontFamily: font.semi, fontSize: 15, lineHeight: 21, letterSpacing: -0.1 },
  label: { fontFamily: font.semi, fontSize: 13, lineHeight: 18, letterSpacing: -0.05 },
  caption: { fontFamily: font.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0 },
  // Eyebrows and table headers. Small capitals need the extra tracking or they set
  // as a smudge.
  overline: { fontFamily: font.semi, fontSize: 11, lineHeight: 14, letterSpacing: 0.7 },
  // A dashboard number.
  metric: { fontFamily: font.black, fontSize: 27, lineHeight: 31, letterSpacing: -0.9 },
} as const satisfies Record<string, TextStyle>;

// Figures that keep their column, and codes that read as codes. Mono rather than a
// font feature, because `tabular-nums` is honoured on one platform and ignored on
// the other, and a column that lines up on iOS only is not a column.
export const mono: TextStyle = { fontFamily: font.mono };
export const monoStrong: TextStyle = { fontFamily: font.monoSemi };

// ------------------------------------------------------------------- 6. shape
export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const border = { hairline: 1, focus: 2 } as const;

// ---------------------------------------------------------------- 7. elevation
//
// Four levels, and most surfaces use the first. Depth comes from a card being
// lighter than its page and edged with a hairline; a shadow is reserved for
// something that genuinely floats and has to be read as temporary. The shadow is
// tinted to the neutral rather than pure black, which is what stops it going muddy.
export const elevation = {
  flat: {},
  // A card that should feel like an object rather than a region. Used sparingly.
  card: {
    shadowColor: "#0B1016",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  raised: {
    shadowColor: "#0B1016",
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  overlay: {
    shadowColor: "#0B1016",
    shadowOpacity: 0.24,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 16 },
    elevation: 24,
  },
} as const;

// -------------------------------------------------------------------- 8. motion
//
// Durations for anything timed, and one spring for anything that responds to a
// finger. A press should settle rather than ease: `damping` high enough that it
// never wobbles, `stiffness` high enough that it never feels late.
//
// Everything built on these honours `prefers-reduced-motion` at the component that
// uses them; the tokens do not enforce it and cannot.
export const motion = {
  fast: 120,
  base: 180,
  slow: 260,
  // The distance a card travels when it enters. Small on purpose: things that fly
  // in from far away read as a demo.
  enterOffset: 12,
  press: { damping: 22, stiffness: 340, mass: 0.7 },
  settle: { damping: 26, stiffness: 190, mass: 0.9 },
  // How far a pressable shrinks under a finger.
  pressScale: 0.975,
} as const;

export const opacity = {
  disabled: 0.4,
  pressed: 0.7,
  scrim: 0.58,
} as const;

// --------------------------------------------------------------------- 9. size
export const size = {
  touch: 44,
  control: { sm: 36, md: 48, lg: 54 },
  icon: { sm: 16, md: 20, lg: 24 },
} as const;

// ------------------------------------------------------- 10. the resolved theme
//
// What a component imports. The flat names in the second half are the ones the four
// portals were written against; they are kept, and pointed at the new values, so a
// screen written before the tokens existed still reads without being touched.
export const theme = {
  text: light.text,
  surface: light.surface,
  line: light.border,
  action: light.action,
  brand: light.brand,
  feedback: light.feedback,

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
  // `aqua` and `deepTeal` are no longer the colours they were named after: aqua is
  // the brand at the weight text can sit on, deepTeal is the ink the headings want.
  // The brand as a surface is `surfaceInverse`.
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

// One colour per order state, so a status reads the same in every portal. Built
// from whichever semantic map is in play rather than from fixed values: a state
// pill is text, and text chosen for a white card is unreadable on a dark one.
type Semantic = typeof light;

export function stateColorsFor(t: Semantic): Record<string, string> {
  const transit = t === light ? palette.blue[700] : "#83B4F5";
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
