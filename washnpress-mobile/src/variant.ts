import Constants from "expo-constants";
import { type AppVariant } from "./variant-rules";

// Which of the two applications this build is.
//
// It comes from the app config that produced the build — `app.config.ts` puts it in
// `extra` — rather than from a second environment variable read at runtime, because
// two sources for one fact is two sources that can disagree, and the one that would
// be wrong is the one deciding what a person is allowed to see.
//
// Defaulting to the resident app matters: a misconfigured build should fall back to
// the one that shows less, not to the one that shows the admin console.

export const APP_VARIANT: AppVariant =
  (Constants.expoConfig?.extra as { appVariant?: string } | undefined)?.appVariant === "staff"
    ? "staff"
    : "resident";

export * from "./variant-rules";
