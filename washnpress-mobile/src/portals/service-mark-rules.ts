import type { ServiceMarkName } from "../components/service-mark";

// Which mark a service gets.
//
// The stored kind is the first answer and usually the right one, but it is not
// enough on its own: the catalogue only ever had two kinds, and a service built in
// the wizard inherits `vehicle_wash` as a default. So "Sofa cleaning" and "Shoe
// polishing" both arrive claiming to be vehicle washes, and drawing a car beside
// them would be worse than drawing nothing.
//
// So the name decides, and the vehicle kind is never enough on its own. Nothing here
// guesses: a service that matches no word falls back to the laundry mark, which is
// the business the platform is actually in and the one fallback that is never absurd.

const VEHICLE_WORDS = ["car", "bike", "vehicle", "scooter", "motorcycle", "cycle"];
const IRON_WORDS = ["iron", "press", "steam", "crease"];

function mentions(name: string, words: string[]): boolean {
  const text = name.toLowerCase();
  return words.some((word) => text.includes(word));
}

export function markForService(
  kind: "vehicle_wash" | "home_ironing" | null | undefined,
  name = "",
): ServiceMarkName {
  // An explicit ironing kind is never overridden — nothing else in the catalogue
  // claims it, so it was chosen rather than inherited.
  if (kind === "home_ironing") return "iron";

  // Past that the name decides, and the vehicle kind buys nothing on its own. It is
  // the default a wizard-built service carries whatever it actually is, so trusting
  // it unsupported is what puts a car beside "Sofa shampoo". A mark is only drawn as
  // a vehicle when the service says it is one.
  if (mentions(name, VEHICLE_WORDS)) return "vehicle";
  if (mentions(name, IRON_WORDS)) return "iron";

  // Everything else, including a service named something nobody anticipated, gets
  // the laundry mark — the business the platform is actually in, and the only
  // fallback that is never absurd.
  return "wash";
}
