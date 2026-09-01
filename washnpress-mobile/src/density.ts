import { APP_VARIANT } from "./variant";
import { compactSpace, space, type SpaceScale } from "./theme";

// Which spacing scale this build runs on.
//
// The staff application is a working surface: tables of collections, queues of
// bookings, forty flats to triage before noon. The resident application is opened to
// answer one question. Those want opposite amounts of room, and they are the same
// codebase, so the scale is chosen once here from the variant rather than screen by
// screen.
//
// This lives apart from `theme.ts` on purpose. The theme is a pure data file that a
// test can import with no runtime behind it; reading the variant means reading the
// Expo config, and putting that import into the theme would drag the whole app
// runtime into every test that wants to check a colour.
export const density: SpaceScale = APP_VARIANT === "staff" ? compactSpace : space;

// What the build actually is, for a screen that wants to say so.
export const isCompact = APP_VARIANT === "staff";
