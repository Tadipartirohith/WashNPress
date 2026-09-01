// Whether this handset can be sent a push notification, and if not, why.
//
// Four different things stop push working, and none of them is an error: the web
// build has no push service, Expo Go stopped delivering remote push at SDK 53, a
// simulator has nothing behind it, and a build made before `eas init` has no
// project to issue a token against. Asking anyway is what produced a stack of
// warnings on every start, and saying nothing is what made a tester on Expo Go
// think the app was broken when the container was the limitation.
//
// The decision is separated from the modules it reads so it can be tested. The
// Expo Go branch is the one that matters most and is the one hardest to reach
// from a test otherwise: it needs Expo Go.

export interface PushEnvironment {
  platform: string;
  // Running inside the Expo Go app rather than a build of this application.
  inExpoGo: boolean;
  // False on a simulator or emulator.
  isDevice: boolean;
  // Whether this build knows which EAS project it belongs to.
  hasProjectId: boolean;
}

// Every one of these ends by saying the in-app list still works, because that is
// the part somebody can rely on and the part the warning does not mention.
export function pushReasonFor(env: PushEnvironment): string | null {
  if (env.platform === "web") {
    return "Push notifications are not delivered to the web app. Alerts still arrive in the app's own list.";
  }
  // Checked before the device test: Expo Go on a real handset is still Expo Go,
  // and "a simulator has no push service" would be the wrong explanation.
  if (env.inExpoGo) {
    return "Expo Go cannot receive push notifications since SDK 53. Install a development build to test them — everything else works here, and alerts still arrive in the app's own list.";
  }
  if (!env.isDevice) {
    return "A simulator has no push service behind it. Alerts still arrive in the app's own list.";
  }
  if (!env.hasProjectId) {
    return "This build has no EAS project id, so it cannot be issued a push token.";
  }
  return null;
}

// Whether registration should even be attempted. The one caller is
// `registerForPush`, and this is what stops it loading a notifications module
// that cannot do anything.
export function canRegisterForPush(env: PushEnvironment): boolean {
  return pushReasonFor(env) === null;
}
