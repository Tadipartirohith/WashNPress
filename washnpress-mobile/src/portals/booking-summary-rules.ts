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
