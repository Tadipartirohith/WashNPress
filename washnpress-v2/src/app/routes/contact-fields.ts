import { z } from "zod";
import { CONTACT_MESSAGES, isEmail, isIndianMobile, normalizeEmail, normalizePhone } from "../../domain/contact";

// The two field types every route that takes a contact detail should use.
//
// `z.string().email()` appeared independently eight times and `z.string().min(10)
// .max(10)` three, which meant the API enforced two different email rules and no
// phone rule at all — ten characters, so "abcdefghij" was an acceptable mobile
// number as far as the schema was concerned. Worse, the strict checks only ran on
// the create routes, so the same value was accepted or refused depending on whether
// the account already existed.
//
// Both transform as well as validate, so what reaches a handler is already
// normalised and there is no second place that has to remember to trim.

export const emailField = z
  .string()
  .transform(normalizeEmail)
  .refine((value) => isEmail(value), { message: CONTACT_MESSAGES.email });

// An address where blank means "no address" rather than "a bad address".
//
// The profile screens send the field whether or not it was filled in, so an empty
// string has to mean clearing it. Without this an optional field became impossible
// to empty once set.
export const optionalEmailField = z
  .string()
  .transform(normalizeEmail)
  .refine((value) => value === "" || isEmail(value), { message: CONTACT_MESSAGES.email });

export const phoneField = z
  .string()
  .transform(normalizePhone)
  .refine((value) => isIndianMobile(value), { message: CONTACT_MESSAGES.phone });
