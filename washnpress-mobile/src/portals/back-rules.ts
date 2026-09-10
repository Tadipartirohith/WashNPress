// What the Android back button does, in an app with no navigation stack to pop.
//
// Navigation here is conditional rendering over `useState`: a portal holds which tab
// it is on and which record, if any, is open. There is no history, so back cannot be
// "the previous screen" — it has to be a rule about that state, and the four portals
// have to agree on it or back means something different depending which one you are
// in.
//
// The rule is the one every Android app that works this way uses: close what is on
// top of the tab, then come back to the tab the portal opens on, then leave. Three
// steps, in that order, and only the last one is the platform's default — which is
// what was happening at every depth, because nothing was handling the press at all.

export type BackAction =
  // A record, a wizard or a sub-screen is open over the tab. Close it.
  | "closeRecord"
  // A tab other than the one the portal starts on. Go back to that one, so back
  // always eventually reaches a known place rather than exiting from wherever.
  | "goHome"
  // Already home with nothing open. Let go: back at the top of an Android app closes
  // it, and an app that refuses to be left is worse than one that leaves too easily.
  | "exitApp";

export function backAction(state: { recordOpen: boolean; tab: string; homeTab: string }): BackAction {
  if (state.recordOpen) return "closeRecord";
  if (state.tab !== state.homeTab) return "goHome";
  return "exitApp";
}
