import { z } from "zod";

// The field types a portal form submits over and over: a capacity, a rupee amount,
// a calendar date, a count of things.
//
// They are here for the same reason the contact fields are next door. Each of these
// rules was written inline wherever somebody happened to need it, so the same field
// was policed differently depending on which route it arrived at — a slot capacity
// was `positive()` on all six schemas that hold one and unbounded on every one of
// them, and a price was `nonnegative()` wherever it appeared, which is how a garment
// came to be saleable for nothing. Worse, none of them carried a message, so zod's
// own English ("Number must be greater than 0", "Expected integer, received float")
// is what a supervisor read under the box, if the route sent `details` at all.
//
// Every message here is a whole sentence addressed to the person filling in the
// form, because that is what `humanMessage` in both clients puts on the screen.

// How many bookings one slot holds.
//
// Two is the floor because a slot that can take a single booking is not a slot, it
// is an appointment, and the rosters, the utilisation bands and the "partially
// booked" status all assume a slot somebody else can still join. Thirty is the
// ceiling because it is more collections than one operator can make in a three-hour
// window, so a larger number is a typo — usually a missing decimal point or a
// pasted phone number — and the cost of accepting it is residents booking into a
// slot nobody can service.
const CAPACITY_MIN = 2;
const CAPACITY_MAX = 30;

export const capacityField = z
  .number({ required_error: "Capacity is required.", invalid_type_error: "Enter a valid capacity." })
  .int("Capacity must be a whole number.")
  .min(CAPACITY_MIN, `Capacity must be at least ${CAPACITY_MIN}.`)
  .max(CAPACITY_MAX, `Capacity cannot exceed ${CAPACITY_MAX}.`);

// A sum of money, in paise.
//
// Money is stored as whole paise everywhere in this codebase — see `domain/money` —
// so a rupee amount arrives multiplied by a hundred and a fraction of a paise is not
// a smaller amount, it is a rounding error waiting to be argued about on an invoice.
// The message says so rather than repeating zod's "Expected integer", because an
// admin typing 99.50 into a Price box has no way of knowing the field is in paise.
//
// Greater than zero, not merely non-negative. A price of ₹0 is not a cheap service,
// it is a service that bills nothing, and it reaches the ledger as an order worth
// nothing that somebody still has to collect, wash and deliver.
//
// `label` names the field in the sentence, so one helper serves "Price must be
// greater than ₹0." and "Amount must be greater than ₹0." without either route
// having to write its own wording.
export function moneyPaise(label = "Amount") {
  const lower = label.toLowerCase();
  return z
    .number({ required_error: `${label} is required.`, invalid_type_error: `Enter a valid ${lower}.` })
    .int(`${label} must be a whole number of paise (₹1 = 100 paise).`)
    .nonnegative(`${label} cannot be negative.`)
    .refine((value) => value > 0, { message: `${label} must be greater than ₹0.` });
}

// An amount that is allowed to be nothing, because nothing is a meaningful setting
// for it: a cancellation fee of zero is "we do not charge for cancelling", which is
// a different statement from a price of zero.
export function optionalMoneyPaise(label = "Amount") {
  const lower = label.toLowerCase();
  return z
    .number({ required_error: `${label} is required.`, invalid_type_error: `Enter a valid ${lower}.` })
    .int(`${label} must be a whole number of paise (₹1 = 100 paise).`)
    .nonnegative(`${label} cannot be negative.`);
}

// A calendar day, as the API states it everywhere else.
//
// `z.string().min(1)` is what the slot routes had, so "tomorrow" and "not-a-date"
// were accepted and stored. Nothing downstream complains: `isPastSlot` compares the
// string to today's and "not-a-date" sorts after "2026-09-12", and
// `minutesUntilStart` parses it to NaN, which fails every comparison it is in — so a
// slot with a nonsense date skipped both the past-date rule and the two-hour notice
// rule and appeared on no calendar a supervisor could find it on.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function dateField(label = "Date") {
  const lower = label.toLowerCase();
  return z
    .string({ required_error: `${label} is required.`, invalid_type_error: `Enter a valid ${lower}.` })
    .regex(ISO_DATE, `Enter a valid ${lower} in YYYY-MM-DD form.`)
    // A well-formed string that is not a day — 2026-02-31, 2026-13-01 — still has to
    // be refused, and the pattern cannot tell the difference.
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }, { message: `Enter a real ${lower}.` });
}

// A count of things somebody typed: garments, floors, flats, vehicles.
export function countField(label: string, { min = 1, max }: { min?: number; max?: number } = {}) {
  const lower = label.toLowerCase();
  const field = z
    .number({ required_error: `${label} is required.`, invalid_type_error: `Enter a valid ${lower}.` })
    .int(`${label} must be a whole number.`)
    .min(min, `${label} must be at least ${min}.`);
  return max === undefined ? field : field.max(max, `${label} cannot exceed ${max}.`);
}

// A rate expressed as a percentage: tax, a discount, a share refunded.
export function percentField(label: string, max = 100) {
  const lower = label.toLowerCase();
  return z
    .number({ required_error: `${label} is required.`, invalid_type_error: `Enter a valid ${lower}.` })
    .min(0, `${label} cannot be negative.`)
    .max(max, `${label} cannot exceed ${max}%.`);
}

// A required string that says the same thing whether it arrived empty or did not
// arrive at all.
//
// `z.string().min(1, "Choose a society.")` only speaks for a string that is present;
// a body with the key missing entirely gets zod's "Required", which is the answer
// that made a dropdown nobody had touched indistinguishable from a bug.
export function requiredText(message: string) {
  return z.string({ required_error: message, invalid_type_error: message }).min(1, message);
}

// Which of the three fixed windows a slot runs in. Nobody types a start and an end
// time; see SLOT_WINDOWS.
export const slotWindowField = z.enum(["Morning", "Afternoon", "Evening"], {
  errorMap: () => ({ message: "Choose Morning, Afternoon or Evening." }),
});
