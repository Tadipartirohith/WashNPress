// Where the platform operates, as a closed list.
//
// An area used to be identified by a code somebody typed — MDH, GCB — which is a
// second name for a thing that already has one, has to be kept unique by hand, and
// says nothing to anybody reading it. What actually distinguishes two areas called
// Gandhinagar is the state they are in, so that is what identifies them: a state
// chosen from this list, and a name.
//
// The list is closed on purpose. A free text region produced "Hyderabad", which is a
// city, sitting in the field meant to hold a state — so filtering areas by region
// matched nothing that a person would have predicted.

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
// read a region written before the field held states: an area recorded as being in
// "Hyderabad" is an area in Telangana, and saying so is better than dropping it.
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

// The state a written region belongs to. A state is itself; a city the platform
// knows is the state it sits in; anything else is unknown, and saying so is better
// than guessing.
export function stateFor(region: string | null | undefined): State | null {
  if (!region) return null;
  const trimmed = region.trim();
  if (isState(trimmed)) return trimmed;
  const match = STATES.find((s) => s.toLowerCase() === trimmed.toLowerCase());
  if (match) return match;
  return CITY_STATES[trimmed.toLowerCase()] ?? null;
}

// Two areas are the same area when they share a state and a name. Case and spacing
// are not distinctions anybody means: "Gandhi Nagar" and "gandhinagar" in the same
// state are one area typed twice.
export function areaKey(state: string, name: string): string {
  return `${state.trim().toLowerCase()}::${name.trim().toLowerCase().replace(/\s+/g, " ")}`;
}
