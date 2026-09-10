import { Linking } from "react-native";

// Where the privacy policy and the terms live, and the one place that knows it.
//
// Neither application linked to either, anywhere. Both stores require a reachable
// privacy policy from any app that collects a phone number — which is the first
// thing this one asks for — and Apple wants the terms in the app as well as on the
// listing, so a submission without them is refused before the build is even looked
// at. Two constants and a helper, rather than a URL typed into three screens, so
// the day the real address exists there is one line to change.
//
// PLACEHOLDER. `.example` is a reserved domain that never resolves, so a build made
// with these values fails visibly on the first tap rather than opening somewhere
// plausible and wrong. Replace both with the published pages before submitting.
export const PRIVACY_POLICY_URL = "https://washnpress.example/privacy";
export const TERMS_URL = "https://washnpress.example/terms";

// Opening a page outside the app.
//
// `openURL` rejects when nothing on the device can handle the address, and an
// unhandled rejection from a tap is a crash in a release build. There is nothing
// useful to tell somebody whose handset has no browser, so the failure is swallowed
// and the tap simply does nothing.
export function openLegalPage(url: string): void {
  void Linking.openURL(url).catch(() => undefined);
}
