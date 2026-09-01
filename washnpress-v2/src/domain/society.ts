// Where a society is, written down the way a person writes an address.
//
// It used to be one free-text box plus a city and a state, which is three fields
// pretending to be an address: nobody could filter by pincode, nothing could tell
// "Main Road" from "Madhapur", and two societies on the same road were only the
// same place if whoever typed them agreed on the spelling.
//
// Note that "locality" here is a line of the postal address — Madhapur, Gachibowli
// — and not the operational Area the platform used to be organised around. Areas
// are gone; a locality is text on an envelope.

export interface SocietyAddress {
  // House number, building name, or the society's own block of an address.
  house: string;
  street: string;
  locality: string;
  city: string;
  state: string;
  pincode: string;
}

export const EMPTY_ADDRESS: SocietyAddress = {
  house: "", street: "", locality: "", city: "", state: "", pincode: "",
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function normaliseAddress(input: Partial<SocietyAddress> | null | undefined): SocietyAddress {
  return {
    house: clean(input?.house),
    street: clean(input?.street),
    locality: clean(input?.locality),
    city: clean(input?.city),
    state: clean(input?.state),
    pincode: clean(input?.pincode),
  };
}

// An Indian pincode is six digits and never starts with a zero.
export function isPincode(value: string): boolean {
  return /^[1-9][0-9]{5}$/.test(value.trim());
}

// Everything wrong with an address at once, rather than one field at a time: a
// person filling in the boxes should be told about all of them, not sent round the
// loop once per field.
//
// A society's address is the location of a complex, not of a front door. Asking for
// a house or building duplicates the thing being named — "Aparna Apartments" with
// "House: Aparna Apartments" underneath it — and a street is navigation detail that
// says nothing about where the society sits operationally. Both are kept, because
// an operator finding the place for the first time is glad of them, and both are
// optional. What actually identifies a society is where it is: a locality, a city,
// a state and a pincode.
//
// The individual house, flat and unit belong to the blocks and residents inside the
// society, which is where they are already asked for.
export function addressProblems(input: Partial<SocietyAddress> | null | undefined): string[] {
  const address = normaliseAddress(input);
  const problems: string[] = [];
  if (!address.locality) problems.push("A locality is part of the address");
  if (!address.city) problems.push("A city is part of the address");
  if (!address.state) problems.push("A state is part of the address");
  if (!isPincode(address.pincode)) problems.push("A pincode is six digits");
  return problems;
}

// The address on one line, for a card that has room for a line and not a form.
export function formatAddress(address: Partial<SocietyAddress> | null | undefined): string {
  const parts = normaliseAddress(address);
  const head = [parts.house, parts.street, parts.locality, parts.city].filter(Boolean).join(", ");
  const tail = [parts.state, parts.pincode].filter(Boolean).join(" - ");
  return [head, tail].filter(Boolean).join(", ");
}

// Reading an address that was stored before it had parts.
//
// The old record kept a single line plus a city and a state. Splitting the line on
// commas recovers the house and the street in the common case and never invents
// anything: whatever cannot be placed stays in the street, where it reads correctly
// even though it is not structured.
export function addressFromLegacy(
  line: string | null | undefined,
  city: string | null | undefined,
  state: string | null | undefined,
): SocietyAddress {
  const pieces = clean(line).split(",").map((p) => p.trim()).filter(Boolean);
  const pincodeAt = pieces.findIndex((p) => isPincode(p));
  const pincode = pincodeAt >= 0 ? pieces.splice(pincodeAt, 1)[0] : "";
  const [house = "", ...rest] = pieces;
  return normaliseAddress({
    house,
    street: rest.join(", "),
    locality: "",
    city: clean(city),
    state: clean(state),
    pincode,
  });
}

// Two societies are the same society when they are the same name in the same city.
// The same name in another city is another society — there is a Green Meadows in
// more than one, and neither of them is the other.
export function societyKey(name: string, city: string): string {
  return `${clean(city).toLowerCase()}::${clean(name).toLowerCase()}`;
}
