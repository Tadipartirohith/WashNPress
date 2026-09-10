// Closing an account, and what has to be said before it happens.
//
// Apple's guideline 5.1.1(v) requires any app that lets somebody create an account
// to let them delete it from inside the app; only Sign out existed, which is a
// submission blocker. But "add a delete button" is the easy half. The half that
// matters is that this is the one action in the resident app that cannot be undone
// and that can take money with it — an unspent wallet balance, a plan paid for to
// the end of the cycle, a collection that is already out of the flat — and none of
// that is visible from the Profile screen where the button lives.
//
// So the decision is here rather than in the component: what is about to be lost,
// and whether the person has actually said the word. Both are testable, and neither
// wants a tree to exercise.

// What has to be typed. A button you can hit by accident is not a confirmation, and
// a second "Are you sure?" button is the same accident twice.
export const CONFIRMATION_WORD = "DELETE";

export function confirmationMatches(typed: string): boolean {
  // Trimmed because a phone keyboard adds a trailing space after an autocompleted
  // word, and case-insensitive because the same keyboard capitalises for you: the
  // gate exists to prove intent, not to test typing.
  return typed.trim().toUpperCase() === CONFIRMATION_WORD;
}

export interface AccountStanding {
  walletBalancePaise: number | null;
  // Whether a plan is being paid for. A cancelled or expired one has nothing left
  // to lose.
  hasActivePlan: boolean;
  // Garments the company is currently holding, or is booked to collect.
  ordersInFlight: number;
}

// What this person specifically is about to give up, worst first.
//
// Generic small print — "this cannot be undone" — is read by nobody, because it is
// on every destructive dialog anybody has ever seen. A balance with a figure on it
// is read, and it is the one that generates the support ticket afterwards.
export function deletionConsequences(standing: AccountStanding): string[] {
  const said: string[] = [];
  if (standing.ordersInFlight > 0) {
    said.push(standing.ordersInFlight === 1
      ? "You have 1 order still in progress. Wait for it to come back before closing your account."
      : `You have ${standing.ordersInFlight} orders still in progress. Wait for them to come back before closing your account.`);
  }
  if ((standing.walletBalancePaise ?? 0) > 0) {
    said.push(`Your wallet balance of ${rupeesOf(standing.walletBalancePaise ?? 0)} will be lost. Spend it or ask support to refund it first.`);
  }
  if (standing.hasActivePlan) {
    said.push("Your plan ends with the account, including whatever is left of this cycle's allowance.");
  }
  said.push("Your name, phone number, flat and support conversations are erased, and your number is released so it can sign up again.");
  // Said before confirming, not after. The backend keeps the ledger and the
  // collection records behind it — Indian tax and accounting obligations outlive the
  // customer — with the person unlinked from them. Somebody erasing an account is
  // owed that straight rather than being told everything went and finding otherwise.
  said.push("Payment records and the collection records behind them are kept, unlinked from you, because tax rules require it.");
  said.push("This cannot be undone. Signing up again starts a new account from scratch.");
  return said;
}

// Whether the account should be closed at all right now.
//
// Garments the company is physically holding are the one standing that is not the
// resident's to write off: closing the account would leave a bag of clothes with no
// account to return them to. Everything else is a warning; this is a stop.
export function deletionBlocked(standing: AccountStanding): boolean {
  return standing.ordersInFlight > 0;
}

// Local rather than imported from the theme, which is a React Native module: this
// file has to stay loadable by a test with no framework behind it.
function rupeesOf(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}
