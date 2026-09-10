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
}

// Why neither application asks for the camera.
//
// The staff app used to declare NSCameraUsageDescription and the Android CAMERA
// permission for a QR batch scanner. That screen was imported by nothing — it could
// not be reached from any portal — so the permission covered a feature that did not
// exist in the build. Google Play's sensitive-permissions policy prohibits exactly
// that, and a reviewer who cannot find the scanner has no way to conclude otherwise.
// The screen and the permission went together; if batch scanning comes back, both
// come back with it.
//
// `expo-image-picker` and Expo's own defaults each pull a CAMERA declaration into
// the merged Android manifest whether or not anything uses it, so it is blocked
// rather than merely left out.
const BLOCKED_PERMISSIONS = ["android.permission.CAMERA", "android.permission.RECORD_AUDIO"];

// Reaching the photo library, said in words a person can act on.
//
// iOS terminates the process — not an error, a crash — the moment a photo picker is
// raised with no usage description in Info.plist. `src/components/support.tsx` asks
// for library permission explicitly before attaching a photograph to a support
// ticket, in both applications, so the first attempt to attach evidence killed the
// app on every iPhone. The key is set here and the config plugin is registered
// below; either alone would do it, and the pair means neither an edit to this file
// nor a change in plugin ordering can quietly take it away again.
const PHOTO_LIBRARY_PERMISSION =
  "Allow Wash N Press to reach your photographs so you can attach one to a support request.";

const IDENTITIES: Record<Variant, Identity> = {
  resident: {
    name: "Wash N Press",
    slug: "washnpress",
    scheme: "washnpress",
    bundleIdentifier: "com.washnpress.app",
    androidPackage: "com.washnpress.app",
    description: "Book a laundry pickup from your society, track it, and manage your plan.",
  },
  staff: {
    name: "Wash N Press Staff",
    slug: "washnpress-staff",
    scheme: "washnpressstaff",
    bundleIdentifier: "com.washnpress.staff",
    androidPackage: "com.washnpress.staff",
    description: "Collections, processing and quality checks for Wash N Press operations staff.",
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
  // Follow the device.
  //
  // This said "light", which pins the iOS appearance so `useColorScheme()` can only
  // ever report light — while the app ships a full dark palette and an appearance
  // preference whose default is "follow the system". So the one option most people
  // never change was the one that could not work, and a reader with their phone in
  // dark mode got a white app.
  userInterfaceStyle: "automatic",
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
    infoPlist: { NSPhotoLibraryUsageDescription: PHOTO_LIBRARY_PERMISSION },
  },
  android: {
    package: id.androidPackage,
    adaptiveIcon: {
      foregroundImage: asset("adaptive-icon"),
      backgroundColor: "#004D4D",
    },
    // Nothing beyond what a library the app actually uses declares for itself.
    // A resident reading the Play listing should not be told the laundry app wants
    // their camera, and neither should an operator.
    permissions: [],
    blockedPermissions: BLOCKED_PERMISSIONS,
  },
  web: {
    bundler: "metro",
    favicon: asset("favicon"),
  },
  plugins: [
    // The picker was a dependency with no plugin entry, so its config plugin never
    // ran and never injected the key it exists to inject. `cameraPermission: false`
    // keeps it from adding back the camera declaration this app has no use for.
    ["expo-image-picker", {
      photosPermission: PHOTO_LIBRARY_PERMISSION,
      cameraPermission: false,
    }] as const,
    ["expo-notifications", { color: "#004D4D" }] as const,
  ] as ExpoConfig["plugins"],
  extra: {
    // What the running app reads to know which of itself it is. Everything else
    // about the split is a build-time concern; this is the one fact the JavaScript
    // needs, and it comes from the config that produced the build rather than from
    // a second environment variable that could disagree with it.
    appVariant: variant,
    // There is deliberately no apiBaseUrl here. It used to sit beside appVariant,
    // read the same environment variable, and be read back by nothing at all —
    // two mechanisms claiming to set one value, of which the live one is
    // EXPO_PUBLIC_API_URL in src/config.ts.
    // Filled in by `eas init`, or set in the environment for CI. Left unset rather
    // than invented: a wrong project id fails at submission time, which is the
    // worst moment to find out.
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
};

export default config;
