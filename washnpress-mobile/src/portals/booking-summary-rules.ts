// What a booking summary actually has to say.
//
// The confirmation screen said everything: four cards, seventeen rows, the number of
// slots still free in the window being booked, the per-garment rate beyond an
// allowance, and the plan tier — all of it true and none of it grouped, so the three
// questions a person actually has on that screen were spread across it.
//
// The three questions are: when are you coming, what am I sending, and what will it
// cost. Everything that does not answer one of those is either a field they already
// filled in or a fact about their plan they can read on the plan screen.
//
// Kept out of the component because "is this covered by the plan" and "what does this
// come to" are decisions, and a decision that renders is a decision nobody can test.

export interface SummaryLine {
  id: string;
  category: string;
  serviceName: string;
  quantity: number;
  unit?: string | null;
  measuredQuantity?: number | null;
  coveredQuantity?: number | null;
  additionalQuantity?: number | null;
  linePricePaise?: number | null;
}

export interface SummaryInput {
  lines: SummaryLine[];
  hasSubscription: boolean;
  servicesPaise?: number | null;
  chargeablePaise?: number | null;
  turnaroundHours?: number | null;
}

// How a single line reads, once the plan has been applied to it.
//
// A line is one of three things and it is worth saying which: entirely inside the
// allowance, entirely outside it, or split. The split case is the one that surprises
// people at the till, so it is the one said in full.
export function lineCoverage(line: SummaryLine): string | null {
  const covered = line.coveredQuantity ?? 0;
  const extra = line.additionalQuantity ?? 0;
  if (covered <= 0 && extra <= 0) return null;
  if (covered > 0 && extra > 0) return `${covered} in your plan, ${extra} beyond it`;
  if (covered > 0) return "Within your plan";
  return "Charged separately";
}

export function totalQuantity(lines: SummaryLine[]): number {
  return lines.reduce((sum, line) => sum + (line.quantity || 0), 0);
}

// One sentence for the whole booking, so somebody who reads nothing else still knows
// what they are agreeing to.
//
// It leads with the cost, because that is the question the summary exists to answer,
// and says "no charge" rather than "₹0" — which reads as a missing figure rather than
// as a free collection.
export function summaryLine(input: SummaryInput): string {
  const items = totalQuantity(input.lines);
  const noun = items === 1 ? "garment" : "garments";
  const charge = input.chargeablePaise ?? 0;
  if (items === 0) return "Nothing added yet.";
  if (charge <= 0) {
    return input.hasSubscription
      ? `${items} ${noun}, all within your plan.`
      : `${items} ${noun}, nothing to pay now.`;
  }
  return `${items} ${noun}, about ${rupeesOf(charge)} to pay.`;
}

// When it comes back, said as a day rather than as a number of hours.
//
// "48 hours" is arithmetic somebody has to do standing in their doorway; "back by
// Thursday" is the answer they were looking for.
export function expectedBack(turnaroundHours: number | null | undefined, from: Date = new Date()): string | null {
  if (!turnaroundHours || turnaroundHours <= 0) return null;
  const back = new Date(from.getTime() + turnaroundHours * 3600_000);
  const days = Math.round((back.getTime() - from.getTime()) / 86400_000);
  const weekday = back.toLocaleDateString(undefined, { weekday: "long" });
  if (days <= 0) return "Back later today";
  if (days === 1) return "Back tomorrow";
  if (days < 7) return `Back by ${weekday}`;
  return `Back in about ${Math.round(days / 7)} week${days < 14 ? "" : "s"}`;
}

// Whether the cost block is worth drawing at all.
//
// A booking with nothing chargeable and no plan to explain is a booking whose cost
// section would say "₹0" three times.
export function hasCostToShow(input: SummaryInput): boolean {
  return (input.chargeablePaise ?? 0) > 0
    || (input.servicesPaise ?? 0) > 0
    || input.hasSubscription;
}

function rupeesOf(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

// How much of the plan is left, said where the booking is being made.
//
// The remaining allowance was on the Home screen and on the Plan screen and nowhere
// in the wizard — so a resident could read "8 garments remaining" on Monday, book on
// Thursday having sent eleven in the meantime, and find out what it cost when the
// operator counted the bag. The one moment the number decides anything is the moment
// it was missing.
//
// It is deliberately a sentence rather than a figure. "3" beside the word "remaining"
// is a number somebody still has to interpret; what they are actually asking is
// whether this booking costs them anything, and the answer to that is a rate as well
// as a count.
export interface AllowanceStanding {
  hasSubscription: boolean;
  allowance: number;
  remaining: number;
  // What a garment costs once the allowance is gone, and what one costs with no plan
  // at all. Two different rates, and quoting the wrong one is worse than quoting
  // none.
  additionalRatePaise: number;
  nonSubscriberRatePaise: number;
}

export function allowanceLine(standing: AllowanceStanding | null): string | null {
  // Nothing is known yet — the pricing call has not landed. Silence rather than a
  // guess: an allowance stated wrongly is worse than one not stated.
  if (!standing) return null;
  if (!standing.hasSubscription) {
    return `You are not on a plan, so garments are charged at ${rupeesOf(standing.nonSubscriberRatePaise)} each.`;
  }
  if (standing.remaining <= 0) {
    return `Your plan's ${standing.allowance} garments are used up this cycle. Anything you send now is ${rupeesOf(standing.additionalRatePaise)} each.`;
  }
  const noun = standing.remaining === 1 ? "garment" : "garments";
  return `${standing.remaining} of ${standing.allowance} ${noun} left in your plan this cycle. Beyond that it is ${rupeesOf(standing.additionalRatePaise)} each.`;
}
