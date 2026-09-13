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
// Ocean
//
// The approved identity, shared with the website: a pale blue ground, white cards
// edged with a visible border, an ink-navy text colour, one clear blue for every
// action, link and selected state, and a bright cyan accent that is only ever a
// fill or part of an illustration — at 2.46:1 on white it is never text.
//
// Dark mode is a matching set rather than an inversion: a deep navy ground, surfaces
// one step lighter, and the blue lifted until it reads on navy and takes navy text.
//
// The neutrals keep their blue cast. Optical brightener is the thing that makes
// laundered whites read as white, and a laundry product whose ground is very
// slightly blue is making a quiet argument about itself.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------- 1. primitives

const palette = {
  // The Ocean neutrals. A cool ramp with a blue cast, not grey and not warm.
  ink: {
    // The text colour, an ink navy rather than black.
    950: "#1A1A2E",
    // Muted text.
    600: "#4A5B72",
    500: "#56657A",
    // The control border. The identity's #7C8DA3 is 2.97:1 on the page below, just
    // short of the 3:1 a control boundary needs; one step darker is 3.01:1.
    400: "#7B8CA2",
    300: "#9AAAC0",
    // The decorative card border.
    150: "#C9DAEC",
    100: "#DDE9F6",
    // The page. The identity's #F0F8FF is 1.07:1 against a white card, too shallow
    // for a card to lift off it; this is the same blue a step deeper, at 1.14:1.
    50: "#E8F1FC",
  },
  // The brand ramp: Ocean blue, with the cyan accent at 500. (Kept under the name
  // `jade` because every semantic token already points at this ramp; only the values
  // moved.) 700 is the button colour and carries white at 5.57:1; 800 is its pressed
  // state; 500 is the cyan accent, a fill only in light mode; 400 is the lifted blue
  // the dark mode uses so its label can be navy; 200 is a pale cyan that reads on
  // the deep blue inverse surface.
  jade: {
    800: "#004C99",
    700: "#0066CC",
    500: "#00B4D8",
    400: "#5AA8FF",
    200: "#9EE3F2",
    100: "#E6F0FB",
    50: "#F0F8FF",
  },
  // The branded/inverse surface — the deep Ocean blue of the app bar. Light text
  // sits on it at well past AA, and the cyan accent reads as a mark on it.
  petrol: {
    900: "#004C99",
    800: "#0B2F5C",
    950: "#003A75",
  },
  green: { 700: "#1B7A4B", 500: "#1F8A55", 100: "#E7F4EC" },
  amber: { 700: "#8A5A00", 500: "#B06A00", 100: "#FDF3E1" },
  red: { 700: "#B42318", 500: "#CF3229", 100: "#FDECEA" },
  blue: { 700: "#1D57A8", 100: "#E6F0FB" },
  violet: { 700: "#5B3FBF" },
  white: "#FFFFFF",
} as const;

// ------------------------------------------------------------- 2. semantic light

