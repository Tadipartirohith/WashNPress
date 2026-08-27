// Where the platform operates, as a closed list.
//
// The list is closed on purpose. A free text state field produced "Hyderabad",
// which is a city, sitting in the box meant to hold a state — so anything grouping
// by state matched nothing a person would have predicted. A society's address is
// the only thing that names a state now, and it chooses from here.

export const STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

export type State = (typeof STATES)[number];

export function isState(value: string | null | undefined): value is State {
  return typeof value === "string" && (STATES as readonly string[]).includes(value);
}

// The cities the platform has operated in, and the state each one is in. Used to
// read a state written before the field held states: a record saying "Hyderabad"
// is a record in Telangana, and saying so is better than dropping it.
const CITY_STATES: Record<string, State> = {
  hyderabad: "Telangana",
  secunderabad: "Telangana",
  warangal: "Telangana",
  vijayawada: "Andhra Pradesh",
  visakhapatnam: "Andhra Pradesh",
  vizag: "Andhra Pradesh",
  guntur: "Andhra Pradesh",
  tirupati: "Andhra Pradesh",
  bengaluru: "Karnataka",
  bangalore: "Karnataka",
  mysuru: "Karnataka",
  mysore: "Karnataka",
  chennai: "Tamil Nadu",
  coimbatore: "Tamil Nadu",
  madurai: "Tamil Nadu",
  mumbai: "Maharashtra",
  pune: "Maharashtra",
  nagpur: "Maharashtra",
  kochi: "Kerala",
  cochin: "Kerala",
  thiruvananthapuram: "Kerala",
  ahmedabad: "Gujarat",
  surat: "Gujarat",
  jaipur: "Rajasthan",
  lucknow: "Uttar Pradesh",
  noida: "Uttar Pradesh",
  gurugram: "Haryana",
  gurgaon: "Haryana",
  kolkata: "West Bengal",
  bhubaneswar: "Odisha",
  indore: "Madhya Pradesh",
  bhopal: "Madhya Pradesh",
  chandigarh: "Punjab",
  patna: "Bihar",
  raipur: "Chhattisgarh",
  ranchi: "Jharkhand",
  guwahati: "Assam",
  panaji: "Goa",
};

// The state a written value belongs to. A state is itself; a city the platform
// knows is the state it sits in; anything else is unknown, and saying so is better
// than guessing.
export function stateFor(value: string | null | undefined): State | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (isState(trimmed)) return trimmed;
  const match = STATES.find((s) => s.toLowerCase() === trimmed.toLowerCase());
  if (match) return match;
  return CITY_STATES[trimmed.toLowerCase()] ?? null;
}
