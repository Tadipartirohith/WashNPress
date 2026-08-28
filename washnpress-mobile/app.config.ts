import type { ExpoConfig } from "expo/config";

// Two applications, one codebase.
//
// The four portals used to be one app: you signed in and the role on your session
// decided whether you got the resident's booking screen or the admin's console.
// That is right for the code and wrong for a store listing. A resident app is a
// consumer product anybody may install; a staff app is an internal tool that is
// useless without an account somebody at Wash N Press created, and the two are
// reviewed against different expectations — an app whose whole function is behind
// a login it will not hand out is a routine rejection.
//
// So the source stays single and the *identity* forks: two bundle ids, two icons,
// two listings, one `src/`. Which one is being built is `APP_VARIANT`, and the same
// value is passed into the bundle through `extra` so the running app knows which of
// itself it is.
//
// Build them with:
//   eas build --profile production-resident --platform all
//   eas build --profile production-staff    --platform all
// which set APP_VARIANT themselves, so neither can be built as the wrong one by
// forgetting a shell variable. Locally: `npm run resident` / `npm run staff`.

type Variant = "resident" | "staff";

const variant: Variant = process.env.APP_VARIANT === "staff" ? "staff" : "resident";

// One version for both. They ship together because they talk to the same backend,
// and a resident on last month's build against this month's API is the failure this
// avoids.
//
// The build number and the Android version code are deliberately absent: eas.json
// sets appVersionSource to remote, so EAS holds them and increments them per
// submission. Two places to bump a number is one place to forget.
const VERSION = "0.1.0";

interface Identity {
  name: string;
  slug: string;
  scheme: string;
  bundleIdentifier: string;
  androidPackage: string;
  description: string;
  // Only the staff app scans garment batch QR codes. Asking a resident for the
  // camera it never uses is both a review risk and a fair question from anybody
  // reading the permission list.
  needsCamera: boolean;
}

const IDENTITIES: Record<Variant, Identity> = {
  resident: {
    name: "Wash N Press",
    slug: "washnpress",
    scheme: "washnpress",
    bundleIdentifier: "com.washnpress.app",
    androidPackage: "com.washnpress.app",
    description: "Book a laundry pickup from your society, track it, and manage your plan.",
    needsCamera: false,
  },
  staff: {
    name: "Wash N Press Staff",
    slug: "washnpress-staff",
    scheme: "washnpressstaff",
    bundleIdentifier: "com.washnpress.staff",
    androidPackage: "com.washnpress.staff",
    description: "Collections, processing and quality checks for Wash N Press operations staff.",
    needsCamera: true,
  },
};

const id = IDENTITIES[variant];
const asset = (name: string) => `./assets/${name}-${variant}.png`;

const config: ExpoConfig = {
  name: id.name,
  slug: id.slug,
  scheme: id.scheme,
  description: id.description,
  version: VERSION,
  orientation: "portrait",
  userInterfaceStyle: "light",
  icon: asset("icon"),
  splash: {
    image: asset("splash"),
    resizeMode: "contain",
    backgroundColor: "#004D4D",
  },
  assetBundlePatterns: ["**/*"],
  // Tied to the version, so a native build and the JavaScript sent to it can never
  // be a version apart.
  runtimeVersion: { policy: "appVersion" },
  ios: {
    bundleIdentifier: id.bundleIdentifier,
    supportsTablet: true,
    infoPlist: id.needsCamera
      ? { NSCameraUsageDescription: "Allow Wash N Press to scan garment batch QR codes." }
      : {},
  },
  android: {
    package: id.androidPackage,
    adaptiveIcon: {
      foregroundImage: asset("adaptive-icon"),
      backgroundColor: "#004D4D",
    },
    permissions: id.needsCamera ? ["CAMERA"] : [],
    // Expo's own defaults add a handful of permissions that this app does not use.
    // A resident reading the Play listing should not be told the laundry app wants
    // their camera.
    blockedPermissions: id.needsCamera ? [] : ["android.permission.CAMERA", "android.permission.RECORD_AUDIO"],
  },
  web: {
    bundler: "metro",
    favicon: asset("favicon"),
  },
  plugins: [
    ...(id.needsCamera
      ? [["expo-camera", { cameraPermission: "Allow Wash N Press to scan garment batch QR codes." }] as const]
      : []),
    ["expo-notifications", { color: "#004D4D" }] as const,
  ] as ExpoConfig["plugins"],
  extra: {
    // What the running app reads to know which of itself it is. Everything else
    // about the split is a build-time concern; this is the one fact the JavaScript
    // needs, and it comes from the config that produced the build rather than from
    // a second environment variable that could disagree with it.
    appVariant: variant,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080",
    // Filled in by `eas init`, or set in the environment for CI. Left unset rather
    // than invented: a wrong project id fails at submission time, which is the
    // worst moment to find out.
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
};

export default config;
