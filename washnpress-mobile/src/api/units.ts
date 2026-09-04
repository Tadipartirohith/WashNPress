import type { MeasurementUnit, GarmentService } from "./types";

// The screen-side half of measurement units. The backend decides what a service is
// measured in and what it costs; this only says how to write it down so a resident
// reads "4.50 kg" and "6 pieces" rather than a bare number that means neither.

const SUFFIX: Record<MeasurementUnit, { one: string; many: string }> = {
  kg: { one: "kg", many: "kg" },
  piece: { one: "piece", many: "pieces" },
  hour: { one: "hour", many: "hours" },
  job: { one: "job", many: "jobs" },
  vehicle: { one: "vehicle", many: "vehicles" },
  room: { one: "room", many: "rooms" },
  sqft: { one: "sq ft", many: "sq ft" },
  pair: { one: "pair", many: "pairs" },
  item: { one: "item", many: "items" },
};

// Kilograms, hours and square feet are naturally fractional. Half a piece is not,
// and rounding one like the other is how a 2.5 kg bag became a 3 kg bill.
const FRACTIONAL: MeasurementUnit[] = ["kg", "hour", "sqft"];

export function isFractional(unit: MeasurementUnit): boolean {
  return FRACTIONAL.includes(unit);
}

// A service that is counted needs only a garment count; anything else has to be
// measured, and the booking screen has to ask for it.
export function isMeasured(unit: MeasurementUnit): boolean {
  return unit !== "piece";
}

export function unitOf(service: Pick<GarmentService, "unit"> | null | undefined): MeasurementUnit {
  return service?.unit ?? "piece";
}

export function normaliseQuantity(unit: MeasurementUnit, quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return isFractional(unit) ? Math.round(quantity * 100) / 100 : Math.trunc(quantity);
}

export function formatQuantity(unit: MeasurementUnit, quantity: number): string {
  const value = normaliseQuantity(unit, quantity);
  const suffix = value === 1 ? SUFFIX[unit].one : SUFFIX[unit].many;
  const shown = isFractional(unit) && value % 1 !== 0 ? value.toFixed(2) : String(value);
  return `${shown} ${suffix}`;
}

// "per kg", "per piece" — what the price beside a service is actually per.
export function perUnitLabel(unit: MeasurementUnit): string {
  return `per ${SUFFIX[unit].one}`;
}

// What to call the box the resident types the measurement into.
export function measurementLabel(unit: MeasurementUnit): string {
  switch (unit) {
    case "kg": return "Approximate weight (kg)";
    case "hour": return "How many hours";
    case "sqft": return "Area (sq ft)";
    case "room": return "How many rooms";
    case "vehicle": return "How many vehicles";
    case "pair": return "How many pairs";
    case "job": return "How many jobs";
    default: return "How many";
  }
}

// Reads a typed measurement. Anything that is not a number reads as nothing given,
// rather than as zero, so an empty box does not silently book a zero-weight bag.
export function parseMeasurement(text: string, unit: MeasurementUnit): number | null {
  const value = Number(text.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return normaliseQuantity(unit, value);
}

// Keeps a measurement box to what a measurement can be: digits and a single decimal
// point. A minus sign, letters or symbols are dropped as they are typed, so "-5"
// cannot be entered and then silently read as 5, and "@" or "#" cannot be entered at
// all — the field rejects them at the source rather than quietly correcting them.
export function sanitizeDecimalInput(text: string): string {
  let out = text.replace(/[^0-9.]/g, "");
  const firstDot = out.indexOf(".");
  if (firstDot >= 0) {
    // Keep the first decimal point, drop any others: "4.5.6" reads as "4.56", not
    // as an invalid number that silently becomes something else.
    out = out.slice(0, firstDot + 1) + out.slice(firstDot + 1).replace(/\./g, "");
  }
  return out;
}