export const light = {
  text: {
    primary: palette.ink[950], //   17.06:1 on a card
    secondary: palette.ink[600], //  6.93:1
    tertiary: palette.ink[500], //   5.93:1
    disabled: palette.ink[300],
    onAction: palette.white, //      5.57:1 on the blue action
    onInverse: palette.jade[50], //  7.85:1 on the deep blue
    link: palette.jade[700], //      5.57:1 on a card
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
    scrim: "rgba(11, 20, 36, 0.45)",
    // Frosted glass, tuned for the Ocean ground. The identity wants a card that reads
    // as a white card, so the pane is nearly opaque: the ground only tints it, blurred
    // on the web. `glass` is the ordinary card; `glassStrong` is for a pane that must
    // stay legible over a busy patch.
    glass: "rgba(255, 255, 255, 0.92)",
    glassStrong: "rgba(255, 255, 255, 0.98)",
  },
  border: {
    subtle: palette.ink[150],
    // Anything drawing the boundary of a control the eye has to find. 3.44:1 on a
    // card and 3.01:1 on the page, which is what WCAG 2.2 asks of a control boundary.
    strong: palette.ink[400],
    focus: palette.jade[700],
    // The edge of a glass pane. The identity gives every card a visible border, so
    // this is the decorative card border rather than a white highlight.
    glass: "rgba(201, 218, 236, 0.95)",
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
    // Ocean blue carries white at 5.57:1, which is past the 4.5:1 a button label
    // needs, so the contrast worry the ink was avoiding does not arise. Destructive
    // stays red and the inverse surfaces stay the deep blue; only the affirmative
    // action moves.
    primary: palette.jade[700],
    // A mid blue has room to darken under a finger, which is the direction a press
    // should go. The near-black it replaced had to lighten instead.
    primaryPressed: palette.jade[800],
    secondaryBorder: palette.jade[700],
    secondaryPressed: palette.jade[100],
    destructive: palette.red[700],
    destructivePressed: palette.red[100],
  },
  brand: {
    // The one that can be read as text on the page.
    solid: palette.jade[700],
    // The cyan accent. Only on the deep blue, or as a fill where no text sits.
    vivid: palette.jade[500],
    onInverse: palette.jade[200],
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
// The default now, matching the web app's own dark-by-default identity.
// `userInterfaceStyle: "light"` in app.config.ts only pins the native shell chrome
// (status bar, splash background) — it doesn't touch this. The switch to dark being
// the default is a two-constant change (this file's `activeScheme` and
// appearance-rules.ts's `DEFAULT_APPEARANCE`) rather than a wiring job, because every
// screen already reads through `theme`/`themed()` live; nothing had to change to make
// dark mode work, only to make it the first thing shown.
export const dark = {
  text: {
    primary: "#E6EEF8",
    secondary: "#9AAEC7",
    tertiary: "#8499B4",
    disabled: "#5A6E8A",
    onAction: "#0B1424",
    onInverse: "#E6EEF8",
    link: palette.jade[400],
  },
  surface: {
    // Deep navy, not black, with each surface one step lighter than the one below.
    page: "#0B1424",
    card: "#132038",
    raised: "#1B2C47",
    sunken: "#081020",
    inverse: "#132038",
    inverseDeep: "#081020",
    scrim: "rgba(0, 0, 0, 0.68)",
    // Frosted glass over the navy ground: nearly opaque navy, so a pane reads as a
    // card and its text stays bright.
    glass: "rgba(19, 32, 56, 0.92)",
    glassStrong: "rgba(27, 44, 71, 0.98)",
  },
  border: {
    subtle: "#2A3D5C",
    strong: "#6E84A3",
    focus: palette.jade[400],
    // The decorative card border, as on the light side.
    glass: "rgba(42, 61, 92, 0.95)",
  },
  action: {
    primary: palette.jade[400],
    primaryPressed: "#7FBFFF",
    secondaryBorder: palette.jade[400],
    secondaryPressed: "#16304F",
    destructive: "#FF8A80",
    destructivePressed: "#3D1E22",
  },
  brand: {
    solid: palette.jade[400],
    // The same cyan as light mode. On navy it passes as a mark and as text.
    vivid: palette.jade[500],
    onInverse: palette.jade[400],
    deep: "#081020",
    tint: "#16304F",
    tintFaint: "#0F2038",
  },
  feedback: {
    successText: "#4ADE9A",
    successSolid: "#2AA477",
    successTint: "#15342A",
    warningText: "#F5B942",
    warningSolid: "#B06A00",
    warningTint: "#3A2E12",
    dangerText: "#FF8A80",
    dangerSolid: "#CF3229",
    dangerTint: "#3D1E22",
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
// Plus Jakarta Sans, self-hosted through expo-font, for body and display type alike,
// with Geist Mono for anything that has to line up in a column.
//
// A native app running on whatever the device happens to call its system font is
// the loudest tell that nobody chose anything: the same screen is Roboto on one
// phone and SF on another, and neither was a decision. One family is the identity's
// choice, shared with the website; headings take the heavier files and tighter
// tracking rather than a second face.
//
// React Native will not synthesise a weight for a custom family the way a browser
// does. `fontWeight: "700"` beside a custom `fontFamily` is silently ignored on
// Android, so weight is expressed by picking the file. Never add a fontWeight to
// one of these styles; change the family instead.
export const font = {
  regular: "PlusJakartaSans_400Regular",
  medium: "PlusJakartaSans_500Medium",
  semi: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
  black: "PlusJakartaSans_800ExtraBold",
  mono: "GeistMono_500Medium",
  monoSemi: "GeistMono_600SemiBold",
  // The prominent branded type — page titles, section headings, the big metric
  // numbers — in the heaviest two files of the same family.
  display: "PlusJakartaSans_800ExtraBold",
  displaySemi: "PlusJakartaSans_700Bold",
} as const;

// Ten styles, each a complete instruction, rather than a size somebody pairs with a
// weight by hand. Tracking tightens as type grows and opens up on small capitals,
// which is what keeps a heading from looking loose and a label from looking cramped.
export const type = {
  // A number somebody is meant to feel rather than read. The balance on a wallet,
  // the garments in an order.
  // Even-width digits where the platform honours them; the mono family below is
  // still what a column that must line up everywhere uses.
  display: { fontFamily: font.display, fontSize: 40, lineHeight: 44, letterSpacing: -1.4, fontVariant: ["tabular-nums"] },
  title: { fontFamily: font.display, fontSize: 25, lineHeight: 30, letterSpacing: -0.7 },
  heading: { fontFamily: font.display, fontSize: 18, lineHeight: 23, letterSpacing: -0.35 },
  subheading: { fontFamily: font.displaySemi, fontSize: 15, lineHeight: 20, letterSpacing: -0.2 },
  body: { fontFamily: font.medium, fontSize: 15, lineHeight: 21, letterSpacing: -0.1 },
  bodyStrong: { fontFamily: font.semi, fontSize: 15, lineHeight: 21, letterSpacing: -0.1 },
  label: { fontFamily: font.semi, fontSize: 13, lineHeight: 18, letterSpacing: -0.05 },
  caption: { fontFamily: font.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0 },
  // Eyebrows and table headers. Small capitals need the extra tracking or they set
  // as a smudge.
  overline: { fontFamily: font.semi, fontSize: 11, lineHeight: 14, letterSpacing: 0.7 },
  // A dashboard number.
  metric: { fontFamily: font.display, fontSize: 27, lineHeight: 31, letterSpacing: -0.9, fontVariant: ["tabular-nums"] },
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
    shadowColor: "#102A50",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  raised: {
    shadowColor: "#102A50",
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  overlay: {
    shadowColor: "#102A50",
    shadowOpacity: 0.24,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 16 },
    elevation: 24,
  },
  // The soft drop a glass pane casts on the ground. Wider and fainter than a card's,
  // so the pane floats rather than sits; tuned down to the identity's quiet shadow.
  glass: {
    shadowColor: "#102A50",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  // A coloured halo, for the one affirmative action on a screen. The colour is set
  // by the component so it can glow in the brand or in a status hue.
  glow: {
    shadowColor: palette.jade[500],
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
} as const;

// The ground the whole app sits on, behind every pane. Three stops of a soft vertical
// wash per mode, held close to the page colour so the Ocean ground reads as one calm
// blue rather than a gradient; the ambient background component paints these and
// floats two faint colour pools over them.
export const backgroundGradient = {
  light: ["#EEF5FD", "#E8F1FC", "#E4EEFA"] as const,
  dark: ["#0B1424", "#0B1424", "#0E1A30"] as const,
};

// The colour pools floated over the ground: Ocean blue for the brand and the cyan
// accent, kept very faint so they read as light in water rather than as decoration.
export const glowBlobs = {
  light: { brand: "rgba(0, 102, 204, 0.07)", accent: "rgba(0, 180, 216, 0.09)" },
  dark: { brand: "rgba(90, 168, 255, 0.08)", accent: "rgba(0, 180, 216, 0.08)" },
};

// The service illustrations: the washer, iron and car scenes, the suds pattern and
// the rising bubbles. The one set of colours components may use that is not a
// semantic token, because a drawing needs a body, a metal, a glass and a foam that no
// interface role describes. None of them carries text. Each mode is a full set, so
// dark mode recolours the same drawings rather than needing second artwork.
export const illustration = {
  light: {
    ink: "#1E3A5F", body: "#FFFFFF", metal: "#D9E6F2", glass: "#CFEAF7",
    water1: "#0066CC", water2: "#00B4D8", foam: "#FFFFFF", shirt: "#BFE9F3",
    car: "#0066CC", tyre: "#1A1A2E", steam: "#8FA3BA", spark: "#F5B942",
    shadow: "rgba(0, 40, 90, 0.12)",
    sud: "rgba(0, 102, 204, 0.16)",
    // The ground each service's scene sits on.
    tint: { laundry: "#E6F0FB", iron: "#EDF1F7", car: "#DFF5FA" },
    // Bubbles on the page ground, and on a primary-coloured header.
    bubble: { ring: "rgba(0, 140, 190, 0.38)", fill: "rgba(255, 255, 255, 0.45)", hi: "rgba(255, 255, 255, 0.9)" },
    bubbleOnAction: { ring: "rgba(255, 255, 255, 0.5)", fill: "rgba(255, 255, 255, 0.12)", hi: "rgba(255, 255, 255, 0.8)" },
  },
  dark: {
    ink: "#9CC2EA", body: "#1B2C47", metal: "#2A3D5C", glass: "#173A57",
    water1: "#3D8FE8", water2: "#00B4D8", foam: "#DDF1FF", shirt: "#1F5467",
    car: "#3D8FE8", tyre: "#04080F", steam: "#6E84A3", spark: "#F5B942",
    shadow: "rgba(0, 0, 0, 0.35)",
    sud: "rgba(90, 168, 255, 0.18)",
    tint: { laundry: "#16304F", iron: "#1A2638", car: "#0F3440" },
    bubble: { ring: "rgba(0, 180, 216, 0.4)", fill: "rgba(221, 241, 255, 0.06)", hi: "rgba(221, 241, 255, 0.55)" },
    bubbleOnAction: { ring: "rgba(11, 20, 36, 0.35)", fill: "rgba(11, 20, 36, 0.08)", hi: "rgba(11, 20, 36, 0.4)" },
  },
};

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
  // A still scene above an empty state.
  illustration: 96,
} as const;

// ------------------------------------------------------- 10. the resolved theme
//
// What a component imports. The flat names in the second half are the ones the four
// portals were written against; they are kept, and pointed at the new values, so a
// screen written before the tokens existed still reads without being touched.
// The map is built from whichever mode is live rather than from `light`, and the
// export below reads it at the moment a component asks. That is what lets one
// `theme.aqua` in a screen mean porcelain jade in the morning and vivid jade at
// night without the screen knowing there are two.
// The structural shape both modes share. Written out rather than `typeof light`
// because both palettes are `as const`, so their literal types disagree on every
// value — a palette is a set of colours with these names, not these colours.
export type Palette = {
  text: Record<keyof typeof light.text, string>;
  surface: Record<keyof typeof light.surface, string>;
  border: Record<keyof typeof light.border, string>;
  action: Record<keyof typeof light.action, string>;
  brand: Record<keyof typeof light.brand, string>;
  feedback: Record<keyof typeof light.feedback, string>;
};

function themeFor(t: Palette) {
  return {
    text: t.text,
    surface: t.surface,
    line: t.border,
    action: t.action,
    brand: t.brand,
    feedback: t.feedback,

    textPrimary: t.text.primary,
    textSecondary: t.text.secondary,
    textTertiary: t.text.tertiary,
    textOnAction: t.text.onAction,
    surfacePage: t.surface.page,
    surfaceCard: t.surface.card,
    surfaceInverse: t.surface.inverse,
    borderSubtle: t.border.subtle,
    borderStrong: t.border.strong,

    // ---- the names the existing screens use -------------------------------
    // `aqua` and `deepTeal` are no longer the colours they were named after: aqua is
    // the brand at the weight text can sit on, deepTeal is the ink the headings want.
    // The brand as a surface is `surfaceInverse`.
    aqua: t.brand.solid,
    deepTeal: t.text.primary,
    ice: t.brand.tint,
    amber: t.feedback.warningText,
    white: palette.white,
    slate: t.text.secondary,
    bg: t.surface.page,
    muted: t.text.tertiary,
    border: t.border.subtle,
    danger: t.feedback.dangerText,
    success: t.feedback.successText,
  };
}

export type Theme = ReturnType<typeof themeFor>;

const THEMES = { light: themeFor(light), dark: themeFor(dark) };

// Which mode the application is rendering in.
//
// A module-level letter rather than React state on purpose: `StyleSheet` bodies and
// the proxy below are read outside any component, and a hook cannot reach them. The
// root subscribes to the system setting and re-renders the tree, which is what makes
// the value below take effect everywhere at once.
let activeScheme: "light" | "dark" = "light";

export function setColorScheme(scheme: "light" | "dark"): void {
  activeScheme = scheme;
}

export function currentTheme(): Theme {
  return THEMES[activeScheme];
}

// Which mode is live, for the few places that must build something for both.
export function colorScheme(): "light" | "dark" {
  return activeScheme;
}

// Both modes, already built. `themed()` needs these to make one stylesheet per mode
// ahead of the first render.
export const themes: Record<"light" | "dark", Theme> = THEMES;

// Read live, so `theme.text.primary` written years ago in a screen resolves against
// whichever mode is on at the moment it renders. Every existing reference keeps
// working and none of them had to be touched.
export const theme: Theme = new Proxy({} as Theme, {
  get: (_target, key) => THEMES[activeScheme][key as keyof Theme],
  has: (_target, key) => key in THEMES.light,
  ownKeys: () => Reflect.ownKeys(THEMES.light),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});

// One colour per order state, so a status reads the same in every portal. Built
// from whichever semantic map is in play rather than from fixed values: a state
// pill is text, and text chosen for a white card is unreadable on a dark one.
// Structurally the same thing as Palette; kept as its own name because the state
// map is a different concern from the theme map.
type Semantic = Palette;

export function stateColorsFor(t: Semantic): Record<string, string> {
  // Which mode this palette is, decided by a value rather than by identity: the
  // parameter is now the shape both modes share, so `t === light` would still work
  // but reads as a coincidence. The page colour is the least ambiguous tell.
  const transit = t.surface.page === light.surface.page ? palette.blue[700] : "#83B4F5";
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

const STATE_COLORS = { light: stateColorsFor(light), dark: stateColorsFor(dark) };

// Same trick as the theme: a state pill is drawn from whichever mode is live.
export const stateColor: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_target, key) => STATE_COLORS[activeScheme][key as string],
  has: (_target, key) => key in STATE_COLORS.light,
  ownKeys: () => Reflect.ownKeys(STATE_COLORS.light),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});

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
